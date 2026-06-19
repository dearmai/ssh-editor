import { Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useLogStore, type LogLevel } from '../../../stores/logStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import styles from './LogPane.module.css';

const LEVEL_RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };
const FILTERS: { value: LogLevel | 'all'; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'info', label: 'Info+' },
  { value: 'warn', label: 'Warn+' },
  { value: 'error', label: 'Error' },
];

export default function LogPane() {
  const { entries, clear } = useLogStore();
  const filter = useSettingsStore((s) => s.logLevelFilter);
  const setFilter = useSettingsStore((s) => s.set);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = entries.filter((e) =>
    filter === 'all' ? true : LEVEL_RANK[e.level] >= LEVEL_RANK[filter]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visible.length]);

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              className={`${styles.filterBtn} ${filter === f.value ? styles.filterActive : ''}`}
              onClick={() => setFilter('logLevelFilter', f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className={styles.count}>{visible.length}건</span>
        <button className={styles.clearBtn} onClick={clear} title="로그 지우기">
          <Trash2 size={12} />
          지우기
        </button>
      </div>
      <div className={styles.list}>
        {visible.length === 0 ? (
          <div className={styles.empty}>로그가 없습니다.</div>
        ) : (
          visible.map((entry) => (
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
