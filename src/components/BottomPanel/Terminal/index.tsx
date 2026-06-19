import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import { onTerminalData } from '../../../ipc/events';
import { terminalWrite, terminalResize } from '../../../ipc/commands';
import styles from './Terminal.module.css';

interface Props {
  sessionId: string;
  connectionId: string;
}

export default function TerminalPane({ sessionId, connectionId: _connectionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
      },
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace",
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

  return (
    <div
      ref={containerRef}
      className={styles.terminal}
    />
  );
}
