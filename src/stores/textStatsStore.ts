import { create } from 'zustand';
import type { TextStats } from '../utils/textStats';

export interface EditorStats {
  tabId: string;
  file: TextStats;
  line: TextStats;
  lineNumber: number;
  selection: TextStats | null;
  byteCounts?: { file: number | null; line: number | null; selection: number | null };
}

export const useTextStatsStore = create<{
  groups: Record<string, EditorStats>;
  update: (groupId: string, stats: EditorStats) => void;
  remove: (groupId: string) => void;
}>((set) => ({
  groups: {},
  update: (id, stats) => set((s) => ({ groups: { ...s.groups, [id]: stats } })),
  remove: (id) => set((s) => {
    const groups = { ...s.groups };
    delete groups[id];
    return { groups };
  }),
}));
