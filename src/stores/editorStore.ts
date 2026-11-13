import { create } from 'zustand';
import { message } from '@tauri-apps/plugin-dialog';
import { confirmUnsavedChanges } from '../utils/confirmUnsavedChanges';
import {
  localProbe,
  readTextFile,
  localReadSegment,
  localWriteSegment,
  sftpProbe,
  sftpReadFile,
  sftpStat,
  sftpWriteFile,
} from '../ipc/commands';
import { toastError } from './toastStore';
import { openLimits, useSettingsStore } from './settingsStore';
import type { EditorTab, FileEntry } from '../types';
import { detectLanguage } from '../utils/languageDetect';
import { log } from './logStore';
import { useFileTreeStore } from './fileTreeStore';
import { useTransferStore } from './transferStore';

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
  /** 일반 한도 초과 ~ 대용량 한도 이하: 편집기로 전체 열기도 허용 */
  editable: boolean;
  /** 대용량 한도 (바이트, 안내 문구용) */
  largeLimit: number;
}

/** edit=편집기로 전체 열기, view=보기 모드(일부만 로딩), hex=Hex 보기 */
export type OpenResolution = 'edit' | 'view' | 'hex' | 'download' | 'cancel';

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
  closeTab: (groupId: string, tabId: string) => Promise<void>;
  closeOtherTabs: (groupId: string, keepTabId: string) => Promise<void>;
  closeTabsInGroup: (groupId: string) => Promise<void>;
  setActiveTab: (groupId: string, tabId: string) => void;
  setActiveGroup: (groupId: string) => void;
  updateContent: (tabId: string, content: string) => void;
  keepTab: (tabId: string) => void;
  /** 탭의 구문 강조 언어를 수동 변경 (상태바 언어 선택) */
  setTabLanguage: (tabId: string, language: string) => void;
  /** 탭의 자동 줄바꿈 on/off 토글 (Alt+Z / 상태바 버튼) */
  toggleWordWrap: (tabId: string) => void;
  togglePreview: (tabId: string) => void;
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
  closeGroup: (groupId: string) => Promise<void>;
  closeConnectionTabs: (connectionId: string) => void;
  /**
   * 미저장 탭을 모두 저장 시도한다. connectionId를 주면 그 연결의 탭만 대상.
   * 외부 변경 충돌 등으로 저장이 보류될 수 있으므로, 끝난 뒤에도 남아 있는 미저장 탭 수를 돌려준다.
   */
  saveDirtyTabs: (connectionId?: string) => Promise<number>;
  /** eco: 안 보이는 미수정 탭의 내용을 메모리에서 해제. force=false면 기준 초과일 때만 → 해제한 {탭 수, 바이트} */
  freeMemory: (force?: boolean) => { count: number; bytes: number };
  /** 대용량 보기에서 고친 파일 → 보기 화면이 색인을 다시 만들도록 알리는 카운터 (경로별) */
  fileRevisions: Record<string, number>;
  /** 대용량 로컬 파일의 줄 구간을 편집 탭으로 연다 (anchor: 색인 지점, skip: 건너뛸 줄 수) */
  openSegment: (entry: FileEntry, req: { anchor: number; skip: number; startLine: number; count: number }) => Promise<void>;
  /** 파일 종류와 관계없이 Hex 보기 탭으로 연다 (트리 우클릭 메뉴) */
  openHex: (connectionId: string, entry: FileEntry) => void;
  /** eco로 해제된 탭을 다시 읽는다 */
  reloadUnloaded: (tabId: string) => Promise<void>;
  changeEncoding: (tabId: string, encoding: string, mode: 'read' | 'save') => Promise<void>;
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

const MB = 1024 * 1024;
/** JS 문자열은 UTF-16이므로 글자당 약 2바이트 */
const tabBytes = (t: EditorTab) => t.content.length * 2;
/** 화면에서 내려가는 탭의 마지막 사용 시각 기록 */
function touch(tabsById: Record<string, EditorTab>, tabId: string | null | undefined) {
  const t = tabId ? tabsById[tabId] : undefined;
  return t ? { ...tabsById, [t.id]: { ...t, lastActive: Date.now() } } : tabsById;
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

    // 바이너리/대용량 검사 → 확인 다이얼로그 (한도는 앱 설정의 로컬/원격 값)
    const probe = await (connectionId === 'local'
      ? localProbe(entry.path)
      : sftpProbe(connectionId, entry.path)
    ).catch(() => null);
    const size = probe?.size ?? entry.size;
    const isBinary = probe?.isBinary ?? false;
    const { normal, large } = openLimits(connectionId);
    if (isBinary && focusExisting(set, get(), `${tabId}${HEX_SUFFIX}`)) return;
    if (isBinary || size > normal) {
      set({ pendingOpen: { connectionId, entry, size, isBinary, editable: !isBinary && size <= large, largeLimit: large } });
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
      if (mode === 'edit') await performOpen(set, p.connectionId, p.entry);
      else if (mode === 'hex') openViewerTab(set, p.connectionId, p.entry, 'hex');
      else openViewerTab(set, p.connectionId, p.entry, p.connectionId === 'local' ? 'paged' : 'log');
    } catch (e) {
      log.error(`열기 실패: ${p.entry.path} — ${e}`);
    }
  },

  closeTab: async (groupId, tabId) => {
    if (!(await confirmClosingTabs(get, [tabId]))) return;
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

  closeOtherTabs: async (groupId, keepTabId) => {
    const ids = get().groupsById[groupId]?.tabIds.filter((id) => id !== keepTabId) ?? [];
    if (!(await confirmClosingTabs(get, ids))) return;
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

  setActiveTab: (groupId, tabId) => {
    set((s) => ({
      activeGroupId: groupId,
      groupsById: { ...s.groupsById, [groupId]: { ...s.groupsById[groupId], activeTabId: tabId } },
      tabsById: touch(s.tabsById, s.groupsById[groupId]?.activeTabId),
    }));
    get().freeMemory();
  },

  fileRevisions: {},

  changeEncoding: async (tabId, encoding, mode) => {
    const tab = get().tabsById[tabId];
    if (!tab || tab.segment || tab.unloaded) throw Error('파일 전체를 편집기로 연 뒤 인코딩을 변경하세요');
    if (Object.values(get().tabsById).some((t) => t.remotePath === tab.remotePath && t.connectionId === tab.connectionId && t.segment?.size != null && t.isDirty)) {
      throw Error('같은 파일에서 편집 중인 구간을 먼저 저장하거나 닫으세요');
    }
    if (mode === 'read') {
      if (tab.isDirty) {
        const choice = await message('저장하지 않은 변경사항을 버리고 선택한 인코딩으로 다시 읽을까요?', {
          title: '읽기 인코딩 변경', kind: 'warning', buttons: { ok: '다시 읽기', cancel: '취소' },
        });
        if (choice !== '다시 읽기') return;
      }
      const before = get().tabsById[tabId];
      const decoded = await readTextFile(tab.connectionId, tab.remotePath, encoding);
      const stat = await sftpStat(tab.connectionId, tab.remotePath);
      if (get().tabsById[tabId] !== before) throw Error('읽는 동안 편집 내용이 바뀌었습니다. 다시 시도하세요');
      if (tab.viewMode) {
        const id = makeTabId(tab.connectionId, tab.remotePath);
        const existing = get().tabsById[id];
        if (existing?.isDirty) throw Error('이 파일의 편집 탭에 미저장 변경사항이 있습니다');
        const next: EditorTab = { id, connectionId: tab.connectionId, remotePath: tab.remotePath, fileName: tab.fileName,
          content: decoded.text, encoding: decoded.encoding, language: detectLanguage(tab.remotePath), isDirty: false,
          baseMtime: stat.mtime, baseSize: stat.size, lastActive: Date.now() };
        if (existing) {
          set((s) => ({ tabsById: { ...s.tabsById, [id]: next } }));
          focusExisting(set, get(), id);
        } else set((s) => insertPreviewTab(s, next));
      } else set((s) => ({ tabsById: { ...s.tabsById, [tabId]: { ...s.tabsById[tabId], content: decoded.text,
        encoding: decoded.encoding, isDirty: false, baseMtime: stat.mtime, baseSize: stat.size, seenMtime: undefined } } }));
      log.info(`읽기 인코딩 변경: ${tab.remotePath} (${encoding})`);
    } else {
      if (tab.viewMode) throw Error('보기 모드에서는 인코딩을 변환해 저장할 수 없습니다');
      const stat = await sftpStat(tab.connectionId, tab.remotePath);
      if (tab.baseMtime != null && (stat.mtime !== tab.baseMtime || stat.size !== tab.baseSize)) {
        throw Error('파일이 외부에서 바뀌었습니다. 다시 읽은 뒤 변환하세요');
      }
      const saved = await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content, encoding);
      set((s) => ({ tabsById: { ...s.tabsById, [tabId]: { ...s.tabsById[tabId], encoding,
        isDirty: s.tabsById[tabId]?.content !== tab.content, baseMtime: saved.mtime, baseSize: saved.size } },
        fileRevisions: { ...s.fileRevisions, [tab.remotePath]: (s.fileRevisions[tab.remotePath] ?? 0) + 1 } }));
      log.info(`인코딩 변환 저장: ${tab.remotePath} (${encoding})`);
    }
  },

  openSegment: async (entry, req) => {
    const segId = `${makeTabId('local', entry.path)}${SEG_SUFFIX}`;
    const open = get().tabsById[segId];
    if (open?.isDirty) {
      focusExisting(set, get(), segId);
      toastError('이 파일에서 편집 중인 구간이 있습니다. 저장하거나 닫은 뒤 다른 구간을 여세요');
      return;
    }
    const seg = await localReadSegment(entry.path, req.anchor, req.skip, req.count, SEGMENT_MAX_BYTES);
    // 구간 탭이 미리보기 탭을 대체하지 않도록 원본 보기 탭을 유지한다.
    get().keepTab(makeTabId('local', entry.path));
    const lastLine = req.startLine + Math.max(1, seg.lines);
    const tab: EditorTab = {
      id: segId,
      connectionId: 'local',
      remotePath: entry.path,
      fileName: `${entry.name} (${(req.startLine + 1).toLocaleString()}–${lastLine.toLocaleString()}줄)`,
      content: seg.text,
      isDirty: false,
      language: detectLanguage(entry.path),
      lastActive: Date.now(),
      segment: { start: seg.start, end: seg.end, startLine: req.startLine, size: seg.size, mtime: seg.mtime },
    };
    if (open) {
      // 같은 파일의 이전 구간 탭(미수정)은 새 구간으로 교체
      set((s) => ({ tabsById: { ...s.tabsById, [segId]: tab } }));
      focusExisting(set, get(), segId);
    } else {
      set((s) => {
        const next = insertPreviewTab(s, tab);
        return { ...next, tabsById: { ...next.tabsById, [segId]: { ...tab, isPreview: false } } };
      });
    }
    log.info(`구간 편집 열기: ${entry.path} (${req.startLine + 1}줄부터 ${seg.lines}줄, ${(seg.text.length / 1024).toFixed(0)} KB)`);
  },

  openHex: (connectionId, entry) => {
    const hexId = `${makeTabId(connectionId, entry.path)}${HEX_SUFFIX}`;
    if (!focusExisting(set, get(), hexId)) openViewerTab(set, connectionId, entry, 'hex');
  },

  freeMemory: (force = false) => {
    const s = get();
    const visible = new Set(Object.values(s.groupsById).map((g) => g.activeTabId));
    const loaded = Object.values(s.tabsById);
    let total = loaded.reduce((n, t) => n + tabBytes(t), 0);
    const limitMB = useSettingsStore.getState().ecoThresholdMB;
    if (!force && (!limitMB || total <= limitMB * MB)) return { count: 0, bytes: 0 };
    // 기준을 넘으면 기준의 60%까지 내려서 탭을 오갈 때마다 해제가 반복되지 않게 한다
    const target = force ? 0 : limitMB * MB * 0.6;
    const candidates = loaded
      // 구간 편집 탭은 다시 읽을 때 원본 전체를 읽게 되므로 해제 대상에서 제외
      .filter((t) => !visible.has(t.id) && !t.isDirty && !t.viewMode && !t.segment && !t.unloaded && t.content.length > 0)
      .sort((a, b) => (a.lastActive ?? 0) - (b.lastActive ?? 0));
    const freed: string[] = [];
    let bytes = 0;
    for (const t of candidates) {
      if (total <= target) break;
      const b = tabBytes(t);
      total -= b;
      bytes += b;
      freed.push(t.id);
    }
    if (freed.length === 0) return { count: 0, bytes: 0 };
    set((st) => {
      const tabsById = { ...st.tabsById };
      for (const id of freed) {
        if (tabsById[id] && !tabsById[id].isDirty) tabsById[id] = { ...tabsById[id], content: '', unloaded: true };
      }
      return { tabsById };
    });
    log.info(`eco: 사용하지 않는 탭 ${freed.length}개의 메모리 해제 (약 ${(bytes / MB).toFixed(1)} MB)`);
    return { count: freed.length, bytes };
  },

  reloadUnloaded: async (tabId) => {
    const tab = get().tabsById[tabId];
    if (!tab?.unloaded) return;
    const [content, stat] = await Promise.all([
      sftpReadFile(tab.connectionId, tab.remotePath, undefined, tab.encoding),
      sftpStat(tab.connectionId, tab.remotePath).catch(() => null),
    ]);
    set((s) => {
      const cur = s.tabsById[tabId];
      if (!cur?.unloaded) return {};
      return {
        tabsById: {
          ...s.tabsById,
          [tabId]: { ...cur, content, unloaded: false, lastActive: Date.now(), baseMtime: stat?.mtime, baseSize: stat?.size, seenMtime: undefined },
        },
      };
    });
    log.info(`eco: 탭 다시 읽기 ${tab.remotePath}`);
    get().freeMemory();
  },

  setActiveGroup: (groupId) => set({ activeGroupId: groupId }),

  updateContent: (tabId, content) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab || tab.content === content) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, content, isDirty: true, isPreview: false } } };
    }),

  keepTab: (tabId) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab?.isPreview) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, isPreview: false } } };
    }),

  setTabLanguage: (tabId, language) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab || tab.language === language) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, language } } };
    }),

  toggleWordWrap: (tabId) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, wordWrap: !tab.wordWrap } } };
    }),

  togglePreview: (tabId) =>
    set((s) => {
      const tab = s.tabsById[tabId];
      if (!tab) return {};
      return { tabsById: { ...s.tabsById, [tabId]: { ...tab, previewMode: !tab.previewMode } } };
    }),

  saveTab: async (tabId) => {
    const tab = get().tabsById[tabId];
    if (!tab || tab.viewMode) return;
    if (tab.segment) {
      await saveSegment(set, tab);
      return;
    }
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

      const newStat = await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content, tab.encoding);
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
        const st = await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content, tab.encoding);
        set((s) => ({
          tabsById: {
            ...s.tabsById,
            [c.tabId]: { ...s.tabsById[c.tabId], isDirty: false, baseMtime: st.mtime, baseSize: st.size },
          },
        }));
        log.info(`덮어쓰기 저장: ${tab.remotePath}`);
      } else if (mode === 'backup') {
        const bak = `${tab.remotePath}.bak.${timestamp()}`;
        const remoteCurrent = await sftpReadFile(tab.connectionId, tab.remotePath, undefined, tab.encoding);
        await sftpWriteFile(tab.connectionId, bak, remoteCurrent, tab.encoding);
        const st = await sftpWriteFile(tab.connectionId, tab.remotePath, tab.content, tab.encoding);
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
        await sftpWriteFile(tab.connectionId, bak, tab.content, tab.encoding);
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
    if (!tab || tab.viewMode || tab.baseMtime == null) return;

    const stat = await sftpStat(tab.connectionId, tab.remotePath).catch(() => null);
    if (!stat) return;

    const changed = stat.mtime !== tab.baseMtime || stat.size !== tab.baseSize;
    if (!changed) return;
    if (tab.seenMtime != null && stat.mtime === tab.seenMtime) return;
    if (get().externalChange || get().conflict) return;

    // 로컬 수정이 없으면 물어보지 않고 서버 버전으로 조용히 재로드
    if (!tab.isDirty) {
      const content = await sftpReadFile(tab.connectionId, tab.remotePath, undefined, tab.encoding).catch(() => null);
      if (content == null) return;
      const fresh = await sftpStat(tab.connectionId, tab.remotePath).catch(() => null);
      set((s) => ({
        tabsById: {
          ...s.tabsById,
          [tabId]: {
            ...s.tabsById[tabId],
            content,
            isDirty: false,
            baseMtime: fresh?.mtime ?? stat.mtime,
            baseSize: fresh?.size ?? stat.size,
            seenMtime: undefined,
          },
        },
      }));
      log.info(`외부 변경 자동 재로드: ${tab.remotePath}`);
      return;
    }

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
        await sftpWriteFile(tab.connectionId, bak, tab.content, tab.encoding);
        log.warn(`내 변경 백업: ${bak}`);
        refreshParent(tab.connectionId, tab.remotePath);
      }

      const content = await sftpReadFile(tab.connectionId, tab.remotePath, undefined, tab.encoding);
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
    const activeTabId = get().groupsById[get().activeGroupId]?.activeTabId;
    if (activeTabId) get().keepTab(activeTabId);
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
    get().keepTab(tabId);
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
    get().keepTab(tabId);
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

  closeGroup: async (groupId) => {
    if (!(await confirmClosingTabs(get, get().groupsById[groupId]?.tabIds ?? []))) return;
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

  saveDirtyTabs: async (connectionId) => {
    const mine = (t: EditorTab) => !connectionId || t.connectionId === connectionId;
    const dirty = Object.values(get().tabsById).filter((t) => mine(t) && t.isDirty);
    for (const tab of dirty) {
      await get().saveTab(tab.id).catch(() => {});
    }
    return Object.values(get().tabsById).filter((t) => mine(t) && t.isDirty).length;
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
  if (connectionId === 'local') return;
  const parent = path.split('/').slice(0, -1).join('/') || '/';
  useFileTreeStore.getState().refreshDir(connectionId, parent).catch(() => {});
}

type SetFn = (
  partial: Partial<EditorStore> | ((state: EditorStore) => Partial<EditorStore>)
) => void;

/** 읽기에 성공한 뒤 활성 그룹의 미편집 임시 탭을 교체한다. */
function insertPreviewTab(s: EditorStore, tab: EditorTab): Partial<EditorStore> {
  // 같은 파일을 중복으로 읽어도 기존 편집 내용을 덮어쓰지 않는다.
  const existing = Object.values(s.groupsById).find((g) => g.tabIds.includes(tab.id));
  if (existing) {
    return {
      activeGroupId: existing.id,
      groupsById: { ...s.groupsById, [existing.id]: { ...existing, activeTabId: tab.id } },
    };
  }
  const active = s.groupsById[s.activeGroupId];
  const previewIndex = active.tabIds.findIndex((id) => s.tabsById[id]?.isPreview && !s.tabsById[id]?.isDirty);
  const tabIds = [...active.tabIds];
  if (previewIndex < 0) tabIds.push(tab.id);
  else tabIds[previewIndex] = tab.id;
  const groupsById = {
    ...s.groupsById,
    [active.id]: { ...active, tabIds, activeTabId: tab.id },
  };
  return {
    groupsById,
    tabsById: pruneTabs({ ...s.tabsById, [tab.id]: { ...tab, isPreview: true } }, groupsById),
  };
}

/** 실제 파일을 읽어 활성 그룹에 탭으로 연다 */
async function performOpen(set: SetFn, connectionId: string, entry: FileEntry) {
  const tabId = makeTabId(connectionId, entry.path);
  try {
    const [decoded, stat] = await Promise.all([
      readTextFile(connectionId, entry.path),
      sftpStat(connectionId, entry.path).catch(() => null),
    ]);
    const tab: EditorTab = {
      id: tabId,
      connectionId,
      remotePath: entry.path,
      fileName: entry.name,
      content: decoded.text,
      encoding: decoded.encoding,
      isDirty: false,
      language: detectLanguage(entry.path),
      baseMtime: stat?.mtime,
      baseSize: stat?.size,
      lastActive: Date.now(),
    };
    set((s) => insertPreviewTab(s, tab));
    log.info(`파일 열기: ${entry.path}`);
    useEditorStore.getState().freeMemory();
  } catch (e) {
    log.error(`파일 열기 실패: ${entry.path} — ${e}`);
    if (String(e).includes('인코딩') || String(e).includes('바이너리 데이터')) {
      openViewerTab(set, connectionId, entry, 'hex');
      toastError('텍스트 인코딩을 판별하지 못했습니다. 상태바의 인코딩 선택에서 읽기 인코딩을 지정하세요');
      return;
    }
    throw e;
  }
}

/** Hex 탭은 같은 파일의 편집 탭과 함께 열 수 있도록 별도 id 를 쓴다 */
const HEX_SUFFIX = '#hex';
/** 구간 편집 탭 id 접미사 — 파일당 하나 */
const SEG_SUFFIX = '#seg';
/** 닫힐 탭의 저장에 실패하면 편집 내용을 유지한다. */
async function confirmClosingTabs(get: () => EditorStore, ids: string[]) {
  const dirty = () => ids.filter((id) => get().tabsById[id]?.isDirty);
  return confirmUnsavedChanges({
    title: '탭 닫기',
    countDirty: () => dirty().length,
    saveDirtyTabs: async () => {
      for (const id of dirty()) await get().saveTab(id).catch(() => {});
      return dirty().length;
    },
    message,
  });
}
/** 구간 편집 1회 최대 크기 (Rust MAX_SEGMENT_BYTES 이하) */
const SEGMENT_MAX_BYTES = 8 * 1024 * 1024;

/** 구간 편집 저장: 원본의 해당 구간만 바꿔 끼운다 */
async function saveSegment(set: SetFn, tab: EditorTab) {
  const seg = tab.segment!;
  try {
    const saved = await localWriteSegment(tab.remotePath, seg.start, seg.end, tab.content, seg.size, seg.mtime);
    set((s) => {
      const cur = s.tabsById[tab.id];
      if (!cur?.segment) return {};
      return {
        tabsById: {
          ...s.tabsById,
          // 저장 이후 수정분이 있으면 dirty 유지
          [tab.id]: {
            ...cur,
            isDirty: cur.content !== tab.content,
            segment: { ...cur.segment, end: saved.end, size: saved.size, mtime: saved.mtime },
          },
        },
        fileRevisions: { ...s.fileRevisions, [tab.remotePath]: (s.fileRevisions[tab.remotePath] ?? 0) + 1 },
      };
    });
    log.info(`구간 저장: ${tab.remotePath} (${seg.start}–${seg.end} → ${saved.end} 바이트 위치)`);
  } catch (e) {
    log.error(`구간 저장 실패: ${tab.remotePath} — ${e}`);
    toastError(`구간 저장 실패: ${String(e)}`);
    throw e;
  }
}

/** 이미 열린 탭이면 그 그룹으로 포커스하고 true */
function focusExisting(set: SetFn, s: EditorStore, tabId: string): boolean {
  const g = Object.values(s.groupsById).find((x) => x.tabIds.includes(tabId));
  if (!g) return false;
  set({ activeGroupId: g.id, groupsById: { ...s.groupsById, [g.id]: { ...g, activeTabId: tabId } } });
  return true;
}

function openViewerTab(set: SetFn, connectionId: string, entry: FileEntry, viewer: EditorTab['viewer']) {
  const hex = viewer === 'hex';
  const tabId = `${makeTabId(connectionId, entry.path)}${hex ? HEX_SUFFIX : ''}`;
  const tab: EditorTab = {
    id: tabId, connectionId, remotePath: entry.path, fileName: hex ? `${entry.name} (Hex)` : entry.name,
    content: '', isDirty: false, language: 'plaintext', viewMode: true, viewer,
  };
  log.info(`${viewer === 'hex' ? 'Hex 보기' : '보기 모드'}로 열기: ${entry.path}`);
  set((s) => insertPreviewTab(s, tab));
}
