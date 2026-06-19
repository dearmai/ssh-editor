import { create } from 'zustand';
import { terminalClose, terminalCreate } from '../ipc/commands';
import type { TerminalSessionInfo } from '../types';
import { log } from './logStore';

interface TerminalStore {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  isBottomPanelOpen: boolean;

  createSession: (connectionId: string, title?: string) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  setActiveSession: (id: string | null) => void;
  setTerminalTheme: (id: string, theme: 'dark' | 'light') => void;
  toggleBottomPanel: () => void;
  openBottomPanel: () => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isBottomPanelOpen: false,

  createSession: async (connectionId, title) => {
    try {
      const sessionId = await terminalCreate(connectionId, 80, 24);
      const info: TerminalSessionInfo = {
        id: sessionId,
        connectionId,
        title: title ?? `터미널 ${get().sessions.length + 1}`,
      };
      set((state) => ({
        sessions: [...state.sessions, info],
        activeSessionId: sessionId,
        isBottomPanelOpen: true,
      }));
      log.info(`터미널 생성: ${info.title}`);
      return sessionId;
    } catch (e) {
      log.error(`터미널 생성 실패: ${e}`);
      throw e;
    }
  },

  closeSession: async (sessionId) => {
    await terminalClose(sessionId);
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        activeSessionId = sessions[sessions.length - 1]?.id ?? null;
      }
      return {
        sessions,
        activeSessionId,
        isBottomPanelOpen: sessions.length > 0,
      };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  setTerminalTheme: (id, theme) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, theme } : s)),
    })),

  toggleBottomPanel: () => {
    set((state) => ({ isBottomPanelOpen: !state.isBottomPanelOpen }));
  },

  openBottomPanel: () => set({ isBottomPanelOpen: true }),
}));
