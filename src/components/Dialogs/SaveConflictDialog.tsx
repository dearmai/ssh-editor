import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import styles from './Dialog.module.css';

export default function SaveConflictDialog() {
  const conflict = useEditorStore((s) => s.conflict);
  const resolveConflict = useEditorStore((s) => s.resolveConflict);

  const open = conflict !== null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && resolveConflict('cancel')}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>
              <AlertTriangle size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: '#dcdcaa' }} />
              파일이 외부에서 변경됨
            </Dialog.Title>
          </div>

          <div className={styles.form}>
            <div className={styles.conflictMsg}>
              <strong>{conflict?.fileName}</strong> 파일이 이 에디터에서 연 이후 서버에서 변경되었습니다.
              지금 저장하면 변경 사항을 덮어쓸 수 있습니다. 어떻게 처리할까요?
            </div>

            <div className={styles.conflictActions}>
              <button
                className={styles.conflictBtn}
                onClick={() => resolveConflict('backup')}
              >
                <span className={styles.conflictBtnTitle}>백업 후 덮어쓰기 (권장)</span>
                <span className={styles.conflictBtnDesc}>
                  서버의 현재 파일을 <code>.bak.타임스탬프</code> 로 백업한 뒤 내 내용으로 저장
                </span>
              </button>

              <button
                className={styles.conflictBtn}
                onClick={() => resolveConflict('saveAsBak')}
              >
                <span className={styles.conflictBtnTitle}>다른 이름(.bak)으로 저장</span>
                <span className={styles.conflictBtnDesc}>
                  내 내용을 <code>.bak.타임스탬프</code> 로 저장하고 원본은 그대로 둠
                </span>
              </button>

              <button
                className={`${styles.conflictBtn} ${styles.danger}`}
                onClick={() => resolveConflict('overwrite')}
              >
                <span className={styles.conflictBtnTitle}>그냥 덮어쓰기</span>
                <span className={styles.conflictBtnDesc}>서버의 변경 사항을 버리고 내 내용으로 덮어씀</span>
              </button>
            </div>

            <div className={styles.buttons}>
              <button className={styles.cancelBtn} onClick={() => resolveConflict('cancel')}>
                취소
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
