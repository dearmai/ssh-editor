import { Plus, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import NewConnectionDialog from '../Dialogs/NewConnectionDialog';
import FileTreePanel from './FileTreePanel';
import LocalFileTree from './LocalFileTree';
import { useLocalWorkspaceStore } from '../../stores/localWorkspaceStore';
import styles from './SidePanel.module.css';

export default function SidePanel() {
  const localActive = useLocalWorkspaceStore((s) => s.active);
  const showLocal = useLocalWorkspaceStore((s) => s.show);
  const [showDialog, setShowDialog] = useState(false);
  const { activeConnections, selectedSessionId, disconnect, setSelectedSession } =
    useConnectionStore();

  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);

  return (
    <div className={styles.panel}>
      <div className={styles.serverHeader}>
        <button className={styles.modeBtn} aria-pressed={localActive} onClick={() => showLocal(true)}>로컬</button>
        <button className={styles.modeBtn} aria-pressed={!localActive} onClick={() => showLocal(false)}>SSH</button>
      </div>
      {/* 서버 헤더 */}
      {!localActive && <div className={styles.serverHeader}>
        {conn ? (
          <>
            <span
              className={styles.serverName}
              title={`${conn.profile.username}@${conn.profile.hostname}`}
            >
              {conn.profile.name}
            </span>
            <div className={styles.headerActions}>
              {activeConnections.length > 1 && (
                <select
                  className={styles.sessionSelect}
                  value={selectedSessionId ?? ''}
                  onChange={(e) => setSelectedSession(e.target.value)}
                >
                  {activeConnections.map((c) => (
                    <option key={c.sessionId} value={c.sessionId}>
                      {c.profile.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                className={styles.iconBtn}
                title="새 연결 추가"
                onClick={() => setShowDialog(true)}
              >
                <Plus size={13} />
              </button>
              <button
                className={`${styles.iconBtn} ${styles.danger}`}
                title="연결 해제"
                onClick={() => { void disconnect(conn.sessionId); }}
              >
                <WifiOff size={13} />
              </button>
            </div>
          </>
        ) : (
          <>
            <span className={styles.serverNameEmpty}>탐색기</span>
            <button
              className={styles.iconBtn}
              title="새 연결 추가"
              onClick={() => setShowDialog(true)}
            >
              <Plus size={13} />
            </button>
          </>
        )}
      </div>}

      <div className={styles.content}>
        {localActive ? <LocalFileTree /> : <FileTreePanel />}
      </div>

      <NewConnectionDialog open={showDialog} onClose={() => setShowDialog(false)} />
    </div>
  );
}
