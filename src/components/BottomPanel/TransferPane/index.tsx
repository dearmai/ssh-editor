import { CheckCircle2, Download, Loader2, Trash2, Upload, XCircle } from 'lucide-react';
import { useTransferStore, type Transfer } from '../../../stores/transferStore';
import styles from './TransferPane.module.css';

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function percent(t: Transfer): number {
  if (t.status === 'done') return 100;
  if (t.total <= 0) return 0;
  return Math.min(100, Math.round((t.transferred / t.total) * 100));
}

export default function TransferPane() {
  const transfers = useTransferStore((s) => s.transfers);
  const clearFinished = useTransferStore((s) => s.clearFinished);

  const ordered = [...transfers].reverse();

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <span className={styles.count}>{transfers.length}개의 전송</span>
        <button className={styles.clearBtn} onClick={clearFinished} title="완료/실패 항목 정리">
          <Trash2 size={12} />
          정리
        </button>
      </div>
      <div className={styles.list}>
        {ordered.length === 0 ? (
          <div className={styles.empty}>진행 중인 전송이 없습니다.</div>
        ) : (
          ordered.map((t) => {
            const p = percent(t);
            const indeterminate = t.status === 'active' && t.total <= 0;
            return (
              <div key={t.id} className={styles.item}>
                <span className={styles.icon}>
                  {t.status === 'active' ? (
                    <Loader2 size={13} className={styles.spin} />
                  ) : t.status === 'done' ? (
                    <CheckCircle2 size={13} className={styles.done} />
                  ) : t.status === 'error' ? (
                    <XCircle size={13} className={styles.error} />
                  ) : t.kind === 'upload' ? (
                    <Upload size={13} />
                  ) : (
                    <Download size={13} />
                  )}
                </span>
                <div className={styles.body}>
                  <div className={styles.row}>
                    <span className={styles.kind}>{t.kind === 'upload' ? '↑' : '↓'}</span>
                    <span className={styles.name} title={t.kind === 'upload' ? t.localPath : t.remotePath}>
                      {t.name}
                    </span>
                    <span className={styles.meta}>
                      {t.status === 'error'
                        ? '실패'
                        : t.status === 'queued'
                          ? '대기'
                          : t.total > 0
                            ? `${formatSize(t.transferred)} / ${formatSize(t.total)}`
                            : formatSize(t.transferred)}
                    </span>
                  </div>
                  <div className={styles.barTrack}>
                    <div
                      className={`${styles.barFill} ${indeterminate ? styles.indeterminate : ''} ${
                        t.status === 'error' ? styles.barError : ''
                      }`}
                      style={{ width: indeterminate ? '40%' : `${p}%` }}
                    />
                  </div>
                  {t.status === 'error' && t.error && (
                    <div className={styles.errMsg} title={t.error}>
                      {t.error}
                    </div>
                  )}
                </div>
                <span className={styles.pct}>{t.status === 'active' && !indeterminate ? `${p}%` : ''}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
