import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, LogOut, PlugZap, Unplug } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import styles from './Dialog.module.css';

export default function ReconnectDialog() {
  const reconnect = useConnectionStore((s) => s.reconnect);
  const resolveReconnect = useConnectionStore((s) => s.resolveReconnect);

  const open = reconnect !== null;
  const reconnecting = reconnect?.phase === 'reconnecting';

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>
              <Unplug size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: '#f48771' }} />
              서버 연결 끊김
            </Dialog.Title>
          </div>

          <div className={styles.form}>
            <div className={styles.conflictMsg}>
              <strong>{reconnect?.profileName}</strong> 서버와의 연결이 끊어졌습니다.
              {reconnecting
                ? ' 재접속을 시도하는 중입니다…'
                : ' 5초 안에 재접속하지 못했습니다. 어떻게 할까요?'}
            </div>

            {reconnecting ? (
              <div className={styles.reconnectingRow}>
                <Loader2 size={16} className={styles.spin} />
                재접속 중…
              </div>
            ) : (
              <div className={styles.conflictActions}>
                <button className={styles.conflictBtn} onClick={() => resolveReconnect('retry')}>
                  <span className={styles.conflictBtnTitle}>
                    <PlugZap size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                    재접속
                  </span>
                  <span className={styles.conflictBtnDesc}>다시 연결을 시도합니다</span>
                </button>

                <button
                  className={`${styles.conflictBtn} ${styles.danger}`}
                  onClick={() => resolveReconnect('close')}
                >
                  <span className={styles.conflictBtnTitle}>
                    <LogOut size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                    세션 종료
                  </span>
                  <span className={styles.conflictBtnDesc}>
                    이 서버의 탭·터미널을 닫고 연결을 정리합니다
                  </span>
                </button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
