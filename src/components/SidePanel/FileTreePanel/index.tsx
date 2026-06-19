import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useConnectionStore } from '../../../stores/connectionStore';
import { useEditorStore } from '../../../stores/editorStore';
import { useFileTreeStore } from '../../../stores/fileTreeStore';
import type { FileEntry } from '../../../types';
import styles from './FileTreePanel.module.css';

export default function FileTreePanel() {
  const { selectedSessionId, activeConnections } = useConnectionStore();
  const { rootPaths, loadDir, setRootPath } = useFileTreeStore();

  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);

  if (!selectedSessionId || !conn) {
    return (
      <div className={styles.empty}>
        <p>연결을 선택하세요.</p>
      </div>
    );
  }

  const rootPath = rootPaths.get(selectedSessionId) ?? '/';

  const handlePathChange = async (newPath: string) => {
    setRootPath(selectedSessionId, newPath);
    await loadDir(selectedSessionId, newPath);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <PathBar path={rootPath} onNavigate={handlePathChange} />
        <button
          className={styles.iconBtn}
          title="새로 고침"
          onClick={() => handlePathChange(rootPath)}
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <div className={styles.tree}>
        <FileTreeNode
          connectionId={selectedSessionId}
          path={rootPath}
          isRoot
        />
      </div>
    </div>
  );
}

function PathBar({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(path);

  const handleSubmit = () => {
    setEditing(false);
    if (value !== path) onNavigate(value);
  };

  if (editing) {
    return (
      <input
        className={styles.pathInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
      />
    );
  }

  return (
    <span className={styles.pathDisplay} onClick={() => { setValue(path); setEditing(true); }}>
      {path}
    </span>
  );
}

function FileTreeNode({
  connectionId,
  path,
  depth = 0,
  isRoot = false,
}: {
  connectionId: string;
  path: string;
  depth?: number;
  isRoot?: boolean;
}) {
  const { getChildren, isExpanded, isLoading, loadDir, toggleExpand, refreshDir, createFile, createDir, deletePath } =
    useFileTreeStore();
  const { openFile } = useEditorStore();

  const children = getChildren(connectionId, path);
  const expanded = isRoot || isExpanded(connectionId, path);
  const loading = isLoading(connectionId, path);

  // 루트는 자동으로 로드
  if (isRoot && !children && !loading) {
    loadDir(connectionId, path);
  }

  if (!expanded && !isRoot) return null;
  if (loading) {
    return <div className={styles.loading} style={{ paddingLeft: depth * 12 + 8 }}>로딩 중...</div>;
  }
  if (!children) return null;

  return (
    <div>
      {children.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          connectionId={connectionId}
          depth={depth}
          onOpen={() => !entry.isDir && openFile(connectionId, entry)}
          onToggle={async () => {
            if (entry.isDir) {
              if (!isExpanded(connectionId, entry.path)) {
                await loadDir(connectionId, entry.path);
              }
              toggleExpand(connectionId, entry.path);
            }
          }}
          onRefresh={() => refreshDir(connectionId, entry.path)}
          onCreateFile={async (name) => createFile(connectionId, `${entry.path}/${name}`)}
          onCreateDir={async (name) => createDir(connectionId, `${entry.path}/${name}`)}
          onDelete={() => deletePath(connectionId, entry.path)}
        />
      ))}
    </div>
  );
}

function FileTreeItem({
  entry,
  connectionId,
  depth,
  onOpen,
  onToggle,
  onRefresh,
  onCreateFile,
  onCreateDir,
  onDelete,
}: {
  entry: FileEntry;
  connectionId: string;
  depth: number;
  onOpen: () => void;
  onToggle: () => void;
  onRefresh: () => void;
  onCreateFile: (name: string) => Promise<void>;
  onCreateDir: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const { isExpanded, isLoading } = useFileTreeStore();
  const expanded = isExpanded(connectionId, entry.path);
  const loading = isLoading(connectionId, entry.path);

  const handleClick = () => {
    if (entry.isDir) {
      onToggle();
    } else {
      onOpen();
    }
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div>
          <div
            className={styles.item}
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={handleClick}
          >
            <span className={styles.chevron}>
              {entry.isDir ? (
                loading ? (
                  <RefreshCw size={12} className={styles.spin} />
                ) : expanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )
              ) : null}
            </span>
            <span className={styles.fileIcon}>
              {entry.isDir ? (
                expanded ? <FolderOpen size={14} /> : <Folder size={14} />
              ) : (
                <File size={14} />
              )}
            </span>
            <span className={styles.name}>{entry.name}</span>
          </div>
          {entry.isDir && expanded && (
            <FileTreeNode
              connectionId={connectionId}
              path={entry.path}
              depth={depth + 1}
            />
          )}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className={styles.contextMenu}>
          {entry.isDir && (
            <>
              <ContextMenu.Item
                className={styles.contextItem}
                onSelect={() => {
                  const name = prompt('파일 이름:');
                  if (name) onCreateFile(name);
                }}
              >
                <FilePlus size={12} /> 새 파일
              </ContextMenu.Item>
              <ContextMenu.Item
                className={styles.contextItem}
                onSelect={() => {
                  const name = prompt('폴더 이름:');
                  if (name) onCreateDir(name);
                }}
              >
                <FolderPlus size={12} /> 새 폴더
              </ContextMenu.Item>
              <ContextMenu.Item className={styles.contextItem} onSelect={onRefresh}>
                <RefreshCw size={12} /> 새로 고침
              </ContextMenu.Item>
              <ContextMenu.Separator className={styles.separator} />
            </>
          )}
          <ContextMenu.Item
            className={`${styles.contextItem} ${styles.danger}`}
            onSelect={onDelete}
          >
            <Trash2 size={12} /> 삭제
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
