import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { localListDir } from '../../../ipc/commands';
import { useLocalWorkspaceStore } from '../../../stores/localWorkspaceStore';
import { useEditorStore } from '../../../stores/editorStore';
import { toastError } from '../../../stores/toastStore';
import type { FileEntry } from '../../../types';
import styles from './LocalFileTree.module.css';

function Directory({ path, revision }: { path: string; revision: number }) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    localListDir(path).then((items) => {
      if (!cancelled) { setEntries(items); setError(''); }
    }).catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [path, revision]);
  return <div role="group">
    {error && <div className={styles.error}>{error}</div>}
    {entries.map((entry) => <Entry key={entry.path} entry={entry} revision={revision} />)}
  </div>;
}

function Entry({ entry, revision }: { entry: FileEntry; revision: number }) {
  const [expanded, setExpanded] = useState(false);
  const selected = useLocalWorkspaceStore((s) => s.selectedPath === entry.path);
  const onOpen = async () => {
    if (entry.isDir) { setExpanded(!expanded); return; }
    try {
      await useEditorStore.getState().openFile('local', entry);
      useLocalWorkspaceStore.setState({ selectedPath: entry.path });
    } catch (e) { toastError(`파일 열기 실패: ${e}`); }
  };
  return <div role="treeitem" aria-expanded={entry.isDir ? expanded : undefined} aria-selected={selected}>
    <button className={`${styles.entry} ${selected ? styles.selected : ''}`} onClick={() => void onOpen()} title={entry.path}>
      {entry.isDir ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className={styles.spacer} />}
      {entry.isDir ? <Folder size={14} /> : <File size={14} />}
      <span>{entry.name}</span>
    </button>
    {entry.isDir && expanded && <div className={styles.children}><Directory path={entry.path} revision={revision} /></div>}
  </div>;
}

export default function LocalFileTree() {
  const root = useLocalWorkspaceStore((s) => s.root);
  const [revision, setRevision] = useState(0);
  const choose = async (directory: boolean) => {
    try {
      const path = await open({ directory, multiple: false, title: directory ? '로컬 폴더 열기' : '로컬 파일 열기' });
      if (typeof path === 'string') {
        const workspace = useLocalWorkspaceStore.getState();
        await (directory ? workspace.openDirectory(path) : workspace.openFile(path));
      }
    } catch (e) { toastError(`열기 실패: ${e}`); }
  };
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return <div className={styles.panel}>
    <div className={styles.toolbar}>
      <button onClick={() => void choose(true)} title="로컬 폴더 열기"><FolderOpen size={14} /> 폴더 열기</button>
      <button onClick={() => void choose(false)} title="로컬 파일 열기"><File size={14} /></button>
      <button onClick={() => setRevision((n) => n + 1)} title="새로고침"><RefreshCw size={14} /></button>
    </div>
    {root && <>
      <div className={styles.path} title={root}>{root}</div>
      <div role="tree" aria-label="로컬 파일" className={styles.tree}><Directory key={root} path={root} revision={revision} /></div>
    </>}
  </div>;
}
