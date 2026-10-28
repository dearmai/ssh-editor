import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { File, Folder } from 'lucide-react';
import { localListDir, pathHome, sftpListDir } from '../../ipc/commands';
import { useEditorStore } from '../../stores/editorStore';
import { completionQuery, matchingEntries, resolveInputPath } from '../../utils/pathCompletion';
import type { FileEntry } from '../../types';
import styles from './Dialog.module.css';
import pathStyles from './PathOpenDialog.module.css';

export interface PathOpenTarget { connectionId: string; basePath: string; label: string }

export default function PathOpenDialog({ target, onClose }: { target: PathOpenTarget; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [home, setHome] = useState('');
  const [base, setBase] = useState('');
  const [results, setResults] = useState<{ query: string; entries: FileEntry[] }>({ query: '', entries: [] });
  const [selected, setSelected] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const openingRef = useRef(false);
  const list = (path: string) => target.connectionId === 'local' ? localListDir(path) : sftpListDir(target.connectionId, path);
  const entries = results.query === value ? results.entries : [];

  useEffect(() => {
    alive.current = true;
    let canceled = false;
    void pathHome(target.connectionId).then((directory) => {
      if (canceled) return;
      const start = resolveInputPath(target.basePath || directory, directory, directory);
      setHome(directory);
      setBase(start);
      setValue(start.endsWith('/') ? start : `${start}/`);
    }).catch((e) => {
      if (canceled) return;
      const start = target.basePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target.basePath) ? target.basePath : '/';
      setBase(start);
      setValue(start.endsWith('/') ? start : `${start}/`);
      setError(String(e));
    });
    return () => { canceled = true; alive.current = false; };
  }, [target]);

  useEffect(() => {
    if (!base) return;
    let canceled = false;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { directory, prefix } = completionQuery(value, base, home);
          const matches = matchingEntries(await list(directory), prefix);
          if (!canceled) setResults({ query: value, entries: matches });
        } catch (e) {
          if (!canceled) { setResults({ query: value, entries: [] }); setError(String(e)); }
        } finally {
          if (!canceled) setLoading(false);
        }
      })();
    }, 150);
    return () => { canceled = true; clearTimeout(timer); };
  }, [value, base, home, target.connectionId]);

  useEffect(() => {
    document.getElementById(`path-option-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const change = (next: string) => { setSelected(-1); setValue(next); setError(''); };
  const complete = (entry: FileEntry) => {
    change(entry.path + (entry.isDir && !entry.path.endsWith('/') ? '/' : ''));
    input.current?.focus();
  };
  const open = async (entry?: FileEntry) => {
    if (!base || openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError('');
    try {
      if (!entry) {
        const path = resolveInputPath(value, base, home);
        const { directory, prefix } = completionQuery(path, base, home);
        if (!prefix) { change(path.endsWith('/') ? path : `${path}/`); return; }
        entry = (await list(directory)).find((item) => item.name === prefix);
        if (!entry) throw new Error(`파일 또는 폴더를 찾을 수 없습니다: ${path}`);
      }
      if (!alive.current) return;
      if (entry.isDir) { complete(entry); return; }
      await useEditorStore.getState().openFile(target.connectionId, entry);
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      openingRef.current = false;
      if (alive.current) setOpening(false);
    }
  };

  return <Dialog.Root open onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={`${styles.content} ${pathStyles.content}`} onOpenAutoFocus={(e) => { e.preventDefault(); input.current?.focus(); }}>
        <div className={styles.header}><Dialog.Title className={styles.title}>경로로 파일 열기</Dialog.Title></div>
        <div className={styles.form}>
          <Dialog.Description className={styles.hint}>{target.label} · 절대 경로, 상대 경로, ~/ 지원</Dialog.Description>
          <input ref={input} value={value} readOnly={!base || opening} aria-label="파일 경로" role="combobox" aria-expanded={entries.length > 0}
            aria-controls="path-completions" aria-autocomplete="list" aria-activedescendant={selected >= 0 && entries[selected] ? `path-option-${selected}` : undefined}
            onChange={(e) => change(e.target.value)} placeholder="/etc/nginx/nginx.conf"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((old) => entries.length ? (old + (e.key === 'ArrowDown' ? 1 : old < 0 ? 0 : -1) + entries.length) % entries.length : -1);
              } else if (e.key === 'Tab' && !e.shiftKey && entries.length) {
                e.preventDefault(); complete(entries[Math.max(0, selected)]);
              } else if (e.key === 'Enter') {
                e.preventDefault(); void open(selected >= 0 ? entries[selected] : undefined);
              }
            }} />
          <div className={pathStyles.list} role="listbox" id="path-completions" aria-label="경로 자동완성" aria-busy={loading}>
            {entries.map((entry, index) => <div key={entry.path} id={`path-option-${index}`} role="option" aria-selected={index === selected}
              className={`${pathStyles.option} ${index === selected ? pathStyles.selected : ''}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { if (!opening) void open(entry); }}>
              {entry.isDir ? <Folder size={15} /> : <File size={15} />}<span>{entry.name}{entry.isDir ? '/' : ''}</span>
            </div>)}
          </div>
          {loading && <div className={styles.hint} role="status">경로 조회 중…</div>}
          {!loading && !entries.length && !error && <div className={styles.hint}>일치하는 파일이나 폴더가 없습니다.</div>}
          {error && <div className={styles.error} role="alert">{error}</div>}
          <div className={styles.hint}>↑↓ 선택 · Tab 경로 완성 · Enter 파일 열기 / 폴더 이동 · Esc 닫기</div>
          <div className={styles.buttons}>
            <button className={styles.cancelBtn} onClick={onClose}>취소</button>
            <button className={styles.submitBtn} disabled={!base || !value || opening} onClick={() => void open(selected >= 0 ? entries[selected] : undefined)}>{opening ? '여는 중…' : '열기'}</button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
