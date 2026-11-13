import { create } from 'zustand';
import { localListDir } from '../ipc/commands';
import { useEditorStore } from './editorStore';
import { useSettingsStore } from './settingsStore';

interface LocalWorkspace {
  root: string | null;
  selectedPath: string | null;
  /** Ctrl/Cmd+클릭 다중 선택 (보관/보관 해제 대상) */
  selectedPaths: string[];
  /** 단일 선택(클릭) 또는 토글(Ctrl/Cmd+클릭) */
  select: (path: string, toggle?: boolean) => void;
  active: boolean;
  /** 트리 다시 읽기 카운터 */
  revision: number;
  /** 트리 새로 고침 (선택 경로 지정 가능) */
  refresh: (selectPath?: string) => void;
  show: (active: boolean) => void;
  openDirectory: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
}

export const useLocalWorkspaceStore = create<LocalWorkspace>((set) => ({
  root: null,
  selectedPath: null,
  selectedPaths: [],
  select: (path, toggle) =>
    set((s) => {
      if (!toggle) return { selectedPath: path, selectedPaths: [path] };
      const base = s.selectedPaths.length ? s.selectedPaths : s.selectedPath ? [s.selectedPath] : [];
      const selectedPaths = base.includes(path) ? base.filter((p) => p !== path) : [...base, path];
      return { selectedPaths, selectedPath: selectedPaths[selectedPaths.length - 1] ?? null };
    }),
  active: false,
  revision: 0,
  refresh: (selectPath) =>
    set((s) => ({
      revision: s.revision + 1,
      ...(selectPath ? { selectedPath: selectPath, selectedPaths: [selectPath] } : {}),
    })),
  show: (active) => set({ active }),
  openDirectory: async (path) => {
    await localListDir(path);
    set({ root: path, selectedPath: null, selectedPaths: [], active: true });
    useSettingsStore.getState().set('sidebarVisible', true);
  },
  openFile: async (path) => {
    const normalized = path.replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    const root = normalized.slice(0, slash + (slash === 0 || normalized[slash - 1] === ':' ? 1 : 0));
    const name = normalized.slice(slash + 1);
    // 파일 연결과 폴더 열기는 동일한 작업 폴더 상태를 사용한다.
    await localListDir(root);
    await useEditorStore.getState().openFile('local', {
      path: normalized, name, size: 0, isDir: false,
    });
    set({ root, selectedPath: normalized, selectedPaths: [normalized], active: true });
    useSettingsStore.getState().set('sidebarVisible', true);
  },
}));
