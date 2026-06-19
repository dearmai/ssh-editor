import { Plug, Files, Terminal as TerminalIcon, Settings } from 'lucide-react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useConnectionStore } from '../../stores/connectionStore';
import styles from './ActivityBar.module.css';

export default function ActivityBar() {
  const { toggleBottomPanel, isBottomPanelOpen } = useTerminalStore();
  const { selectedSessionId, activeConnections } = useConnectionStore();

  const handleNewTerminal = () => {
    if (!selectedSessionId) return;
    toggleBottomPanel();
  };

  return (
    <div className={styles.bar}>
      <div className={styles.top}>
        <button
          className={styles.icon}
          title="연결 관리"
          aria-label="연결 관리"
        >
          <Plug size={22} />
        </button>
        <button
          className={styles.icon}
          title="파일 탐색기"
          aria-label="파일 탐색기"
        >
          <Files size={22} />
        </button>
      </div>
      <div className={styles.bottom}>
        <button
          className={`${styles.icon} ${isBottomPanelOpen ? styles.active : ''}`}
          title="터미널 토글 (Ctrl+`)"
          aria-label="터미널 토글"
          onClick={handleNewTerminal}
          disabled={activeConnections.length === 0}
        >
          <TerminalIcon size={22} />
        </button>
        <button
          className={styles.icon}
          title="설정"
          aria-label="설정"
        >
          <Settings size={22} />
        </button>
      </div>
    </div>
  );
}
