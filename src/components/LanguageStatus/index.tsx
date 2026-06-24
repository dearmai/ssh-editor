import * as Dialog from '@radix-ui/react-dialog';
import { Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { LANGUAGES, languageLabel } from '../../utils/languages';
import styles from './LanguageStatus.module.css';

/** 상태바의 언어 모드 표시 + 검색 가능한 언어 선택 팔레트 (활성 에디터 탭 대상) */
export default function LanguageStatus() {
  // 활성 그룹의 활성 탭
  const activeTab = useEditorStore((s) => {
    const g = s.groupsById[s.activeGroupId];
    const id = g?.activeTabId;
    return id ? s.tabsById[id] : undefined;
  });
  const setTabLanguage = useEditorStore((s) => s.setTabLanguage);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter(
      (l) => l.label.toLowerCase().includes(q) || l.id.toLowerCase().includes(q)
    );
  }, [query]);

  // 검색어 바뀌면 선택 인덱스 초기화
  useEffect(() => setIndex(0), [query]);

  // 열릴 때 초기화
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  // 키보드 선택 시 해당 항목으로 스크롤
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [index, filtered]);

  if (!activeTab) return null;

  const pick = (id: string) => {
    setTabLanguage(activeTab.id, id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = filtered[index];
      if (sel) pick(sel.id);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className={styles.statusBtn} title="언어 모드 선택">
          {languageLabel(activeTab.language)}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Dialog.Title className={styles.srOnly}>언어 모드 선택</Dialog.Title>
          <input
            ref={inputRef}
            className={styles.search}
            placeholder="언어 검색 (이름 또는 id)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className={styles.list} ref={listRef}>
            {filtered.length === 0 && <div className={styles.empty}>일치하는 언어 없음</div>}
            {filtered.map((l, i) => {
              const current = l.id === activeTab.language;
              return (
                <button
                  key={l.id}
                  data-idx={i}
                  className={`${styles.item} ${i === index ? styles.itemActive : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(l.id)}
                >
                  <span className={styles.itemLabel}>{l.label}</span>
                  <span className={styles.itemId}>{l.id}</span>
                  {current && <Check size={13} className={styles.check} />}
                </button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
