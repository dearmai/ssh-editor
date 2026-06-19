import { Moon, Plus, Sun, X } from 'lucide-react';
import { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useTransferStore } from '../../stores/transferStore';
import LogPane from './LogPane';
import TransferPane from './TransferPane';
import TerminalPane from './Terminal';
import styles from './BottomPanel.module.css';

type ActiveTab = { kind: 'log' } | { kind: 'transfer' } | { kind: 'terminal'; id: string };

export default function BottomPanel() {
  const { sessions, setActiveSession, closeSession, createSession, setTerminalTheme } =
    useTerminalStore();
  const { selectedSessionId } = useConnectionStore();
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const activeTransfers = useTransferStore(
    (s) => s.transfers.filter((t) => t.status === 'active' || t.status === 'queued').length
  );

  const [activeTab, setActiveTab] = useState<ActiveTab>({ kind: 'log' });

  const handleNewTerminal = async () => {
    if (!selectedSessionId) return;
    const id = await createSession(selectedSessionId);
    setActiveSession(id);
    setActiveTab({ kind: 'terminal', id });
  };

  const handleCloseTerminal = (sessionId: string) => {
    closeSession(sessionId);
    if (activeTab.kind === 'terminal' && activeTab.id === sessionId) {
      setActiveTab({ kind: 'log' });
    }
  };

  const isLogActive = activeTab.kind === 'log';
  const isTransferActive = activeTab.kind === 'transfer';

  const activeTerminal =
    activeTab.kind === 'terminal' ? sessions.find((s) => s.id === activeTab.id) : undefined;
  const activeTerminalTheme = activeTerminal?.theme ?? resolvedTheme;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${isLogActive ? styles.active : ''}`}
            onClick={() => setActiveTab({ kind: 'log' })}
          >
            로그
          </button>
          <button
            className={`${styles.tab} ${isTransferActive ? styles.active : ''}`}
            onClick={() => setActiveTab({ kind: 'transfer' })}
          >
            전송
            {activeTransfers > 0 && <span className={styles.badge}>{activeTransfers}</span>}
          </button>

          {sessions.map((session) => {
            const isActive = activeTab.kind === 'terminal' && activeTab.id === session.id;
            return (
              <button
                key={session.id}
                className={`${styles.tab} ${isActive ? styles.active : ''}`}
                onClick={() => {
                  setActiveSession(session.id);
                  setActiveTab({ kind: 'terminal', id: session.id });
                }}
              >
                {session.title}
                <span
                  className={styles.closeTab}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTerminal(session.id);
                  }}
                >
                  <X size={11} />
                </span>
              </button>
            );
          })}
        </div>

        <div className={styles.actions}>
          {activeTerminal && (
            <button
              className={styles.actionBtn}
              onClick={() =>
                setTerminalTheme(activeTerminal.id, activeTerminalTheme === 'light' ? 'dark' : 'light')
              }
              title="이 터미널 라이트/다크 전환"
            >
              {activeTerminalTheme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          )}
          <button
            className={styles.actionBtn}
            onClick={handleNewTerminal}
            title="새 터미널"
            disabled={!selectedSessionId}
          >
            <Plus size={14} />
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

        {sessions.map((session) => {
          const isActive = activeTab.kind === 'terminal' && activeTab.id === session.id;
          return (
            <div
              key={session.id}
              className={styles.terminalWrapper}
              style={{ display: isActive ? 'block' : 'none' }}
            >
              <TerminalPane sessionId={session.id} connectionId={session.connectionId} />
            </div>
          );
        })}

        {activeTab.kind === 'terminal' && sessions.length === 0 && (
          <div className={styles.empty}>
            <p>+ 버튼으로 터미널을 여세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
