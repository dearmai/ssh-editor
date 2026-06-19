import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import styles from './Dialog.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>환경설정</Dialog.Title>
            <Dialog.Close className={styles.closeBtn}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div style={{ padding: '20px', color: 'var(--text-muted)', fontSize: 13 }}>
            설정 항목이 곧 추가됩니다.
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
