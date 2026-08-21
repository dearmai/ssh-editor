import { create } from 'zustand';
import {
  sftpCopyPath,
  sftpCreateDir,
  sftpCreateFile,
  sftpDeletePath,
  sftpExists,
  sftpListDir,
  sftpRenamePath,
} from '../ipc/commands';
import type { FileEntry } from '../types';

type ConnectionId = string;
type Path = string;

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

/** 파일명을 stem/확장자로 분리 (디렉토리는 확장자 없이 통째로 다룸) */
function splitExt(name: string, isDir: boolean): [string, string] {
  if (isDir) return [name, ''];
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

interface FileTreeStore {
  // connectionId → path → 자식 목록
  treeCache: Map<ConnectionId, Map<Path, FileEntry[]>>;
  // connectionId → 펼쳐진 경로 집합
  expandedPaths: Map<ConnectionId, Set<Path>>;
  // connectionId → 현재 루트 경로
  rootPaths: Map<ConnectionId, string>;
  // connectionId → 선택된 경로 (트리에서 선택 표시용)
  selectedPaths: Map<ConnectionId, Path>;
  loadingPaths: Set<string>; // `${connectionId}:${path}`

  // DnD: 드래그 중인 트리 항목 (WKWebView 는 dragover 중 dataTransfer 커스텀 데이터를
  // 노출하지 않으므로 스토어 상태로 전달)
  dragging: { connectionId: string; entry: FileEntry } | null;
  // DnD: 현재 드롭 대상 디렉토리 (하이라이트용)
  dropDir: Path | null;
  setDragging: (d: { connectionId: string; entry: FileEntry } | null) => void;
  setDropDir: (path: Path | null) => void;

  // 복사/붙여넣기 클립보드 (연결을 넘나드는 복사는 지원하지 않음)
  clipboard: { connectionId: string; path: string; name: string; isDir: boolean } | null;
  setClipboard: (c: { connectionId: string; path: string; name: string; isDir: boolean } | null) => void;

  loadDir: (connectionId: string, path: string) => Promise<FileEntry[]>;
  toggleExpand: (connectionId: string, path: string) => void;
  refreshDir: (connectionId: string, path: string) => Promise<void>;
  /** 해당 연결의 캐시를 모두 무효화하고 현재 열려있던 경로들을 다시 로드 (재접속 후 사용) */
  refreshConnection: (connectionId: string) => Promise<void>;
  setRootPath: (connectionId: string, path: string) => void;
  setSelected: (connectionId: string, path: string) => void;
  isSelected: (connectionId: string, path: string) => boolean;
  isExpanded: (connectionId: string, path: string) => boolean;
  getChildren: (connectionId: string, path: string) => FileEntry[] | undefined;
  isLoading: (connectionId: string, path: string) => boolean;

  // 파일 CRUD (캐시 무효화 포함)
  createFile: (connectionId: string, path: string) => Promise<void>;
  createDir: (connectionId: string, path: string) => Promise<void>;
  deletePath: (connectionId: string, path: string) => Promise<void>;
  renamePath: (connectionId: string, from: string, to: string) => Promise<void>;
  /** from 을 toDir 디렉토리 안으로 이동 (이름 유지). 원본·대상 디렉토리를 모두 새로 고침 */
  movePath: (connectionId: string, from: string, toDir: string) => Promise<void>;
  /** from 을 to 로 복사(재귀) */
  copyPath: (connectionId: string, from: string, to: string) => Promise<void>;
  /** 클립보드에 담긴 항목을 targetDir 안에 붙여넣기 (이름 충돌 시 "사본" 접미사 자동 부여) */
  pasteInto: (connectionId: string, targetDir: string) => Promise<void>;
  /** 같은 위치에 복제("사본" 접미사) */
  duplicatePath: (connectionId: string, path: string, isDir: boolean) => Promise<void>;
}

export const useFileTreeStore = create<FileTreeStore>((set, get) => ({
  treeCache: new Map(),
  expandedPaths: new Map(),
  rootPaths: new Map(),
  selectedPaths: new Map(),
  loadingPaths: new Set(),
  dragging: null,
  dropDir: null,
  clipboard: null,

  setDragging: (d) => set({ dragging: d }),
  setDropDir: (path) => set((s) => (s.dropDir === path ? s : { dropDir: path })),
  setClipboard: (c) => set({ clipboard: c }),

  loadDir: async (connectionId, path) => {
    const cacheKey = `${connectionId}:${path}`;
    const cached = get().treeCache.get(connectionId)?.get(path);
    if (cached) return cached;

    set((state) => {
      const next = new Set(state.loadingPaths);
      next.add(cacheKey);
      return { loadingPaths: next };
    });

    try {
      const entries = await sftpListDir(connectionId, path);
      set((state) => {
        const cache = new Map(state.treeCache);
        if (!cache.has(connectionId)) cache.set(connectionId, new Map());
        cache.get(connectionId)!.set(path, entries);
        const loading = new Set(state.loadingPaths);
        loading.delete(cacheKey);
        return { treeCache: cache, loadingPaths: loading };
      });
      return entries;
    } catch (e) {
      set((state) => {
        const loading = new Set(state.loadingPaths);
        loading.delete(cacheKey);
        return { loadingPaths: loading };
      });
      throw e;
    }
  },

  toggleExpand: (connectionId, path) => {
    set((state) => {
      const expanded = new Map(state.expandedPaths);
      if (!expanded.has(connectionId)) expanded.set(connectionId, new Set());
      const set_ = new Set(expanded.get(connectionId)!);
      if (set_.has(path)) {
        set_.delete(path);
      } else {
        set_.add(path);
      }
      expanded.set(connectionId, set_);
      return { expandedPaths: expanded };
    });
  },

  refreshDir: async (connectionId, path) => {
    // 캐시 무효화 후 재로딩
    set((state) => {
      const cache = new Map(state.treeCache);
      cache.get(connectionId)?.delete(path);
      return { treeCache: cache };
    });
    await get().loadDir(connectionId, path);
  },

  refreshConnection: async (connectionId) => {
    const cached = get().treeCache.get(connectionId);
    const paths = cached ? Array.from(cached.keys()) : [];
    // 캐시 초기화
    set((state) => {
      const cache = new Map(state.treeCache);
      cache.set(connectionId, new Map());
      return { treeCache: cache };
    });
    // 열려있던 모든 경로를 다시 로드 (개별 실패는 무시)
    await Promise.all(paths.map((p) => get().loadDir(connectionId, p).catch(() => {})));
  },

  setRootPath: (connectionId, path) => {
    set((state) => {
      const next = new Map(state.rootPaths);
      next.set(connectionId, path);
      return { rootPaths: next };
    });
  },

  setSelected: (connectionId, path) => {
    set((state) => {
      const next = new Map(state.selectedPaths);
      next.set(connectionId, path);
      return { selectedPaths: next };
    });
  },

  isSelected: (connectionId, path) => {
    return get().selectedPaths.get(connectionId) === path;
  },

  isExpanded: (connectionId, path) => {
    return get().expandedPaths.get(connectionId)?.has(path) ?? false;
  },

  getChildren: (connectionId, path) => {
    return get().treeCache.get(connectionId)?.get(path);
  },

  isLoading: (connectionId, path) => {
    return get().loadingPaths.has(`${connectionId}:${path}`);
  },

  createFile: async (connectionId, path) => {
    await sftpCreateFile(connectionId, path);
    const parentPath = path.split('/').slice(0, -1).join('/') || '/';
    await get().refreshDir(connectionId, parentPath);
  },

  createDir: async (connectionId, path) => {
    await sftpCreateDir(connectionId, path);
    const parentPath = path.split('/').slice(0, -1).join('/') || '/';
    await get().refreshDir(connectionId, parentPath);
  },

  deletePath: async (connectionId, path) => {
    await sftpDeletePath(connectionId, path);
    const parentPath = path.split('/').slice(0, -1).join('/') || '/';
    await get().refreshDir(connectionId, parentPath);
  },

  renamePath: async (connectionId, from, to) => {
    await sftpRenamePath(connectionId, from, to);
    const parentPath = from.split('/').slice(0, -1).join('/') || '/';
    await get().refreshDir(connectionId, parentPath);
  },

  movePath: async (connectionId, from, toDir) => {
    const name = from.split('/').pop() ?? from;
    const to = toDir.endsWith('/') ? `${toDir}${name}` : `${toDir}/${name}`;
    await sftpRenamePath(connectionId, from, to);
    const fromParent = from.split('/').slice(0, -1).join('/') || '/';
    await get().refreshDir(connectionId, fromParent);
    await get().refreshDir(connectionId, toDir);
  },

  copyPath: async (connectionId, from, to) => {
    await sftpCopyPath(connectionId, from, to);
    const parentPath = to.split('/').slice(0, -1).join('/') || '/';
    await get().refreshDir(connectionId, parentPath);
  },

  pasteInto: async (connectionId, targetDir) => {
    const clip = get().clipboard;
    if (!clip || clip.connectionId !== connectionId) return;
    const name = await uniqueName(connectionId, targetDir, clip.name, clip.isDir);
    await get().copyPath(connectionId, clip.path, joinPath(targetDir, name));
  },

  duplicatePath: async (connectionId, path, isDir) => {
    const dir = path.split('/').slice(0, -1).join('/') || '/';
    const name = path.split('/').pop() ?? path;
    const newName = await uniqueName(connectionId, dir, name, isDir);
    await get().copyPath(connectionId, path, joinPath(dir, newName));
  },
}));

/** dir 안에서 name 과 충돌하지 않는 이름을 찾는다. 충돌 시 "사본"/"사본 N" 접미사를 붙인다. */
async function uniqueName(
  connectionId: string,
  dir: string,
  name: string,
  isDir: boolean
): Promise<string> {
  const taken = (n: string) => sftpExists(connectionId, joinPath(dir, n)).catch(() => false);
  if (!(await taken(name))) return name;

  const [stem, ext] = splitExt(name, isDir);
  let candidate = `${stem} 사본${ext}`;
  let i = 2;
  while (await taken(candidate)) {
    candidate = `${stem} 사본 ${i}${ext}`;
    i++;
  }
  return candidate;
}
