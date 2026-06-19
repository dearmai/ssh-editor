import * as Dialog from '@radix-ui/react-dialog';
import { Download, FileWarning } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import styles from './Dialog.module.css';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function OpenFileDialog() {
  const pending = useEditorStore((s) => s.pendingOpen);
  const resolveOpen = useEditorStore((s) => s.resolveOpen);

  const open = pending !== null;
  const isBinary = pending?.isBinary ?? false;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && resolveOpen('cancel')}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>
              <FileWarning size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: '#dcdcaa' }} />
              {isBinary ? '텍스트 파일이 아님' : '큰 파일'}
            </Dialog.Title>
          </div>

          <div className={styles.form}>
            <div className={styles.conflictMsg}>
              <strong>{pending?.entry.name}</strong> ({formatSize(pending?.size ?? 0)})
              {isBinary
                ? ' 은(는) 바이너리 파일로 보여 에디터에서 열 수 없습니다.'
                : ' 은(는) 1MB가 넘는 큰 파일입니다. 에디터가 느려질 수 있습니다.'}
              {' 어떻게 처리할까요?'}
            </div>

            <div className={styles.conflictActions}>
              <button className={styles.conflictBtn} onClick={() => resolveOpen('download')}>
                <span className={styles.conflictBtnTitle}>
                  <Download size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  다운로드
                </span>
                <span className={styles.conflictBtnDesc}>로컬에 저장 (하단 전송 탭에서 진행률 확인)</span>
              </button>

              {!isBinary && (
                <button className={styles.conflictBtn} onClick={() => resolveOpen('open')}>
                  <span className={styles.conflictBtnTitle}>그래도 열기</span>
                  <span className={styles.conflictBtnDesc}>에디터에서 강제로 엽니다</span>
                </button>
              )}
            </div>

            <div className={styles.buttons}>
              <button className={styles.cancelBtn} onClick={() => resolveOpen('cancel')}>
                취소
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
