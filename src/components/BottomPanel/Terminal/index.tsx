import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { onTerminalData } from '../../../ipc/events';
import { terminalWrite, terminalResize } from '../../../ipc/commands';
import { log } from '../../../stores/logStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import { getTheme } from '../../../themes';
import { decodeOsc52Base64, readClipboard, writeClipboard } from '../../../utils/clipboard';
import styles from './Terminal.module.css';

interface Props {
  sessionId: string;
  connectionId: string;
  /** 이 터미널이 현재 화면에 보이는지 (분할 열 + 터미널 탭 활성). 숨김→표시 전환 시 강제 재그리기 */
  visible?: boolean;
}

export default function TerminalPane({ sessionId, connectionId: _connectionId, visible = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  /** 마지막으로 서버에 보낸 크기 — 같은 값 중복 전송 방지 */
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  /** 크기가 실제로 바뀐 경우에만 PTY window-change 전송 */
  const sendResize = (cols: number, rows: number) => {
    if (!cols || !rows) return;
    const last = lastSizeRef.current;
    if (last && last.cols === cols && last.rows === rows) return;
    lastSizeRef.current = { cols, rows };
    terminalResize(sessionId, cols, rows).catch((e) => {
      log.warn(`터미널 크기 전송 실패: ${String(e)}`);
    });
  };

  const terminalFontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const terminalDarkTheme = useSettingsStore((s) => s.terminalDarkTheme);
  const terminalLightTheme = useSettingsStore((s) => s.terminalLightTheme);
  // 터미널 개별 테마 오버라이드 (없으면 앱 테마)
  const sessionTheme = useTerminalStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.theme
  );
  const effectiveType = sessionTheme ?? resolvedTheme;
  const termTheme: ITheme = getTheme(
    effectiveType === 'dark' ? terminalDarkTheme : terminalLightTheme,
    effectiveType
  ).terminal;

  // xterm은 숨김(width 0) 상태에서 생성되면 char 폭 측정에 실패해 기본 monospace로
  // 렌더된 뒤 갱신되지 않는다. fit/refresh만으론 폰트 CSS가 재주입되지 않으므로,
  // fontFamily를 다른 값으로 한 번 흔들어(nudge) 렌더러의 재측정·폰트 재주입을 강제한다.
  const remeasureFont = (term: Terminal) => {
    term.options.fontFamily = 'monospace';
    term.options.fontFamily = terminalFontFamily;
    term.options.fontSize = terminalFontSize;
    fitRef.current?.fit();
    term.refresh(0, term.rows - 1);
  };

  // 폰트/테마 변경 시 기존 터미널에 반영
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = termTheme;
    remeasureFont(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalFontFamily, terminalFontSize, termTheme]);

  useEffect(() => {
    if (!containerRef.current) return;
    lastSizeRef.current = null;

    const term = new Terminal({
      theme: termTheme,
      fontSize: terminalFontSize,
      fontFamily: terminalFontFamily,
      scrollback: 5000,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // 생성 직후(숨김 상태일 수 있음) 폰트 재측정 강제 + 폰트 로드 완료 후 한 번 더
    remeasureFont(term);
    document.fonts?.ready.then(() => {
      if (termRef.current === term) remeasureFont(term);
    });

    // OSC 52 — 원격 pbcopy/tmux 등이 보낸 클립보드 쓰기를 로컬 클립보드에 반영
    // 형식: ESC ] 52 ; <selection> ; <base64> BEL
    term.parser.registerOscHandler(52, (data) => {
      // Pc(selection)는 'c', 'p', 'cp' 등 여러 글자가 올 수 있으므로 마지막 ';' 기준으로 자른다
      const sep = data.lastIndexOf(';');
      if (sep < 0) return true;
      const payload = data.slice(sep + 1).trim();
      // '?'는 클립보드 읽기 요청 → 원격에 로컬 클립보드를 노출하지 않도록 무시
      if (payload === '?') return true;
      // '!' 또는 빈 값은 클립보드 비우기 요청 → 무시
      if (payload === '' || payload === '!') return true;

      try {
        const text = decodeOsc52Base64(payload);
        void writeClipboard(text).catch((e) => {
          log.error(`클립보드 복사 실패: ${String(e)}`);
        });
      } catch (e) {
        log.warn(`OSC 52 디코드 실패: ${String(e)}`);
      }
      return true;
    });

    // 터미널 출력 수신
    const unlistenPromise = onTerminalData((payload) => {
      if (payload.terminalId === sessionId) {
        const bytes = atob(payload.data);
        const buf = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
        term.write(buf);
      }
    });

    // 키 입력 전송
    term.onData((data) => {
      const encoded = btoa(
        String.fromCharCode(...Array.from(new TextEncoder().encode(data)))
      );
      terminalWrite(sessionId, encoded);
    });

    // 리사이즈 — 크기가 바뀔 때만 PTY에 window-change 전송
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize(term.cols, term.rows);
    });
    observer.observe(containerRef.current);
    // xterm이 자체적으로 감지한 크기 변화(폰트 변경 등)도 서버에 반영
    const offResize = term.onResize(({ cols, rows }) => sendResize(cols, rows));

    // 복사/붙여넣기 — xterm은 자체 선택 모델을 쓰므로 브라우저 기본 복사가 동작하지 않는다.
    // macOS Cmd+C/V, 그 외 Ctrl+Shift+C/V를 직접 처리하고 셸로는 흘려보내지 않는다.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || (e.ctrlKey && e.shiftKey);
      if (!mod) return true;

      if (key === 'c') {
        const selection = term.getSelection();
        // 선택이 없으면 기본 동작(Ctrl+Shift+C 등)에 맡긴다
        if (!selection) return true;
        void writeClipboard(selection).catch((err) => {
          log.error(`클립보드 복사 실패: ${String(err)}`);
        });
        e.preventDefault();
        return false;
      }

      if (key === 'v') {
        void readClipboard()
          .then((text) => {
            if (!text) return;
            term.paste(text);
          })
          .catch((err) => {
            log.error(`클립보드 붙여넣기 실패: ${String(err)}`);
          });
        e.preventDefault();
        return false;
      }

      return true;
    });

    return () => {
      unlistenPromise.then((f) => f());
      observer.disconnect();
      offResize.dispose();
      term.dispose();
    };
  }, [sessionId]);

  // 숨김(display:none)이던 터미널이 다시 보이게 될 때: xterm은 자동으로 다시 그리지 않으므로
  // 레이아웃 반영 후(rAF) 강제로 fit + refresh. (분할로 새 열이 표시될 때 빈 화면 방지)
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      try {
        // 숨김 상태에서 생성돼 폰트 측정이 빗나갔을 수 있으니 표시될 때 재측정
        remeasureFont(term);
        sendResize(term.cols, term.rows);
        term.scrollToBottom();
      } catch {
        /* 디스포즈 직후 등 — 무시 */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, sessionId]);

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
}
