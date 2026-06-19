import { Plus, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useConnectionStore } from '../../../stores/connectionStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import NewConnectionDialog from '../../Dialogs/NewConnectionDialog';
import styles from './ConnectionPanel.module.css';

export default function ConnectionPanel() {
  const [showDialog, setShowDialog] = useState(false);
  const { activeConnections, selectedSessionId, disconnect, setSelectedSession } =
    useConnectionStore();
  const { createSession } = useTerminalStore();

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>활성 연결</span>
        <button
          className={styles.addBtn}
          onClick={() => setShowDialog(true)}
          title="새 연결 프로필 추가"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className={styles.list}>
        {activeConnections.length === 0 ? (
          <div className={styles.empty}>
            <p>연결된 서버가 없습니다.</p>
            <p>중앙 화면에서 서버를 선택하세요.</p>
          </div>
        ) : (
          activeConnections.map((conn) => {
            const isSelected = selectedSessionId === conn.sessionId;
            const shortName = conn.profile.name.split('/').pop() ?? conn.profile.name;
            return (
              <div
                key={conn.sessionId}
                className={`${styles.item} ${isSelected ? styles.selected : ''}`}
                onClick={() => setSelectedSession(conn.sessionId)}
                title={conn.profile.name}
              >
                <span className={styles.connDot} />
                <span className={styles.itemName}>{shortName}</span>
                <span className={styles.itemHost}>{conn.profile.hostname}</span>
                <div className={styles.itemActions}>
                  <button
                    className={styles.actionBtn}
                    title="터미널 열기"
                    onClick={(e) => {
                      e.stopPropagation();
                      createSession(conn.sessionId, shortName);
                    }}
                  >
                    _
                  </button>
                  <button
                    className={`${styles.actionBtn} ${styles.disconnect}`}
                    title="연결 해제"
                    onClick={(e) => {
                      e.stopPropagation();
                      disconnect(conn.sessionId);
                    }}
                  >
                    <WifiOff size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <NewConnectionDialog open={showDialog} onClose={() => setShowDialog(false)} />
    </div>
  );
}
