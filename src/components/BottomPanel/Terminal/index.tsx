import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { onTerminalData } from '../../../ipc/events';
import { terminalWrite, terminalResize } from '../../../ipc/commands';
import { log } from '../../../stores/logStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import { getTheme } from '../../../themes';
import { decodeOsc52Base64, readClipboard, writeClipboard } from '../../../utils/clipboard';
import { TerminalViewport } from '../../../utils/terminalViewport';
import { createTerminalLinkOpener } from '../../../utils/terminalLinks';
import { toastError } from '../../../stores/toastStore';
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
  const viewportRef = useRef<TerminalViewport | null>(null);
  const visibleRef = useRef(visible);
  const restoringRef = useRef(true);
  const measureRef = useRef<((remeasureFont?: boolean) => void) | null>(null);
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
  const fontRef = useRef({ family: terminalFontFamily, size: terminalFontSize });
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

  useLayoutEffect(() => {
    fontRef.current = { family: terminalFontFamily, size: terminalFontSize };
  }, [terminalFontFamily, terminalFontSize]);

  // display:none으로 인한 리사이즈/스크롤 이벤트가 오기 전에 원래 위치를 보관한다.
  useLayoutEffect(() => {
    if (!visible && visibleRef.current) {
      if (!restoringRef.current) viewportRef.current?.capture();
      restoringRef.current = true;
    }
    visibleRef.current = visible;
  }, [visible]);

  // 테마 변경은 크기 재측정 없이 적용한다.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = termTheme;
  }, [termTheme]);

  useEffect(() => {
    measureRef.current?.(true);
  }, [terminalFontFamily, terminalFontSize]);

  useEffect(() => {
    if (!containerRef.current) return;
    lastSizeRef.current = null;
    restoringRef.current = true;
    const container = containerRef.current;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const linkHandler = {
      activate: createTerminalLinkOpener(isMac, openUrl, (error) => {
        log.error(`브라우저에서 링크 열기 실패: ${String(error)}`);
        toastError('브라우저에서 링크를 열지 못했습니다.');
      }),
      hover: (_event: MouseEvent, uri: string) => {
        container.title = `${uri}\n${isMac ? 'Cmd' : 'Ctrl'}+클릭으로 브라우저에서 열기`;
      },
      leave: () => { container.removeAttribute('title'); },
      allowNonHttpProtocols: false,
    };

    const term = new Terminal({
      theme: termTheme,
      fontSize: terminalFontSize,
      fontFamily: terminalFontFamily,
      scrollback: 5000,
      cursorBlink: true,
      // OSC 8 하이퍼링크도 일반 URL과 같은 클릭 규칙을 사용한다.
      linkHandler,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon(linkHandler.activate, linkHandler);
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    termRef.current = term;
    const viewport = new TerminalViewport(term);
    viewportRef.current = viewport;
    let disposed = false;
    let restoreFrame = 0;
    let revision = 0;
    const canMeasure = () => !disposed && visibleRef.current
      && !!containerRef.current?.clientWidth && !!containerRef.current?.clientHeight
      && !!containerRef.current?.getClientRects().length;

    const measure = (remeasureFont = false) => {
      // 숨긴 패널을 fit하면 2열×1행까지 줄어들어 원격 TUI와 스크롤백이 재배치될 수 있다.
      if (!canMeasure()) return;
      if (!restoringRef.current) viewport.capture();
      restoringRef.current = true;
      const currentRevision = ++revision;
      cancelAnimationFrame(restoreFrame);
      if (remeasureFont) {
        term.options.fontFamily = 'monospace';
        term.options.fontFamily = fontRef.current.family;
        term.options.fontSize = fontRef.current.size;
      }
      fitAddon.fit();
      sendResize(term.cols, term.rows);
      term.refresh(0, term.rows - 1);
      // 숨김 중 받은 출력의 파싱과 새 레이아웃 반영 이후에 복원한다.
      term.write('', () => {
        if (!canMeasure() || revision !== currentRevision) return;
        restoreFrame = requestAnimationFrame(() => {
          if (!canMeasure() || revision !== currentRevision) return;
          viewport.restore();
          term.refresh(0, term.rows - 1);
          restoringRef.current = false;
        });
      });
    };
    measureRef.current = measure;

    measure(true);
    document.fonts?.ready.then(() => {
      if (!disposed) measure(true);
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
      if (!disposed && payload.terminalId === sessionId) {
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
      measure();
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
      disposed = true;
      container.removeAttribute('title');
      cancelAnimationFrame(restoreFrame);
      unlistenPromise.then((f) => f());
      observer.disconnect();
      offResize.dispose();
      viewport.dispose();
      termRef.current = null;
      viewportRef.current = null;
      measureRef.current = null;
      term.dispose();
    };
  }, [sessionId]);

  // 복귀 시 실제 크기로 재측정하고 터미널별로 보관한 스크롤 위치를 복원한다.
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => {
      measureRef.current?.(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, sessionId]);

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
}
