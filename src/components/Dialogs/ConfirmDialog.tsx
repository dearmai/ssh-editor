import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { useConfirmStore } from '../../stores/confirmStore';
import styles from './Dialog.module.css';

export default function ConfirmDialog() {
  const current = useConfirmStore((s) => s.current);
  const respond = useConfirmStore((s) => s.respond);

  const open = current !== null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && respond(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>
              <AlertTriangle
                size={16}
                style={{ verticalAlign: '-3px', marginRight: 6, color: '#dcdcaa' }}
              />
              {current?.title}
            </Dialog.Title>
          </div>

          <div className={styles.form}>
            <div className={styles.conflictMsg}>{current?.message}</div>

            <div className={styles.buttons}>
              <button className={styles.cancelBtn} onClick={() => respond(false)} autoFocus>
                {current?.cancelLabel ?? '취소'}
              </button>
              <button
                className={`${styles.submitBtn} ${current?.danger ? styles.dangerBtn : ''}`}
                onClick={() => respond(true)}
              >
                {current?.confirmLabel ?? '확인'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
