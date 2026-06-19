import { FolderOpen, Loader2, Plus, Server, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useConnectionStore } from '../../../stores/connectionStore';
import { useFileTreeStore } from '../../../stores/fileTreeStore';
import type { ConnectionProfile } from '../../../types';
import NewConnectionDialog from '../../Dialogs/NewConnectionDialog';
import styles from './WelcomeScreen.module.css';

const CANCEL_SHOW_DELAY = 3000;
const CONNECT_TIMEOUT = 30000;

function ConnectedEmptyState() {
  const { activeConnections, selectedSessionId } = useConnectionStore();
  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);

  return (
    <div className={styles.screen}>
      <div className={styles.appHeader}>
        <FolderOpen size={36} className={styles.appIcon} />
        <h1 className={styles.appTitle}>
          {conn ? conn.profile.name.split('/').pop() ?? conn.profile.name : '연결됨'}
        </h1>
        <p className={styles.appSub}>좌측 파일 트리에서 파일을 선택하세요</p>
      </div>
    </div>
  );
}

export default function WelcomeScreen() {
  const { profiles, activeConnections, selectedSessionId, connect } = useConnectionStore();
  const { setRootPath, loadDir } = useFileTreeStore();

  const [showDialog, setShowDialog] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const isConnected =
    !!selectedSessionId && activeConnections.some((c) => c.sessionId === selectedSessionId);

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  const handleCancel = () => {
    cancelledRef.current = true;
    clearTimers();
    setConnecting(null);
    setShowCancel(false);
  };

  const handleConnect = async (profile: ConnectionProfile, startPath?: string) => {
    cancelledRef.current = false;
    setConnecting(profile.id);
    setShowCancel(false);
    setError(null);

    timersRef.current.push(
      setTimeout(() => {
        if (!cancelledRef.current) setShowCancel(true);
      }, CANCEL_SHOW_DELAY)
    );
    timersRef.current.push(
      setTimeout(() => {
        if (!cancelledRef.current) {
          cancelledRef.current = true;
          setConnecting(null);
          setShowCancel(false);
          setError('연결 시간이 초과되었습니다 (30초).');
        }
      }, CONNECT_TIMEOUT)
    );

    try {
      const sessionId = await connect(profile);
      if (cancelledRef.current) return;
      const rootPath =
        startPath ?? profile.directories?.[0] ?? profile.lastPath ?? `/home/${profile.username || 'root'}`;
      setRootPath(sessionId, rootPath);
      await loadDir(sessionId, rootPath);
    } catch (e) {
      if (!cancelledRef.current) setError(String(e));
    } finally {
      clearTimers();
      if (!cancelledRef.current) {
        setConnecting(null);
        setShowCancel(false);
      }
    }
  };

  useEffect(() => () => clearTimers(), []);

  if (isConnected) {
    return <ConnectedEmptyState />;
  }

  return (
    <div className={styles.screen}>
      <div className={styles.appHeader}>
        <Server size={36} className={styles.appIcon} />
        <h1 className={styles.appTitle}>SSH Editor</h1>
        <p className={styles.appSub}>연결할 서버를 선택하세요</p>
      </div>

      {error && (
        <div className={styles.error} onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {connecting && (
        <div className={styles.connectingBanner}>
          <Loader2 size={16} className={styles.spinner} />
          <span>
            <strong>
              {profiles.find((p) => p.id === connecting)?.name ?? connecting}
            </strong>
            에 연결 중...
          </span>
          {showCancel && (
            <button className={styles.cancelBtn} onClick={handleCancel}>
              <X size={14} />
              취소
            </button>
          )}
        </div>
      )}

      {profiles.length === 0 ? (
        <div className={styles.empty}>
          <p>저장된 서버가 없습니다.</p>
          <p>아래 버튼으로 새 연결을 추가하세요.</p>
        </div>
      ) : (
        <div className={styles.connections}>
          <div className={styles.group}>
            <div className={styles.groupTitle}>저장된 서버</div>
            <div className={styles.cards}>
              {profiles.map((profile) => {
                const shortName = profile.name.split('/').pop() ?? profile.name;
                const isConn = connecting === profile.id;
                const dirs = profile.directories ?? [];
                return (
                  <div
                    key={profile.id}
                    className={`${styles.card} ${isConn ? styles.connecting : ''}`}
                  >
                    <button
                      className={styles.cardMain}
                      onClick={() => handleConnect(profile)}
                      disabled={!!connecting}
                    >
                      {isConn ? (
                        <Loader2 size={14} className={styles.cardSpinner} />
                      ) : (
                        <Server size={14} className={styles.cardIcon} />
                      )}
                      <span className={styles.cardName} title={profile.name}>
                        {shortName}
                      </span>
                      <span className={styles.cardMeta}>
                        {profile.username}@{profile.hostname}
                        {profile.port !== 22 ? `:${profile.port}` : ''}
                      </span>
                    </button>
                    {dirs.length > 0 && (
                      <div className={styles.dirChips}>
                        {dirs.map((dir) => (
                          <button
                            key={dir}
                            className={styles.dirChip}
                            onClick={() => handleConnect(profile, dir)}
                            disabled={!!connecting}
                            title={`${dir} 에서 열기`}
                          >
                            <FolderOpen size={11} />
                            {dir.split('/').filter(Boolean).pop() ?? dir}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <button className={styles.addBtn} onClick={() => setShowDialog(true)}>
        <Plus size={14} />
        새 서버 추가
      </button>

      <NewConnectionDialog open={showDialog} onClose={() => setShowDialog(false)} />
    </div>
  );
}
