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
import { decodeOsc52Base64, writeClipboard } from '../../../utils/clipboard';
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
      const sep = data.indexOf(';');
      if (sep < 0) return true;
      const payload = data.slice(sep + 1);
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

    // 리사이즈
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      terminalResize(sessionId, term.cols, term.rows);
    });
    observer.observe(containerRef.current);

    return () => {
      unlistenPromise.then((f) => f());
      observer.disconnect();
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
        terminalResize(sessionId, term.cols, term.rows);
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
