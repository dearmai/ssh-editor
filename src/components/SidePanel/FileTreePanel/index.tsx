import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Download,
  FileArchive,
  Folders,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useConnectionStore } from '../../../stores/connectionStore';
import { confirm } from '../../../stores/confirmStore';
import { useEditorStore } from '../../../stores/editorStore';
import { useFileTreeStore } from '../../../stores/fileTreeStore';
import { useTransferStore } from '../../../stores/transferStore';
import type { ConnectionProfile, FileEntry } from '../../../types';
import styles from './FileTreePanel.module.css';

/** 디렉토리 경로와 이름을 합쳐 절대 경로 생성 (루트 '/' 중복 슬래시 방지) */
function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/** 경로의 부모 디렉토리 */
function parentDir(path: string): string {
  return path.split('/').slice(0, -1).join('/') || '/';
}

export default function FileTreePanel() {
  const { selectedSessionId, activeConnections, saveActiveDirectories } = useConnectionStore();
  const { rootPaths, loadDir, setRootPath, createFile, createDir, refreshConnection } =
    useFileTreeStore();
  const [editingPath, setEditingPath] = useState(false);

  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);

  if (!selectedSessionId || !conn) {
    return <EmptyServerList />;
  }

  const rootPath = rootPaths.get(selectedSessionId) ?? '/';
  const dirs = conn.profile.directories ?? [];
  const isSavedBase = dirs.includes(rootPath);

  const handlePathChange = async (newPath: string) => {
    const p = newPath.trim() || '/';
    setRootPath(selectedSessionId, p);
    await loadDir(selectedSessionId, p);
  };

  // 새로 고침: 캐시를 무효화하고 열려있는 디렉토리들을 다시 로드 (loadDir는 캐시가 있으면 그대로 반환하므로 필요)
  const refreshTree = () => refreshConnection(selectedSessionId);

  const addCurrentAsBase = () => {
    if (dirs.includes(rootPath)) return;
    saveActiveDirectories(selectedSessionId, [...dirs, rootPath]);
  };
  const removeBase = (dir: string) => {
    saveActiveDirectories(
      selectedSessionId,
      dirs.filter((d) => d !== dir)
    );
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.iconBtn} title="시작 디렉토리 관리">
              <Folders size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={styles.dirMenu} sideOffset={4} align="start">
              <div className={styles.dirMenuTitle}>시작 디렉토리</div>
              {dirs.length === 0 && (
                <div className={styles.dirEmpty}>저장된 디렉토리가 없습니다</div>
              )}
              {dirs.map((dir) => (
                <div key={dir} className={styles.dirRow}>
                  <button
                    className={styles.dirRowMain}
                    onClick={() => handlePathChange(dir)}
                    title={dir}
                  >
                    <span className={styles.dirCheck}>
                      {rootPath === dir && <Check size={12} />}
                    </span>
                    <FolderOpen size={12} />
                    <span className={styles.dirText}>{dir}</span>
                  </button>
                  <button
                    className={styles.dirRemove}
                    onClick={() => removeBase(dir)}
                    title="목록에서 제거"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className={styles.separator} />
              <DropdownMenu.Item
                className={`${styles.dirMenuItem} ${isSavedBase ? styles.disabled : ''}`}
                disabled={isSavedBase}
                onSelect={addCurrentAsBase}
              >
                <Plus size={12} /> 현재 폴더를 시작 디렉토리로 추가
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dirMenuItem}
                onSelect={() => setTimeout(() => setEditingPath(true), 0)}
              >
                <Pencil size={12} /> 경로 직접 입력…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <PathBar
          path={rootPath}
          editing={editingPath}
          setEditing={setEditingPath}
          onNavigate={handlePathChange}
        />
        <button
          className={styles.iconBtn}
          title="이 디렉토리에 파일 업로드"
          onClick={() => useTransferStore.getState().uploadFiles(selectedSessionId, rootPath)}
        >
          <Upload size={13} />
        </button>
        <button className={styles.iconBtn} title="새로 고침" onClick={refreshTree}>
          <RefreshCw size={13} />
        </button>
      </div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div className={styles.tree}>
            <FileTreeNode connectionId={selectedSessionId} path={rootPath} isRoot />
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={styles.contextMenu}>
            <div className={styles.contextHeader} title={rootPath}>
              {rootPath}
            </div>
            <ContextMenu.Item
              className={styles.contextItem}
              onSelect={() => {
                const name = prompt('새 파일 이름:');
                if (name) createFile(selectedSessionId, joinPath(rootPath, name));
              }}
            >
              <FilePlus size={12} /> 새 파일
            </ContextMenu.Item>
            <ContextMenu.Item
              className={styles.contextItem}
              onSelect={() => {
                const name = prompt('새 폴더 이름:');
                if (name) createDir(selectedSessionId, joinPath(rootPath, name));
              }}
            >
              <FolderPlus size={12} /> 새 폴더
            </ContextMenu.Item>
            <ContextMenu.Separator className={styles.separator} />
            <ContextMenu.Item
              className={styles.contextItem}
              onSelect={() =>
                useTransferStore.getState().uploadFiles(selectedSessionId, rootPath)
              }
            >
              <Upload size={12} /> 파일 업로드
            </ContextMenu.Item>
            <ContextMenu.Item className={styles.contextItem} onSelect={refreshTree}>
              <RefreshCw size={12} /> 새로 고침
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}

function EmptyServerList() {
  const { profiles, connect } = useConnectionStore();
  const { setRootPath, loadDir } = useFileTreeStore();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (profile: ConnectionProfile, startPath?: string) => {
    setConnecting(profile.id);
    setError(null);
    try {
      const rootPath =
        startPath ?? profile.directories?.[0] ?? profile.lastPath ?? `/home/${profile.username || 'root'}`;
      const sessionId = await connect(profile, rootPath);
      setRootPath(sessionId, rootPath);
      await loadDir(sessionId, rootPath);
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(null);
    }
  };

  if (profiles.length === 0) {
    return (
      <div className={styles.empty}>
        <p>연결된 서버가 없습니다.</p>
        <p>중앙 화면에서 새 연결을 추가하세요.</p>
      </div>
    );
  }

  return (
    <div className={styles.serverList}>
      <div className={styles.serverListTitle}>저장된 서버</div>
      {error && (
        <div className={styles.serverError} onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {profiles.map((p) => {
        const dirs = p.directories ?? [];
        return (
          <div key={p.id} className={styles.serverGroup}>
            <button
              className={styles.serverItem}
              onClick={() => handleConnect(p)}
              disabled={!!connecting}
              title={`${p.username}@${p.hostname}`}
            >
              {connecting === p.id ? (
                <Loader2 size={13} className={styles.spin} />
              ) : (
                <Server size={13} />
              )}
              <span className={styles.serverName}>{p.name.split('/').pop() ?? p.name}</span>
              <span className={styles.serverHost}>{p.hostname}</span>
            </button>
            {dirs.length > 0 && (
              <div className={styles.serverDirs}>
                {dirs.map((dir) => (
                  <button
                    key={dir}
                    className={styles.serverDirChip}
                    onClick={() => handleConnect(p, dir)}
                    disabled={!!connecting}
                    title={`${dir} 에서 열기`}
                  >
                    <FolderOpen size={10} />
                    {dir.split('/').filter(Boolean).pop() ?? dir}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PathBar({
  path,
  editing,
  setEditing,
  onNavigate,
}: {
  path: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onNavigate: (p: string) => void;
}) {
  const [value, setValue] = useState(path);

  // 외부에서 경로가 바뀌면 입력값도 동기화
  useEffect(() => {
    setValue(path);
  }, [path]);

  const handleSubmit = () => {
    setEditing(false);
    if (value.trim() !== path) onNavigate(value);
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
          if (e.key === 'Escape') {
            setValue(path);
            setEditing(false);
          }
        }}
        autoFocus
      />
    );
  }

  return (
    <span
      className={styles.pathDisplay}
      onClick={() => {
        setValue(path);
        setEditing(true);
      }}
      title="클릭하여 base 디렉토리 경로 편집"
    >
      <Pencil size={10} className={styles.pathEditIcon} />
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
      {children.map((entry) => {
        // 파일이면 같은 폴더(부모)에, 디렉토리면 그 안에 생성
        const targetDir = entry.isDir ? entry.path : parentDir(entry.path);
        return (
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
            onCreateFile={async (name) => createFile(connectionId, joinPath(targetDir, name))}
            onCreateDir={async (name) => createDir(connectionId, joinPath(targetDir, name))}
            onDelete={async () => {
              const ok = await confirm({
                title: '삭제 확인',
                message: (
                  <>
                    <strong>{entry.name}</strong>
                    {entry.isDir ? ' 폴더와 그 안의 모든 항목을' : ' 파일을'} 삭제할까요?
                    <br />이 작업은 되돌릴 수 없습니다.
                  </>
                ),
                confirmLabel: '삭제',
                danger: true,
              });
              if (ok) deletePath(connectionId, entry.path);
            }}
          />
        );
      })}
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
  const { isExpanded, isLoading, isSelected, setSelected } = useFileTreeStore();
  const expanded = isExpanded(connectionId, entry.path);
  const loading = isLoading(connectionId, entry.path);
  const selected = isSelected(connectionId, entry.path);

  const handleClick = () => {
    setSelected(connectionId, entry.path);
    if (entry.isDir) {
      onToggle();
    } else {
      onOpen();
    }
  };

  return (
    <ContextMenu.Root
      onOpenChange={(open) => {
        // 우클릭으로 메뉴가 열릴 때도 해당 항목을 선택 표시
        if (open) setSelected(connectionId, entry.path);
      }}
    >
      <ContextMenu.Trigger asChild>
        {/* stopPropagation: 상위(루트) 컨텍스트 메뉴가 동시에 열리는 것을 방지 */}
        <div onContextMenu={(e) => e.stopPropagation()}>
          <div
            className={`${styles.item} ${selected ? styles.selected : ''}`}
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
          {/* 새 파일/폴더 — 디렉토리면 그 안에, 파일이면 같은 폴더에 생성 */}
          <ContextMenu.Item
            className={styles.contextItem}
            onSelect={() => {
              const name = prompt('새 파일 이름:');
              if (name) onCreateFile(name);
            }}
          >
            <FilePlus size={12} /> 새 파일
          </ContextMenu.Item>
          <ContextMenu.Item
            className={styles.contextItem}
            onSelect={() => {
              const name = prompt('새 폴더 이름:');
              if (name) onCreateDir(name);
            }}
          >
            <FolderPlus size={12} /> 새 폴더
          </ContextMenu.Item>
          {entry.isDir && (
            <ContextMenu.Item className={styles.contextItem} onSelect={onRefresh}>
              <RefreshCw size={12} /> 새로 고침
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className={styles.separator} />

          {/* 다운로드 */}
          {entry.isDir ? (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={styles.contextItem}>
                <FileArchive size={12} /> 다운로드 (압축)
                <ChevronRight size={12} style={{ marginLeft: 'auto' }} />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={styles.contextMenu}>
                  <ContextMenu.Item
                    className={styles.contextItem}
                    onSelect={() =>
                      useTransferStore.getState().downloadDir(connectionId, entry.path, entry.name, 'zip')
                    }
                  >
                    ZIP (.zip)
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={styles.contextItem}
                    onSelect={() =>
                      useTransferStore.getState().downloadDir(connectionId, entry.path, entry.name, 'targz')
                    }
                  >
                    TAR.GZ (.tar.gz)
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={styles.contextItem}
                    onSelect={() =>
                      useTransferStore.getState().downloadDir(connectionId, entry.path, entry.name, 'tarxz')
                    }
                  >
                    TAR.XZ (.tar.xz)
                  </ContextMenu.Item>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          ) : (
            <ContextMenu.Item
              className={styles.contextItem}
              onSelect={() =>
                useTransferStore.getState().downloadFile(connectionId, entry.path, entry.name)
              }
            >
              <Download size={12} /> 다운로드
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator className={styles.separator} />
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
