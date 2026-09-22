import { create } from 'zustand';
import { localListDir } from '../ipc/commands';
import { useEditorStore } from './editorStore';
import { useSettingsStore } from './settingsStore';

interface LocalWorkspace {
  root: string | null;
  selectedPath: string | null;
  active: boolean;
  show: (active: boolean) => void;
  openDirectory: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
}

export const useLocalWorkspaceStore = create<LocalWorkspace>((set) => ({
  root: null,
  selectedPath: null,
  active: false,
  show: (active) => set({ active }),
  openDirectory: async (path) => {
    await localListDir(path);
    set({ root: path, selectedPath: null, active: true });
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
    set({ root, selectedPath: normalized, active: true });
    useSettingsStore.getState().set('sidebarVisible', true);
  },
}));
