import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { onTerminalData } from '../../../ipc/events';
import { terminalWrite, terminalResize } from '../../../ipc/commands';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import { getTheme } from '../../../themes';
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

  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const lightTheme = useSettingsStore((s) => s.lightTheme);
  // 터미널 개별 테마 오버라이드 (없으면 앱 테마)
  const sessionTheme = useTerminalStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.theme
  );
  const effectiveType = sessionTheme ?? resolvedTheme;
  const termTheme: ITheme = getTheme(
    effectiveType === 'dark' ? darkTheme : lightTheme,
    effectiveType
  ).terminal;

  // 폰트/테마 변경 시 기존 터미널에 반영
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = editorFontFamily;
    term.options.fontSize = editorFontSize;
    term.options.theme = termTheme;
    fitRef.current?.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorFontFamily, editorFontSize, termTheme]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: termTheme,
      fontSize: editorFontSize,
      fontFamily: editorFontFamily,
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
        fit.fit();
        terminalResize(sessionId, term.cols, term.rows);
        term.refresh(0, term.rows - 1);
        term.scrollToBottom();
      } catch {
        /* 디스포즈 직후 등 — 무시 */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, sessionId]);

  return (
    <div
      ref={containerRef}
      className={styles.terminal}
    />
  );
}
