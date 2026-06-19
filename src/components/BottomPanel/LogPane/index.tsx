import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLogStore } from '../../../stores/logStore';
import styles from './LogPane.module.css';

export default function LogPane() {
  const { entries, clear } = useLogStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <span className={styles.count}>{entries.length}개의 로그</span>
        <button className={styles.clearBtn} onClick={clear} title="로그 지우기">
          <Trash2 size={12} />
          지우기
        </button>
      </div>
      <div className={styles.list}>
        {entries.length === 0 ? (
          <div className={styles.empty}>로그가 없습니다.</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`${styles.entry} ${styles[entry.level]}`}>
              <span className={styles.time}>
                {new Date(entry.time).toLocaleTimeString('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span className={styles.level}>{entry.level.toUpperCase()}</span>
              <span className={styles.message}>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
