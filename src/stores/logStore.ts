import { create } from 'zustand';

export interface LogEntry {
  id: string;
  time: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface LogStore {
  entries: LogEntry[];
  addLog: (level: LogEntry['level'], message: string) => void;
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
