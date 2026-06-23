import { create } from 'zustand';
import { sftpCreateDir, sftpCreateFile, sftpDeletePath, sftpListDir, sftpRenamePath } from '../ipc/commands';
import type { FileEntry } from '../types';

type ConnectionId = string;
type Path = string;

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
}

export const useFileTreeStore = create<FileTreeStore>((set, get) => ({
  treeCache: new Map(),
  expandedPaths: new Map(),
  rootPaths: new Map(),
  selectedPaths: new Map(),
  loadingPaths: new Set(),

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
}));
