import { create } from 'zustand';
import { sftpProbe, sftpReadFile, sftpStat, sftpWriteFile } from '../ipc/commands';
import type { EditorTab, FileEntry } from '../types';
import { detectLanguage } from '../utils/languageDetect';
import { log } from './logStore';
import { useFileTreeStore } from './fileTreeStore';
import { useTransferStore } from './transferStore';

const LARGE_FILE_THRESHOLD = 1024 * 1024; // 1MB

export type SplitDirection = 'horizontal' | 'vertical';
export type DropSide = 'left' | 'right' | 'top' | 'bottom';

export interface EditorGroup {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

/** 분할 레이아웃 트리. leaf=그룹 하나, split=방향별 자식 묶음 (N개 분할·혼합 그리드 지원) */
export type LayoutNode =
  | { type: 'leaf'; groupId: string }
  | { type: 'split'; direction: SplitDirection; children: LayoutNode[] };

export interface SaveConflict {
  tabId: string;
  fileName: string;
  remoteMtime?: number;
  remoteSize: number;
}

export type ConflictResolution = 'overwrite' | 'backup' | 'saveAsBak' | 'cancel';

/** 편집 창 포커스 시 감지된 서버 측 외부 변경 */
export interface ExternalChange {
  tabId: string;
  fileName: string;
  remoteMtime?: number;
  remoteSize: number;
  isDirty: boolean;
}

export type ExternalResolution = 'reload' | 'backup' | 'cancel';

export interface PendingOpen {
  connectionId: string;
  entry: FileEntry;
  size: number;
  isBinary: boolean;
}

export type OpenResolution = 'open' | 'download' | 'cancel';

interface EditorStore {
  tabsById: Record<string, EditorTab>;
  groupsById: Record<string, EditorGroup>;
  layout: LayoutNode;
  activeGroupId: string;
  conflict: SaveConflict | null;
  pendingOpen: PendingOpen | null;
  externalChange: ExternalChange | null;
  /** 진행 중인 탭 드래그 정보 (WKWebView가 dataTransfer 커스텀 타입을 노출 안 하므로 스토어로 전달) */
  draggingTab: { tabId: string; fromGroupId: string } | null;

  openFile: (connectionId: string, entry: FileEntry) => Promise<void>;
  resolveOpen: (mode: OpenResolution) => Promise<void>;
  closeTab: (groupId: string, tabId: string) => void;
  closeOtherTabs: (groupId: string, keepTabId: string) => void;
  closeTabsInGroup: (groupId: string) => void;
  setActiveTab: (groupId: string, tabId: string) => void;
  setActiveGroup: (groupId: string) => void;
  updateContent: (tabId: string, content: string) => void;
  /** 탭의 구문 강조 언어를 수동 변경 (상태바 언어 선택) */
  setTabLanguage: (tabId: string, language: string) => void;
  saveTab: (tabId: string) => Promise<void>;
  resolveConflict: (mode: ConflictResolution) => Promise<void>;
  checkExternalChange: (tabId: string) => Promise<void>;
  checkVisibleExternalChanges: () => Promise<void>;
  resolveExternalChange: (mode: ExternalResolution) => Promise<void>;
  /** 활성 그룹을 분할(버튼). 활성 탭을 새 인접 그룹에 복제 */
  splitActive: (direction: SplitDirection) => void;
  moveTab: (tabId: string, fromGroupId: string, toGroupId: string, toIndex?: number) => void;
  /** 드래그한 탭을 target 그룹의 side 가장자리에 새 패널로 분리 (N-분할/그리드) */
  dropSplit: (tabId: string, fromGroupId: string, targetGroupId: string, side: DropSide) => void;
  setDraggingTab: (info: { tabId: string; fromGroupId: string } | null) => void;
  closeGroup: (groupId: string) => void;
  closeConnectionTabs: (connectionId: string) => void;
}

// ── 레이아웃 트리 헬퍼 ──────────────────────────────

export function collectLeafIds(node: LayoutNode): string[] {
  return node.type === 'leaf' ? [node.groupId] : node.children.flatMap(collectLeafIds);
}

export function nodeKey(node: LayoutNode): string {
  return node.type === 'leaf' ? node.groupId : `s:${collectLeafIds(node).join('-')}`;
}

/** 리프 제거 후 단일 자식 split은 평탄화. 모두 제거되면 null */
function removeLeaf(node: LayoutNode, groupId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.groupId === groupId ? null : node;
  const kids = node.children
    .map((c) => removeLeaf(c, groupId))
    .filter((c): c is LayoutNode => c !== null);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  // 같은 방향으로 중첩된 split 평탄화
  const flat: LayoutNode[] = [];
  for (const c of kids) {
    if (c.type === 'split' && c.direction === node.direction) flat.push(...c.children);
    else flat.push(c);
  }
  return { type: 'split', direction: node.direction, children: flat };
}

/** targetGroupId 옆(side)에 newGroupId 리프 삽입. 부모가 같은 방향이면 형제로, 아니면 중첩 split 생성 */
function insertAdjacent(
  node: LayoutNode,
  targetGroupId: string,
  newGroupId: string,
  direction: SplitDirection,
  side: DropSide
): LayoutNode {
  const before = side === 'left' || side === 'top';
  if (node.type === 'leaf') {
    if (node.groupId !== targetGroupId) return node;
    const nl: LayoutNode = { type: 'leaf', groupId: newGroupId };
    return { type: 'split', direction, children: before ? [nl, node] : [node, nl] };
  }
  if (node.direction === direction) {
    const idx = node.children.findIndex(
      (c) => c.type === 'leaf' && c.groupId === targetGroupId
    );
    if (idx >= 0) {
      const nl: LayoutNode = { type: 'leaf', groupId: newGroupId };
      const children = [...node.children];
      children.splice(before ? idx : idx + 1, 0, nl);
      return { ...node, children };
    }
  }
  return {
    ...node,
    children: node.children.map((c) =>
      insertAdjacent(c, targetGroupId, newGroupId, direction, side)
    ),
  };
}

let groupSeq = 1;
function nextGroupId(): string {
  return `g${++groupSeq}`;
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

/** 어느 그룹에도 없는 탭 콘텐츠 정리 */
function pruneTabs(
  tabsById: Record<string, EditorTab>,
  groupsById: Record<string, EditorGroup>
) {
  const referenced = new Set(Object.values(groupsById).flatMap((g) => g.tabIds));
  const next: Record<string, EditorTab> = {};
  for (const [id, tab] of Object.entries(tabsById)) {
    if (referenced.has(id)) next[id] = tab;
  }
  return next;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  tabsById: {},
  groupsById: { g1: { id: 'g1', tabIds: [], activeTabId: null } },
  layout: { type: 'leaf', groupId: 'g1' },
  activeGroupId: 'g1',
  conflict: null,
  pendingOpen: null,
  externalChange: null,
  draggingTab: null,

  openFile: async (connectionId, entry) => {
    const tabId = makeTabId(connectionId, entry.path);
    const state = get();

    // 이미 어딘가 열려 있으면 그 그룹으로 포커스
    const existing = Object.values(state.groupsById).find((g) => g.tabIds.includes(tabId));
    if (existing) {
      set({
        activeGroupId: existing.id,
        groupsById: { ...state.groupsById, [existing.id]: { ...existing, activeTabId: tabId } },
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
    try {
      await performOpen(set, p.connectionId, p.entry);
    } catch (e) {
      log.error(`열기 실패: ${p.entry.path} — ${e}`);
    }
  },

  closeTab: (groupId, tabId) => {
    set((s) => {
      const g = s.groupsById[groupId];
      if (!g) return {};
      const idx = g.tabIds.indexOf(tabId);
      const tabIds = g.tabIds.filter((t) => t !== tabId);
      const groupsById = { ...s.groupsById };
      let layout = s.layout;
      let activeGroupId = s.activeGroupId;

      if (tabIds.length === 0 && collectLeafIds(s.layout).length > 1) {
        // 빈 패널 제거 (분할 해제)
        delete groupsById[groupId];
        layout = removeLeaf(s.layout, groupId) ?? s.layout;
        if (activeGroupId === groupId) activeGroupId = collectLeafIds(layout)[0];
      } else {
        let activeTabId = g.activeTabId;
        if (activeTabId === tabId) {
          activeTabId = tabIds[idx - 1] ?? tabIds[idx] ?? tabIds[tabIds.length - 1] ?? null;
        }
        groupsById[groupId] = { ...g, tabIds, activeTabId };
      }

      const tabsById = pruneTabs(s.tabsById, groupsById);
      return { groupsById, layout, activeGroupId, tabsById };
    });
  },

  closeOtherTabs: (groupId, keepTabId) => {
    set((s) => {
      const g = s.groupsById[groupId];
      if (!g) return {};
      const groupsById = {
        ...s.groupsById,
        [groupId]: { ...g, tabIds: g.tabIds.filter((t) => t === keepTabId), activeTabId: keepTabId },
      };
      return { groupsById, activeGroupId: groupId, tabsById: pruneTabs(s.tabsById, groupsById) };
    });
  },

  closeTabsInGroup: (groupId) => get().closeGroup(groupId),

  setActiveTab: (groupId, tabId) =>
    set((s) => ({
      activeGroupId: groupId,
      groupsById: { ...s.groupsById, [groupId]: { ...s.groupsById[groupId], activeTabId: tabId } },
    })),

  setActiveGroup: (groupId) => set({ activeGroupId: groupId }),

  updateContent: (tabId, content) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, content, isDirty: true } } };
    }),

  setTabLanguage: (tabId, language) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab || tab.language === language) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, language } } };
    }),

  saveTab: async (tabId) => {
    const tab = get().tabsById[tabId];
    if (!tab) return;
    try {
      const stat = await sftpStat(tab.connectionId, tab.remotePath).catch(() => null);
      const changedExternally =
        stat != null &&
        tab.baseMtime != null &&
        (stat.mtime !== tab.baseMtime || stat.size !== tab.baseSize);

      if (changedExternally) {
        log.warn(`외부 변경 감지: ${tab.remotePath} — 저장 보류`);
        set({
          conflict: { tabId, fileName: tab.fileName, remoteMtime: stat?.mtime, remoteSize: stat?.size ?? 0 },
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

  checkExternalChange: async (tabId) => {
    if (get().externalChange || get().conflict) return;
    const tab = get().tabsById[tabId];
    if (!tab || tab.baseMtime == null) return;

    const stat = await sftpStat(tab.connectionId, tab.remotePath).catch(() => null);
    if (!stat) return;

    const changed = stat.mtime !== tab.baseMtime || stat.size !== tab.baseSize;
    if (!changed) return;
    if (tab.seenMtime != null && stat.mtime === tab.seenMtime) return;
    if (get().externalChange || get().conflict) return;

    set({
      externalChange: {
        tabId,
        fileName: tab.fileName,
        remoteMtime: stat.mtime,
        remoteSize: stat.size ?? 0,
        isDirty: tab.isDirty,
      },
    });
    log.warn(`외부 변경 감지: ${tab.remotePath}`);
  },

  checkVisibleExternalChanges: async () => {
    const activeIds = Object.values(get().groupsById)
      .map((g) => g.activeTabId)
      .filter((id): id is string => !!id);
    for (const id of activeIds) {
      await get().checkExternalChange(id);
      if (get().externalChange) return;
    }
  },

  resolveExternalChange: async (mode) => {
    const ec = get().externalChange;
    if (!ec) return;
    const tab = get().tabsById[ec.tabId];
    if (!tab) {
      set({ externalChange: null });
      return;
    }
    try {
      if (mode === 'cancel') {
        set((s) => ({
          tabsById: { ...s.tabsById, [ec.tabId]: { ...s.tabsById[ec.tabId], seenMtime: ec.remoteMtime } },
        }));
        return;
      }

      if (mode === 'backup') {
        const bak = `${tab.remotePath}.bak.${timestamp()}`;
        await sftpWriteFile(tab.connectionId, bak, tab.content);
        log.warn(`내 변경 백업: ${bak}`);
        refreshParent(tab.connectionId, tab.remotePath);
      }

      const content = await sftpReadFile(tab.connectionId, tab.remotePath);
      const stat = await sftpStat(tab.connectionId, tab.remotePath).catch(() => null);
      set((s) => ({
        tabsById: {
          ...s.tabsById,
          [ec.tabId]: {
            ...s.tabsById[ec.tabId],
            content,
            isDirty: false,
            baseMtime: stat?.mtime ?? ec.remoteMtime,
            baseSize: stat?.size ?? ec.remoteSize,
            seenMtime: undefined,
          },
        },
      }));
      log.info(`서버 버전으로 재로드: ${tab.remotePath}`);
    } catch (e) {
      log.error(`외부 변경 처리 실패: ${e}`);
    } finally {
      set({ externalChange: null });
    }
  },

  splitActive: (direction) => {
    set((s) => {
      const g = s.groupsById[s.activeGroupId];
      if (!g || !g.activeTabId) return {};
      const newId = nextGroupId();
      const side: DropSide = direction === 'horizontal' ? 'right' : 'bottom';
      const groupsById = {
        ...s.groupsById,
        [newId]: { id: newId, tabIds: [g.activeTabId], activeTabId: g.activeTabId },
      };
      const layout = insertAdjacent(s.layout, s.activeGroupId, newId, direction, side);
      return { groupsById, layout, activeGroupId: newId };
    });
  },

  setDraggingTab: (info) => set({ draggingTab: info }),

  moveTab: (tabId, fromGroupId, toGroupId, toIndex) => {
    set((s) => {
      const groupsById = { ...s.groupsById };

      if (fromGroupId === toGroupId) {
        const g = groupsById[fromGroupId];
        if (!g) return {};
        const fromIndex = g.tabIds.indexOf(tabId);
        const without = g.tabIds.filter((t) => t !== tabId);
        let idx = toIndex == null ? without.length : toIndex;
        if (fromIndex !== -1 && fromIndex < idx) idx -= 1;
        idx = Math.max(0, Math.min(idx, without.length));
        without.splice(idx, 0, tabId);
        groupsById[fromGroupId] = { ...g, tabIds: without, activeTabId: tabId };
        return { groupsById, activeGroupId: toGroupId };
      }

      const from = groupsById[fromGroupId];
      const to = groupsById[toGroupId];
      if (!from || !to) return {};

      const fromRemaining = from.tabIds.filter((t) => t !== tabId);
      let toTabs: string[];
      if (to.tabIds.includes(tabId)) {
        toTabs = to.tabIds;
      } else {
        toTabs = [...to.tabIds];
        const idx = toIndex == null ? toTabs.length : Math.min(toIndex, toTabs.length);
        toTabs.splice(idx, 0, tabId);
      }
      groupsById[toGroupId] = { ...to, tabIds: toTabs, activeTabId: tabId };

      let layout = s.layout;
      if (fromRemaining.length > 0) {
        groupsById[fromGroupId] = {
          ...from,
          tabIds: fromRemaining,
          activeTabId: from.activeTabId === tabId ? fromRemaining[fromRemaining.length - 1] : from.activeTabId,
        };
      } else {
        delete groupsById[fromGroupId];
        layout = removeLeaf(s.layout, fromGroupId) ?? { type: 'leaf', groupId: toGroupId };
      }

      const tabsById = pruneTabs(s.tabsById, groupsById);
      return { groupsById, layout, activeGroupId: toGroupId, tabsById };
    });
  },

  dropSplit: (tabId, fromGroupId, targetGroupId, side) => {
    set((s) => {
      const fromGroup = s.groupsById[fromGroupId];
      if (!fromGroup) return {};
      const direction: SplitDirection = side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
      const newId = nextGroupId();
      const groupsById = { ...s.groupsById };
      const fromRemaining = fromGroup.tabIds.filter((t) => t !== tabId);

      // 자기 패널의 마지막 탭을 자기 가장자리로 → 탭은 그대로 두고 빈 패널을 새로 만든다 (다음에 열 파일용)
      if (fromRemaining.length === 0 && fromGroupId === targetGroupId) {
        groupsById[newId] = { id: newId, tabIds: [], activeTabId: null };
        const layout = insertAdjacent(s.layout, targetGroupId, newId, direction, side);
        return { groupsById, layout, activeGroupId: newId };
      }

      groupsById[newId] = { id: newId, tabIds: [tabId], activeTabId: tabId };
      if (fromRemaining.length > 0) {
        groupsById[fromGroupId] = {
          ...fromGroup,
          tabIds: fromRemaining,
          activeTabId: fromGroup.activeTabId === tabId ? fromRemaining[fromRemaining.length - 1] : fromGroup.activeTabId,
        };
      } else {
        delete groupsById[fromGroupId];
      }

      let layout = insertAdjacent(s.layout, targetGroupId, newId, direction, side);
      if (fromRemaining.length === 0 && fromGroupId !== newId) {
        layout = removeLeaf(layout, fromGroupId) ?? { type: 'leaf', groupId: newId };
      }

      const tabsById = pruneTabs(s.tabsById, groupsById);
      return { groupsById, layout, activeGroupId: newId, tabsById };
    });
  },

  closeGroup: (groupId) => {
    set((s) => {
      const leaves = collectLeafIds(s.layout);
      if (leaves.length <= 1) {
        // 마지막 패널 → 탭만 비우고 유지
        const g = s.groupsById[groupId];
        if (!g) return {};
        const groupsById = { ...s.groupsById, [groupId]: { ...g, tabIds: [], activeTabId: null } };
        return { groupsById, tabsById: pruneTabs(s.tabsById, groupsById) };
      }
      const groupsById = { ...s.groupsById };
      delete groupsById[groupId];
      const layout = removeLeaf(s.layout, groupId) ?? s.layout;
      const activeGroupId =
        s.activeGroupId === groupId ? collectLeafIds(layout)[0] : s.activeGroupId;
      const tabsById = pruneTabs(s.tabsById, groupsById);
      return { groupsById, layout, activeGroupId, tabsById };
    });
  },

  closeConnectionTabs: (connectionId) => {
    set((s) => {
      const belongs = (id: string) => s.tabsById[id]?.connectionId === connectionId;
      const groupsById: Record<string, EditorGroup> = {};
      for (const [gid, g] of Object.entries(s.groupsById)) {
        const tabIds = g.tabIds.filter((id) => !belongs(id));
        let activeTabId = g.activeTabId;
        if (activeTabId && belongs(activeTabId)) activeTabId = tabIds[tabIds.length - 1] ?? null;
        groupsById[gid] = { ...g, tabIds, activeTabId };
      }
      // 빈 그룹을 레이아웃에서 제거 (최소 1개는 유지)
      let layout = s.layout;
      for (const gid of Object.keys(groupsById)) {
        if (collectLeafIds(layout).length <= 1) break;
        if (groupsById[gid].tabIds.length === 0) {
          const next = removeLeaf(layout, gid);
          if (next) {
            delete groupsById[gid];
            layout = next;
          }
        }
      }
      const leaves = collectLeafIds(layout);
      const activeGroupId = leaves.includes(s.activeGroupId) ? s.activeGroupId : leaves[0];
      const tabsById = pruneTabs(s.tabsById, groupsById);
      return { groupsById, layout, activeGroupId, tabsById };
    });
  },
}));

function refreshParent(connectionId: string, path: string) {
  const parent = path.split('/').slice(0, -1).join('/') || '/';
  useFileTreeStore.getState().refreshDir(connectionId, parent).catch(() => {});
}

type SetFn = (
  partial: Partial<EditorStore> | ((state: EditorStore) => Partial<EditorStore>)
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
    set((s) => {
      const active = s.groupsById[s.activeGroupId];
      return {
        tabsById: { ...s.tabsById, [tabId]: tab },
        groupsById: {
          ...s.groupsById,
          [s.activeGroupId]: {
            ...active,
            tabIds: [...active.tabIds, tabId],
            activeTabId: tabId,
          },
        },
      };
    });
    log.info(`파일 열기: ${entry.path}`);
  } catch (e) {
    log.error(`파일 열기 실패: ${entry.path} — ${e}`);
    throw e;
  }
}
