import * as Dialog from '@radix-ui/react-dialog';
import { Binary, Download, Eye, FileWarning, Pencil } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { formatBytes } from '../../utils/formatBytes';
import styles from './Dialog.module.css';

const icon = { verticalAlign: '-2px', marginRight: 4 } as const;

/** 바이너리·대용량 파일 열기 확인 (로컬/원격 공통, 한도는 환경설정 > 파일 열기) */
export default function OpenFileDialog() {
  const pending = useEditorStore((s) => s.pendingOpen);
  const resolveOpen = useEditorStore((s) => s.resolveOpen);

  const open = pending !== null;
  const isBinary = pending?.isBinary ?? false;
  const editable = pending?.editable ?? false;
  const remote = !!pending && pending.connectionId !== 'local';
  const size = formatBytes(pending?.size ?? 0);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && resolveOpen('cancel')}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>
              <FileWarning size={16} style={{ verticalAlign: '-3px', marginRight: 6, color: '#dcdcaa' }} />
              {isBinary ? '바이너리 파일' : '큰 파일'}
            </Dialog.Title>
          </div>

          <div className={styles.form}>
            <div className={styles.conflictMsg}>
              <strong>{pending?.entry.name}</strong> ({size})
              {isBinary
                ? ' 은(는) 텍스트 파일이 아닙니다. Hex 보기로 열까요?'
                : editable
                  ? ' 은(는) 큰 파일입니다. 편집기로 전체를 읽을지, 보기 모드로 일부만 읽을지 선택하세요.'
                  : ` 은(는) 편집기로 열 수 있는 한도(${formatBytes(pending?.largeLimit ?? 0)})보다 큽니다. 보기 모드로 일부만 읽어 엽니다.`}
            </div>

            <div className={styles.conflictActions}>
              {isBinary && (
                <button className={styles.conflictBtn} onClick={() => resolveOpen('hex')} autoFocus>
                  <span className={styles.conflictBtnTitle}><Binary size={13} style={icon} />Hex 보기로 열기</span>
                  <span className={styles.conflictBtnDesc}>읽기 전용 · 16KB씩 읽어 메모리를 적게 씁니다</span>
                </button>
              )}

              {!isBinary && (
                <button className={styles.conflictBtn} onClick={() => resolveOpen('view')} autoFocus>
                  <span className={styles.conflictBtnTitle}><Eye size={13} style={icon} />보기 모드로 열기</span>
                  <span className={styles.conflictBtnDesc}>
                    {remote
                      ? '읽기 전용 · 최근 부분을 보고 서버에서 검색하거나 tail 할 수 있습니다'
                      : '연속 스크롤 · 파일 전체 검색과 tail, 현재 위치의 구간 편집을 지원합니다'}
                  </span>
                </button>
              )}

              {editable && (
                <button className={styles.conflictBtn} onClick={() => resolveOpen('edit')}>
                  <span className={styles.conflictBtnTitle}><Pencil size={13} style={icon} />편집기로 열기</span>
                  <span className={styles.conflictBtnDesc}>파일 전체를 읽어 편집합니다 (메모리를 많이 쓰고 느릴 수 있음)</span>
                </button>
              )}

              {remote && (
                <button className={styles.conflictBtn} onClick={() => resolveOpen('download')}>
                  <span className={styles.conflictBtnTitle}><Download size={13} style={icon} />다운로드</span>
                  <span className={styles.conflictBtnDesc}>로컬에 저장 (하단 전송 탭에서 진행률 확인)</span>
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
