import { create } from 'zustand';
import { sftpProbe, sftpReadFile, sftpStat, sftpWriteFile } from '../ipc/commands';
import type { EditorTab, FileEntry } from '../types';
import { detectLanguage } from '../utils/languageDetect';
import { log } from './logStore';
import { useFileTreeStore } from './fileTreeStore';
import { useTransferStore } from './transferStore';

const LARGE_FILE_THRESHOLD = 1024 * 1024; // 1MB

export type SplitDirection = 'horizontal' | 'vertical';

export interface EditorGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

export interface SaveConflict {
  tabId: string;
  fileName: string;
  remoteMtime?: number;
  remoteSize: number;
}

export type ConflictResolution = 'overwrite' | 'backup' | 'saveAsBak' | 'cancel';

export interface PendingOpen {
  connectionId: string;
  entry: FileEntry;
  size: number;
  isBinary: boolean;
}

export type OpenResolution = 'open' | 'download' | 'cancel';

interface EditorStore {
  tabsById: Record<string, EditorTab>;
  groups: EditorGroup[]; // 1개 또는 2개
  activeGroupId: string;
  splitDirection: SplitDirection;
  conflict: SaveConflict | null;
  pendingOpen: PendingOpen | null;

  openFile: (connectionId: string, entry: FileEntry) => Promise<void>;
  resolveOpen: (mode: OpenResolution) => Promise<void>;
  closeTab: (groupId: string, tabId: string) => void;
  setActiveTab: (groupId: string, tabId: string) => void;
  setActiveGroup: (groupId: string) => void;
  updateContent: (tabId: string, content: string) => void;
  saveTab: (tabId: string) => Promise<void>;
  resolveConflict: (mode: ConflictResolution) => Promise<void>;
  splitActive: (direction: SplitDirection) => void;
  setSplitDirection: (direction: SplitDirection) => void;
  moveTab: (tabId: string, fromGroupId: string, toGroupId: string, toIndex?: number) => void;
  closeGroup: (groupId: string) => void;
}

function makeTabId(connectionId: string, path: string): string {
  return `${connectionId}:${path}`;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`;
}

/** tabId가 어느 그룹에도 남아있지 않으면 콘텐츠 삭제 */
function pruneTabs(tabsById: Record<string, EditorTab>, groups: EditorGroup[]) {
  const referenced = new Set(groups.flatMap((g) => g.tabIds));
  const next: Record<string, EditorTab> = {};
  for (const [id, tab] of Object.entries(tabsById)) {
    if (referenced.has(id)) next[id] = tab;
  }
  return next;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabsById: {},
  groups: [{ id: 'g1', tabIds: [], activeTabId: null }],
  activeGroupId: 'g1',
  splitDirection: 'horizontal',
  conflict: null,
  pendingOpen: null,

  openFile: async (connectionId, entry) => {
    const tabId = makeTabId(connectionId, entry.path);
    const state = get();

    // 이미 어딘가 열려 있으면 그 그룹으로 포커스
    const existingGroup = state.groups.find((g) => g.tabIds.includes(tabId));
    if (existingGroup) {
      set({
        activeGroupId: existingGroup.id,
        groups: state.groups.map((g) =>
          g.id === existingGroup.id ? { ...g, activeTabId: tabId } : g
        ),
      });
      return;
    }

    // 바이너리/대용량 검사 → 경고 다이얼로그
    const probe = await sftpProbe(connectionId, entry.path).catch(() => null);
    if (probe && (probe.isBinary || probe.size >= LARGE_FILE_THRESHOLD)) {
      set({ pendingOpen: { connectionId, entry, size: probe.size, isBinary: probe.isBinary } });
      return;
    }

    await performOpen(set, connectionId, entry);
  },

  resolveOpen: async (mode) => {
    const p = get().pendingOpen;
    set({ pendingOpen: null });
    if (!p || mode === 'cancel') return;
    if (mode === 'download') {
      useTransferStore.getState().downloadFile(p.connectionId, p.entry.path, p.entry.name);
      return;
    }
    // 강제로 열기 (바이너리면 실패할 수 있음)
    try {
      await performOpen(set, p.connectionId, p.entry);
    } catch (e) {
      log.error(`열기 실패: ${p.entry.path} — ${e}`);
    }
  },

  closeTab: (groupId, tabId) => {
    set((s) => {
      let groups = s.groups.map((g) => {
        if (g.id !== groupId) return g;
        const idx = g.tabIds.indexOf(tabId);
        const tabIds = g.tabIds.filter((t) => t !== tabId);
        let activeTabId = g.activeTabId;
        if (activeTabId === tabId) {
          activeTabId = tabIds[idx - 1] ?? tabIds[idx] ?? tabIds[tabIds.length - 1] ?? null;
        }
        return { ...g, tabIds, activeTabId };
      });

      // 빈 그룹이고 분할 상태면 그룹 제거(분할 해제)
      let activeGroupId = s.activeGroupId;
      if (groups.length > 1) {
        const empty = groups.find((g) => g.id === groupId && g.tabIds.length === 0);
        if (empty) {
          groups = groups.filter((g) => g.id !== groupId);
          if (activeGroupId === groupId) activeGroupId = groups[0].id;
        }
      }

      const tabsById = pruneTabs(s.tabsById, groups);
      return { groups, activeGroupId, tabsById };
    });
  },

  setActiveTab: (groupId, tabId) =>
    set((s) => ({
      activeGroupId: groupId,
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, activeTabId: tabId } : g)),
    })),

  setActiveGroup: (groupId) => set({ activeGroupId: groupId }),

  updateContent: (tabId, content) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, content, isDirty: true } } };
    }),

  saveTab: async (tabId) => {
    const tab = get().tabsById[tabId];
    if (!tab) return;

    try {
      // 외부 변경 감지
      const stat = await sftpStat(tab.connectionId, tab.remotePath).catch(() => null);
      const changedExternally =
        stat != null &&
        tab.baseMtime != null &&
        (stat.mtime !== tab.baseMtime || stat.size !== tab.baseSize);

      if (changedExternally) {
        log.warn(`외부 변경 감지: ${tab.remotePath} — 저장 보류`);
        set({
          conflict: {
            tabId,
            fileName: tab.fileName,
            remoteMtime: stat?.mtime,
            remoteSize: stat?.size ?? 0,
          },
        });
        return;
      }

      const newStat = await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content);
      set((s) => ({
        tabsById: {
          ...s.tabsById,
          [tabId]: { ...s.tabsById[tabId], isDirty: false, baseMtime: newStat.mtime, baseSize: newStat.size },
        },
      }));
      log.info(`저장됨: ${tab.remotePath}`);
    } catch (e) {
      log.error(`저장 실패: ${tab.remotePath} — ${e}`);
      throw e;
    }
  },

  resolveConflict: async (mode) => {
    const c = get().conflict;
    if (!c) return;
    const tab = get().tabsById[c.tabId];
    if (!tab) {
      set({ conflict: null });
      return;
    }

    try {
      if (mode === 'cancel') {
        // 보류만 해제
      } else if (mode === 'overwrite') {
        const st = await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content);
        set((s) => ({
          tabsById: {
            ...s.tabsById,
            [c.tabId]: { ...s.tabsById[c.tabId], isDirty: false, baseMtime: st.mtime, baseSize: st.size },
          },
        }));
        log.info(`덮어쓰기 저장: ${tab.remotePath}`);
      } else if (mode === 'backup') {
        // 원격의 현재(변경된) 파일을 .bak 으로 백업한 뒤 내 내용으로 덮어쓰기
        const bak = `${tab.remotePath}.bak.${timestamp()}`;
        const remoteCurrent = await sftpReadFile(tab.connectionId, tab.remotePath);
        await sftpWriteFile(tab.connectionId, bak, remoteCurrent);
        const st = await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content);
        set((s) => ({
          tabsById: {
            ...s.tabsById,
            [c.tabId]: { ...s.tabsById[c.tabId], isDirty: false, baseMtime: st.mtime, baseSize: st.size },
          },
        }));
        log.warn(`백업 후 덮어쓰기: ${bak} → ${tab.remotePath}`);
        refreshParent(tab.connectionId, tab.remotePath);
      } else if (mode === 'saveAsBak') {
        // 내 내용을 .bak 으로 저장하고 원본은 그대로 둠
        const bak = `${tab.remotePath}.bak.${timestamp()}`;
        await sftpWriteFile(tab.connectionId, bak, tab.content);
        log.warn(`다른 이름으로 저장: ${bak} (원본 유지)`);
        refreshParent(tab.connectionId, tab.remotePath);
      }
    } catch (e) {
      log.error(`충돌 해결 실패: ${e}`);
    } finally {
      set({ conflict: null });
    }
  },

  splitActive: (direction) => {
    set((s) => {
      if (s.groups.length >= 2) {
        return { splitDirection: direction };
      }
      const g1 = s.groups[0];
      if (!g1.activeTabId) return {};
      const g2: EditorGroup = {
        id: 'g2',
        tabIds: [g1.activeTabId],
        activeTabId: g1.activeTabId,
      };
      return { groups: [g1, g2], splitDirection: direction, activeGroupId: 'g2' };
    });
  },

  setSplitDirection: (direction) => set({ splitDirection: direction }),

  moveTab: (tabId, fromGroupId, toGroupId, toIndex) => {
    set((s) => {
      if (fromGroupId === toGroupId) {
        // 같은 그룹 내 순서 변경
        const groups = s.groups.map((g) => {
          if (g.id !== fromGroupId) return g;
          const without = g.tabIds.filter((t) => t !== tabId);
          const idx = toIndex == null ? without.length : Math.min(toIndex, without.length);
          without.splice(idx, 0, tabId);
          return { ...g, tabIds: without, activeTabId: tabId };
        });
        return { groups, activeGroupId: toGroupId };
      }

      let groups = s.groups.map((g) => {
        if (g.id === fromGroupId) {
          const tabIds = g.tabIds.filter((t) => t !== tabId);
          let activeTabId = g.activeTabId;
          if (activeTabId === tabId) activeTabId = tabIds[tabIds.length - 1] ?? null;
          return { ...g, tabIds, activeTabId };
        }
        if (g.id === toGroupId) {
          if (g.tabIds.includes(tabId)) return { ...g, activeTabId: tabId };
          const tabIds = [...g.tabIds];
          const idx = toIndex == null ? tabIds.length : Math.min(toIndex, tabIds.length);
          tabIds.splice(idx, 0, tabId);
          return { ...g, tabIds, activeTabId: tabId };
        }
        return g;
      });

      // 소스 그룹이 비고 분할 상태면 제거
      let activeGroupId = toGroupId;
      if (groups.length > 1) {
        const src = groups.find((g) => g.id === fromGroupId);
        if (src && src.tabIds.length === 0) {
          groups = groups.filter((g) => g.id !== fromGroupId);
        }
      }
      // 남은 그룹이 1개면 id를 g1으로 정규화
      if (groups.length === 1 && groups[0].id !== 'g1') {
        groups = [{ ...groups[0], id: 'g1' }];
        activeGroupId = 'g1';
      }

      return { groups, activeGroupId };
    });
  },

  closeGroup: (groupId) => {
    set((s) => {
      if (s.groups.length <= 1) return {};
      const groups = s.groups.filter((g) => g.id !== groupId);
      const normalized =
        groups.length === 1 && groups[0].id !== 'g1' ? [{ ...groups[0], id: 'g1' }] : groups;
      const tabsById = pruneTabs(s.tabsById, normalized);
      return { groups: normalized, activeGroupId: normalized[0].id, tabsById };
    });
  },
}));

function refreshParent(connectionId: string, path: string) {
  const parent = path.split('/').slice(0, -1).join('/') || '/';
  useFileTreeStore.getState().refreshDir(connectionId, parent).catch(() => {});
}

type SetFn = (
  partial:
    | Partial<EditorStore>
    | ((state: EditorStore) => Partial<EditorStore>)
) => void;

/** 실제 파일을 읽어 활성 그룹에 탭으로 연다 */
async function performOpen(set: SetFn, connectionId: string, entry: FileEntry) {
  const tabId = makeTabId(connectionId, entry.path);
  try {
    const [content, stat] = await Promise.all([
      sftpReadFile(connectionId, entry.path),
      sftpStat(connectionId, entry.path).catch(() => null),
    ]);
    const tab: EditorTab = {
      id: tabId,
      connectionId,
      remotePath: entry.path,
      fileName: entry.name,
      content,
      isDirty: false,
      language: detectLanguage(entry.path),
      baseMtime: stat?.mtime,
      baseSize: stat?.size,
    };
    set((s) => ({
      tabsById: { ...s.tabsById, [tabId]: tab },
      groups: s.groups.map((g) =>
        g.id === s.activeGroupId
          ? { ...g, tabIds: [...g.tabIds, tabId], activeTabId: tabId }
          : g
      ),
    }));
    log.info(`파일 열기: ${entry.path}`);
  } catch (e) {
    log.error(`파일 열기 실패: ${entry.path} — ${e}`);
    throw e;
  }
}
