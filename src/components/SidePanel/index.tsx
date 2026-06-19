import { Plus, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import NewConnectionDialog from '../Dialogs/NewConnectionDialog';
import FileTreePanel from './FileTreePanel';
import styles from './SidePanel.module.css';

export default function SidePanel() {
  const [showDialog, setShowDialog] = useState(false);
  const { activeConnections, selectedSessionId, disconnect, setSelectedSession } =
    useConnectionStore();

  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);

  return (
    <div className={styles.panel}>
      {/* 서버 헤더 */}
      <div className={styles.serverHeader}>
        {conn ? (
          <>
            <span
              className={styles.serverName}
              title={`${conn.profile.username}@${conn.profile.hostname}`}
            >
              {conn.profile.name.split('/').pop() ?? conn.profile.name}
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
                      {c.profile.name.split('/').pop() ?? c.profile.name}
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
                onClick={() => disconnect(conn.sessionId)}
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
      </div>

      <div className={styles.content}>
        <FileTreePanel />
      </div>

      <NewConnectionDialog open={showDialog} onClose={() => setShowDialog(false)} />
    </div>
  );
}
