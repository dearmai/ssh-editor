import { useEffect, useState } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useTransferStore } from '../../stores/transferStore';
import LogPane from './LogPane';
import TransferPane from './TransferPane';
import TerminalGrid from './TerminalGrid';
import TerminalSidebar from './TerminalSidebar';
import styles from './BottomPanel.module.css';

type ActiveTab = 'log' | 'transfer' | 'terminal';

export default function BottomPanel() {
  const sessions = useTerminalStore((s) => s.sessions);
  const setDraggingTerminal = useTerminalStore((s) => s.setDraggingTerminal);
  const activeTransfers = useTransferStore(
    (s) => s.transfers.filter((t) => t.status === 'active' || t.status === 'queued').length
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>('log');

  // 드래그가 끝나면(드롭/취소 무관) 드래그 상태를 확실히 해제
  useEffect(() => {
    const clear = () => setDraggingTerminal(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [setDraggingTerminal]);

  const isLogActive = activeTab === 'log';
  const isTransferActive = activeTab === 'transfer';
  const isTerminalActive = activeTab === 'terminal';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${isLogActive ? styles.active : ''}`}
            onClick={() => setActiveTab('log')}
          >
            로그
          </button>
          <button
            className={`${styles.tab} ${isTransferActive ? styles.active : ''}`}
            onClick={() => setActiveTab('transfer')}
          >
            전송
            {activeTransfers > 0 && <span className={styles.badge}>{activeTransfers}</span>}
          </button>
          <button
            className={`${styles.tab} ${isTerminalActive ? styles.active : ''}`}
            onClick={() => setActiveTab('terminal')}
          >
            터미널
            {sessions.length > 0 && <span className={styles.count}>{sessions.length}</span>}
          </button>
        </div>
      </div>

      <div className={styles.content}>
        <div style={{ display: isLogActive ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <LogPane />
        </div>
        <div style={{ display: isTransferActive ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <TransferPane />
        </div>

        {/* 터미널: 항상 마운트(xterm·scrollback 보존), 표시만 토글.
            좌 = 분할 영역(TerminalGrid), 우 = 탭 사이드바(VSCode식) */}
        <div className={styles.terminalView} style={{ display: isTerminalActive ? 'flex' : 'none' }}>
          <div className={styles.terminalMain}>
            <TerminalGrid active={isTerminalActive} />
          </div>
          <TerminalSidebar />
        </div>
      </div>
    </div>
  );
}
