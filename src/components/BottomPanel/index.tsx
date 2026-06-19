import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTerminalStore } from '../../stores/terminalStore';
import LogPane from './LogPane';
import TerminalPane from './Terminal';
import styles from './BottomPanel.module.css';

type ActiveTab = { kind: 'log' } | { kind: 'terminal'; id: string };

export default function BottomPanel() {
  const { sessions, setActiveSession, closeSession, createSession, toggleBottomPanel } =
    useTerminalStore();
  const { selectedSessionId } = useConnectionStore();

  // "log" or terminal session id
  const [activeTab, setActiveTab] = useState<ActiveTab>({ kind: 'log' });

  const handleNewTerminal = async () => {
    if (!selectedSessionId) return;
    const id = await createSession(selectedSessionId);
    setActiveSession(id);
    setActiveTab({ kind: 'terminal', id });
  };

  const handleCloseTerminal = (sessionId: string) => {
    closeSession(sessionId);
    // 닫은 탭이 현재 탭이면 로그로 이동
    if (activeTab.kind === 'terminal' && activeTab.id === sessionId) {
      setActiveTab({ kind: 'log' });
    }
  };

  const isLogActive = activeTab.kind === 'log';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          {/* 로그 탭 (고정) */}
          <button
            className={`${styles.tab} ${isLogActive ? styles.active : ''}`}
            onClick={() => setActiveTab({ kind: 'log' })}
          >
            로그
          </button>

          {/* 터미널 탭들 */}
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
          <button
            className={styles.actionBtn}
            onClick={handleNewTerminal}
            title="새 터미널"
            disabled={!selectedSessionId}
          >
            <Plus size={14} />
          </button>
          <button className={styles.actionBtn} onClick={toggleBottomPanel} title="패널 닫기">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {/* 로그 패널 */}
        <div style={{ display: isLogActive ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <LogPane />
        </div>

        {/* 터미널 패널들 */}
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

        {!isLogActive && sessions.length === 0 && (
          <div className={styles.empty}>
            <p>+ 버튼으로 터미널을 여세요</p>
          </div>
        )}
      </div>
    </div>
  );
}
