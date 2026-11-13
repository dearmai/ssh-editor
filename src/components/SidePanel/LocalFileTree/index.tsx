import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Binary, ChevronDown, ChevronRight, File, Folder, FolderOpen, Lock, RefreshCw } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { localListDir } from '../../../ipc/commands';
import { useLocalWorkspaceStore } from '../../../stores/localWorkspaceStore';
import { useEditorStore } from '../../../stores/editorStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { runLocalCrypto } from '../../../utils/localCrypto';
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

/** 컨텍스트 메뉴 상단: 다중 선택이면 개수 표시 */
function SelectionHeader({ path }: { path: string }) {
  const count = useLocalWorkspaceStore((s) => (s.selectedPaths.includes(path) ? s.selectedPaths.length : 1));
  return count > 1 ? <div className={styles.contextHeader}>{count}개 항목 선택됨</div> : null;
}

function Entry({ entry, revision }: { entry: FileEntry; revision: number }) {
  const [expanded, setExpanded] = useState(false);
  const selected = useLocalWorkspaceStore((s) =>
    s.selectedPaths.length ? s.selectedPaths.includes(entry.path) : s.selectedPath === entry.path);
  const onOpen = async (e: ReactMouseEvent) => {
    const workspace = useLocalWorkspaceStore.getState();
    // Ctrl/Cmd+클릭: 다중 선택 토글 (열지 않음)
    if (e.ctrlKey || e.metaKey) { workspace.select(entry.path, true); return; }
    workspace.select(entry.path);
    if (entry.isDir) { setExpanded(!expanded); return; }
    try {
      await useEditorStore.getState().openFile('local', entry);
    } catch (err) { toastError(`파일 열기 실패: ${err}`); }
  };
  const cryptoEnabled = useSettingsStore((s) => s.localCryptoEnabled);
  /** 우클릭한 항목이 다중 선택에 포함되면 선택 전체, 아니면 그 항목만 */
  const cryptoTargets = () => {
    const { selectedPaths } = useLocalWorkspaceStore.getState();
    return selectedPaths.includes(entry.path) ? selectedPaths : [entry.path];
  };
  const onContextMenu = () => {
    const workspace = useLocalWorkspaceStore.getState();
    if (!workspace.selectedPaths.includes(entry.path)) workspace.select(entry.path);
  };
  const button = <button className={`${styles.entry} ${selected ? styles.selected : ''}`} onClick={(e) => void onOpen(e)} onContextMenu={onContextMenu} title={entry.path}>
    {entry.isDir ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className={styles.spacer} />}
    {entry.isDir ? <Folder size={14} /> : <File size={14} />}
    <span>{entry.name}</span>
  </button>;
  // 우클릭 메뉴: 파일은 Hex 보기, 기능이 켜져 있으면 보관/해제 (폴더는 보관/해제만)
  const hasMenu = !entry.isDir || cryptoEnabled;
  return <div role="treeitem" aria-expanded={entry.isDir ? expanded : undefined} aria-selected={selected}>
    {hasMenu ? <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{button}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={styles.contextMenu}>
          <SelectionHeader path={entry.path} />
          {!entry.isDir && (
            <ContextMenu.Item className={styles.contextItem} onSelect={() => useEditorStore.getState().openHex('local', entry)}>
              <Binary size={12} /> Hex 보기로 열기
            </ContextMenu.Item>
          )}
          {cryptoEnabled && (
            <ContextMenu.Item className={styles.contextItem} onSelect={() => void runLocalCrypto(cryptoTargets())}>
              <Lock size={12} /> 보관/해제
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root> : button}
    {entry.isDir && expanded && <div className={styles.children}><Directory path={entry.path} revision={revision} /></div>}
  </div>;
}

export default function LocalFileTree() {
  const root = useLocalWorkspaceStore((s) => s.root);
  const revision = useLocalWorkspaceStore((s) => s.revision);
  const refresh = useLocalWorkspaceStore((s) => s.refresh);
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
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  return <div className={styles.panel}>
    <div className={styles.toolbar}>
      <button onClick={() => void choose(true)} title="로컬 폴더 열기"><FolderOpen size={14} /> 폴더 열기</button>
      <button onClick={() => void choose(false)} title="로컬 파일 열기"><File size={14} /></button>
      <button onClick={() => refresh()} title="새로고침"><RefreshCw size={14} /></button>
    </div>
    {root && <>
      <div className={styles.path} title={root}>{root}</div>
      <div role="tree" aria-label="로컬 파일" className={styles.tree}><Directory key={root} path={root} revision={revision} /></div>
    </>}
  </div>;
}
