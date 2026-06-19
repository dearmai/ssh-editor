import { create } from 'zustand';
import { sftpReadFile, sftpWriteFile } from '../ipc/commands';
import type { EditorTab, FileEntry } from '../types';
import { detectLanguage } from '../utils/languageDetect';

interface EditorStore {
  tabs: EditorTab[];
  activeTabId: string | null;
  rightPaneTabId: string | null; // 스플릿 뷰 오른쪽 탭
  splitView: boolean;

  openFile: (connectionId: string, entry: FileEntry) => Promise<void>;
  closeTab: (tabId: string) => void;
  saveTab: (tabId: string) => Promise<void>;
  updateContent: (tabId: string, content: string) => void;
  setActiveTab: (tabId: string) => void;
  moveToSplit: (tabId: string) => void;
  closeSplitView: () => void;
}

function makeTabId(connectionId: string, path: string): string {
  return `${connectionId}:${path}`;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  rightPaneTabId: null,
  splitView: false,

  openFile: async (connectionId, entry) => {
    const tabId = makeTabId(connectionId, entry.path);
    const existing = get().tabs.find((t) => t.id === tabId);

    if (existing) {
      set({ activeTabId: tabId });
      return;
    }

    const content = await sftpReadFile(connectionId, entry.path);
    const tab: EditorTab = {
      id: tabId,
      connectionId,
      remotePath: entry.path,
      fileName: entry.name,
      content,
      isDirty: false,
      language: detectLanguage(entry.path),
    };

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tabId,
    }));
  },

  closeTab: (tabId) => {
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== tabId);
      let activeTabId = state.activeTabId;
      let rightPaneTabId = state.rightPaneTabId;

      if (activeTabId === tabId) {
        const idx = state.tabs.findIndex((t) => t.id === tabId);
        activeTabId = tabs[idx - 1]?.id ?? tabs[0]?.id ?? null;
      }
      if (rightPaneTabId === tabId) {
        rightPaneTabId = null;
      }

      return {
        tabs,
        activeTabId,
        rightPaneTabId,
        splitView: rightPaneTabId ? state.splitView : false,
      };
    });
  },

  saveTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content);
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: false } : t
      ),
    }));
  },

  updateContent: (tabId, content) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t
      ),
    }));
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  moveToSplit: (tabId) => {
    set({ rightPaneTabId: tabId, splitView: true });
  },

  closeSplitView: () => {
    set({ splitView: false, rightPaneTabId: null });
  },
}));
