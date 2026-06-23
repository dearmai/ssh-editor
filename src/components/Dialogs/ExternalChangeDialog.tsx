import * as Dialog from '@radix-ui/react-dialog';
import { RefreshCw, Save } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import styles from './Dialog.module.css';

export default function ExternalChangeDialog() {
  const ec = useEditorStore((s) => s.externalChange);
  const resolveExternalChange = useEditorStore((s) => s.resolveExternalChange);

  const open = ec !== null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && resolveExternalChange('cancel')}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>
              <RefreshCw
                size={16}
                style={{ verticalAlign: '-3px', marginRight: 6, color: '#dcdcaa' }}
              />
              파일이 서버에서 변경됨
            </Dialog.Title>
          </div>

          <div className={styles.form}>
            <div className={styles.conflictMsg}>
              <strong>{ec?.fileName}</strong> 파일이 이 에디터에서 연 이후 서버에서 변경되었습니다.
              {ec?.isDirty
                ? ' 편집 중인 내용이 있어 재로드하면 사라집니다. 어떻게 할까요?'
                : ' 어떻게 할까요?'}
            </div>

            <div className={styles.conflictActions}>
              <button className={styles.conflictBtn} onClick={() => resolveExternalChange('reload')}>
                <span className={styles.conflictBtnTitle}>
                  <RefreshCw size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  서버 버전으로 재로드
                </span>
                <span className={styles.conflictBtnDesc}>
                  서버의 최신 내용을 불러옵니다{ec?.isDirty ? ' (편집 중인 내용은 버려짐)' : ''}
                </span>
              </button>

              <button className={styles.conflictBtn} onClick={() => resolveExternalChange('backup')}>
                <span className={styles.conflictBtnTitle}>
                  <Save size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  백업 후 재로드
                </span>
                <span className={styles.conflictBtnDesc}>
                  내 현재 내용을 <code>.bak.타임스탬프</code> 로 저장한 뒤 서버 버전을 불러옵니다
                </span>
              </button>
            </div>

            <div className={styles.buttons}>
              <button className={styles.cancelBtn} onClick={() => resolveExternalChange('cancel')}>
                취소 (계속 편집)
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
