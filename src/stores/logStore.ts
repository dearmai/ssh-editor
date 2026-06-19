import { create } from 'zustand';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  time: number;
  level: LogLevel;
  message: string;
}

interface LogStore {
  entries: LogEntry[];
  addLog: (level: LogLevel, message: string) => void;
  clear: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  entries: [],
  addLog: (level, message) =>
    set((state) => ({
      entries: [
        ...state.entries.slice(-500), // 최대 500개 보관
        { id: crypto.randomUUID(), time: Date.now(), level, message },
      ],
    })),
  clear: () => set({ entries: [] }),
}));

/** 스토어 밖(액션/유틸)에서도 호출 가능한 로그 헬퍼 */
export const log = {
  info: (msg: string) => useLogStore.getState().addLog('info', msg),
  warn: (msg: string) => useLogStore.getState().addLog('warn', msg),
  error: (msg: string) => useLogStore.getState().addLog('error', msg),
};
