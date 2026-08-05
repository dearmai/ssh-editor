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
import { useEffect, useState, type DragEvent } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { sftpCheckWriteAccess, sftpExists } from '../../../ipc/commands';
import { useConnectionStore } from '../../../stores/connectionStore';
import { confirm } from '../../../stores/confirmStore';
import { log } from '../../../stores/logStore';
import { promptText } from '../../../stores/promptStore';
import { useEditorStore } from '../../../stores/editorStore';
import { useFileTreeStore } from '../../../stores/fileTreeStore';
import { useTransferStore } from '../../../stores/transferStore';
import type { ConnectionProfile, FileEntry } from '../../../types';
import NewConnectionDialog from '../../Dialogs/NewConnectionDialog';
import styles from './FileTreePanel.module.css';

/** 디렉토리 경로와 이름을 합쳐 절대 경로 생성 (루트 '/' 중복 슬래시 방지) */
function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/** 경로의 부모 디렉토리 */
function parentDir(path: string): string {
  return path.split('/').slice(0, -1).join('/') || '/';
}

/** 이 드래그를 트리가 받을 수 있는가 — 내부 트리 항목 또는 외부 파일(Finder 등)만 */
function canAcceptTreeDrop(e: DragEvent, connectionId: string): boolean {
  const { dragging } = useFileTreeStore.getState();
  if (dragging?.connectionId === connectionId) return true;
  return e.dataTransfer.types.includes('Files');
}

/** 내부 이동 시 대상 디렉토리가 유효한가 (제자리·자기 자신·자기 하위 제외) */
function isValidMoveTarget(connectionId: string, targetDir: string): boolean {
  const { dragging } = useFileTreeStore.getState();
  if (!dragging || dragging.connectionId !== connectionId) return true; // 외부 파일 드롭은 항상 유효
  const srcPath = dragging.entry.path;
  if (targetDir === srcPath || targetDir === parentDir(srcPath)) return false;
  if (dragging.entry.isDir && targetDir.startsWith(`${srcPath}/`)) return false;
  return true;
}

/** 트리 드롭 공통 처리 — 외부 파일이면 업로드, 내부 항목이면 확인 후 이동 */
async function handleTreeDrop(e: DragEvent, connectionId: string, targetDir: string) {
  const { dragging, setDragging, setDropDir, movePath } = useFileTreeStore.getState();
  setDropDir(null);

  // 외부 파일 드롭 → 업로드. File 객체는 drop 이벤트 안에서만 유효하므로 동기로 수집.
  // WKWebView 는 드롭 파일의 로컬 경로를 주지 않아 bytes 업로드 경로를 사용한다.
  if (e.dataTransfer.files.length > 0) {
    const files: File[] = [];
    let skippedDirs = 0;
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      if (item.webkitGetAsEntry?.()?.isDirectory) {
        skippedDirs++;
        continue;
      }
      const f = item.getAsFile();
      if (f) files.push(f);
    }
    if (skippedDirs > 0) {
      log.warn(`폴더 ${skippedDirs}개 건너뜀 — 폴더 드롭 업로드는 지원하지 않습니다`);
    }
    if (files.length > 0) {
      useTransferStore.getState().uploadDroppedFiles(connectionId, targetDir, files);
    }
    return;
  }

  // 내부 항목 이동
  if (!dragging || dragging.connectionId !== connectionId) return;
  const valid = isValidMoveTarget(connectionId, targetDir); // dragging 이 지워지기 전에 판정
  setDragging(null);
  if (!valid) return;
  const src = dragging.entry;
  const srcParent = parentDir(src.path);

  const ok = await confirm({
    title: '이동 확인',
    message: (
      <>
        <strong>{src.name}</strong> {src.isDir ? '폴더를' : '파일을'} 아래 위치로 이동할까요?
        <br />
        <strong>{targetDir}</strong>
      </>
    ),
    confirmLabel: '이동',
  });
  if (!ok) return;

  // 사전 점검 ① 이름 충돌 — SFTP rename 은 대상이 있으면 실패하므로 미리 안내
  const destPath = joinPath(targetDir, src.name);
  if (await sftpExists(connectionId, destPath).catch(() => false)) {
    log.error(`이동 불가: ${destPath} 가 이미 존재합니다`);
    await confirm({
      title: '이동 불가',
      message: `대상에 같은 이름이 이미 존재합니다: ${destPath}`,
      confirmLabel: '확인',
    });
    return;
  }
  // 사전 점검 ② 권한 — 원본 부모(항목 제거)·대상(항목 추가) 모두 쓰기 필요
  try {
    const [destOk, srcOk] = await Promise.all([
      sftpCheckWriteAccess(connectionId, targetDir),
      sftpCheckWriteAccess(connectionId, srcParent),
    ]);
    if (!destOk || !srcOk) {
      const where = destOk ? srcParent : targetDir;
      log.error(`이동 불가: ${where} 에 쓰기 권한이 없습니다`);
      await confirm({
        title: '이동 불가',
        message: `쓰기 권한이 없습니다: ${where}`,
        confirmLabel: '확인',
      });
      return;
    }
  } catch (err) {
    log.warn(`권한 사전 점검 실패, 이동 계속 시도: ${err}`);
  }

  try {
    await movePath(connectionId, src.path, targetDir);
    log.info(`이동: ${src.path} → ${destPath}`);
  } catch (err) {
    log.error(`이동 실패: ${src.name} — ${err}`);
  }
}

export default function FileTreePanel() {
  const { selectedSessionId, activeConnections, saveActiveDirectories } = useConnectionStore();
  const { rootPaths, loadDir, setRootPath, createFile, createDir, refreshConnection, dropDir, setDropDir } =
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
          <div
            className={`${styles.tree} ${dropDir === rootPath ? styles.treeDropActive : ''}`}
            onDragOver={(e) => {
              if (!canAcceptTreeDrop(e, selectedSessionId)) return;
              if (!isValidMoveTarget(selectedSessionId, rootPath)) {
                setDropDir(null);
                return;
              }
              e.preventDefault();
              setDropDir(rootPath);
            }}
            onDragLeave={(e) => {
              // 자식 요소로의 이동은 무시, 트리 밖으로 나갈 때만 하이라이트 해제
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropDir(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleTreeDrop(e, selectedSessionId, rootPath);
            }}
          >
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
              onSelect={async () => {
                const name = await promptText({ title: '새 파일', placeholder: '파일 이름' });
                if (name) createFile(selectedSessionId, joinPath(rootPath, name));
              }}
            >
              <FilePlus size={12} /> 새 파일
            </ContextMenu.Item>
            <ContextMenu.Item
              className={styles.contextItem}
              onSelect={async () => {
                const name = await promptText({ title: '새 폴더', placeholder: '폴더 이름' });
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
  const { profiles, connect, removeProfile } = useConnectionStore();
  const { setRootPath, loadDir } = useFileTreeStore();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<ConnectionProfile | null>(null);

  const handleDelete = async (p: ConnectionProfile) => {
    const ok = await confirm({
      title: '서버 삭제',
      message: (
        <>
          <strong>{p.name}</strong> 서버를 목록에서 삭제할까요?
        </>
      ),
      confirmLabel: '삭제',
      danger: true,
    });
    if (ok) removeProfile(p.id);
  };

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
            <div className={styles.serverRow}>
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
                <span className={styles.serverName}>{p.name}</span>
                <span className={styles.serverHost}>{p.hostname}</span>
              </button>
              <div className={styles.serverActions}>
                <button
                  className={styles.serverActionBtn}
                  onClick={(e) => { e.stopPropagation(); setEditTarget(p); }}
                  title="접속 정보 수정"
                >
                  <Pencil size={12} />
                </button>
                <button
                  className={styles.serverActionBtn}
                  onClick={(e) => { e.stopPropagation(); handleDelete(p); }}
                  title="서버 삭제"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
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
      <NewConnectionDialog
        open={!!editTarget}
        editProfile={editTarget}
        onClose={() => setEditTarget(null)}
      />
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
  const { getChildren, isExpanded, isLoading, loadDir, toggleExpand, refreshDir, createFile, createDir, deletePath, renamePath } =
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
            onRename={async () => {
              const newName = await promptText({
                title: '이름 변경',
                placeholder: '새 이름',
                defaultValue: entry.name,
              });
              if (newName && newName !== entry.name) {
                await renamePath(connectionId, entry.path, joinPath(parentDir(entry.path), newName));
              }
            }}
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
  onRename,
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
  onRename: () => void;
  onDelete: () => void;
}) {
  const { isExpanded, isLoading, isSelected, setSelected, dropDir, setDragging, setDropDir } =
    useFileTreeStore();
  const expanded = isExpanded(connectionId, entry.path);
  const loading = isLoading(connectionId, entry.path);
  const selected = isSelected(connectionId, entry.path);

  // 드롭 대상 디렉토리: 폴더 행이면 그 폴더, 파일 행이면 파일이 속한 폴더
  const dropTargetDir = entry.isDir ? entry.path : parentDir(entry.path);
  const isDropTarget = entry.isDir && dropDir === entry.path;

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
            className={`${styles.item} ${selected ? styles.selected : ''} ${isDropTarget ? styles.dropTarget : ''}`}
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={handleClick}
            draggable
            onDragStart={(e) => {
              // WKWebView 는 dragover 중 커스텀 dataTransfer 를 노출하지 않으므로 스토어로 전달
              e.dataTransfer.setData('text/plain', entry.path);
              e.dataTransfer.effectAllowed = 'move';
              setDragging({ connectionId, entry });
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropDir(null);
            }}
            onDragOver={(e) => {
              if (!canAcceptTreeDrop(e, connectionId)) return;
              if (!isValidMoveTarget(connectionId, dropTargetDir)) {
                e.stopPropagation();
                setDropDir(null);
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              setDropDir(dropTargetDir);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleTreeDrop(e, connectionId, dropTargetDir);
            }}
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
            onSelect={async () => {
              const name = await promptText({ title: '새 파일', placeholder: '파일 이름' });
              if (name) onCreateFile(name);
            }}
          >
            <FilePlus size={12} /> 새 파일
          </ContextMenu.Item>
          <ContextMenu.Item
            className={styles.contextItem}
            onSelect={async () => {
              const name = await promptText({ title: '새 폴더', placeholder: '폴더 이름' });
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
          <ContextMenu.Item className={styles.contextItem} onSelect={onRename}>
            <Pencil size={12} /> 이름 변경
          </ContextMenu.Item>
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
