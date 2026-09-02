import { create } from 'zustand';
import { terminalClose, terminalCreate, terminalWrite } from '../ipc/commands';
import type { TerminalSessionInfo } from '../types';
import { log } from './logStore';
import { useFileTreeStore } from './fileTreeStore';

/** 셸 인용 (작은따옴표로 감싸고 내부 ' 는 '\'' 로 이스케이프) */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** UTF-8 문자열을 base64로 (terminal_write는 base64를 받음) */
function toBase64(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

/** 백엔드 PTY 채널 생성 + 시작 디렉토리 이동. createSession/splitNewTerminal 공통 */
async function spawnTerminal(
  connectionId: string,
  title: string,
  cwd?: string
): Promise<TerminalSessionInfo> {
  const sessionId = await terminalCreate(connectionId, 80, 24);
  // 시작 디렉토리로 이동 (지정 cwd → 현재 세션 베이스 경로 → 실패 시 홈)
  const dir = cwd ?? useFileTreeStore.getState().rootPaths.get(connectionId);
  if (dir && dir !== '~') {
    const cmd = `cd ${shellQuote(dir)} 2>/dev/null || cd ~\n`;
    terminalWrite(sessionId, toBase64(cmd)).catch(() => {});
  }
  return { id: sessionId, connectionId, title };
}

// ── 분할 레이아웃 트리 ────────────────────────────
// 그룹 = VSCode식 "터미널 탭". 그룹 안은 좌우(horizontal)·상하(vertical) 중첩 분할 트리.

export type TermSplitDirection = 'horizontal' | 'vertical';
export type TermDropSide = 'left' | 'right' | 'top' | 'bottom';

export type TermNode =
  | { type: 'leaf'; id: string }
  | {
      type: 'split';
      direction: TermSplitDirection;
      /** 자식별 비율(합 1). children과 같은 길이 */
      sizes: number[];
      children: TermNode[];
    };

export interface TerminalGroup {
  id: string;
  root: TermNode;
}

export const dirOfSide = (side: TermDropSide): TermSplitDirection =>
  side === 'left' || side === 'right' ? 'horizontal' : 'vertical';

/** 트리에 포함된 터미널 id들을 화면 순서대로 */
export function collectTermIds(node: TermNode): string[] {
  return node.type === 'leaf' ? [node.id] : node.children.flatMap(collectTermIds);
}

/** 비율 합을 1로 정규화 (합이 0이면 균등 분배) */
function normSizes(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return sizes.map(() => 1 / sizes.length);
  return sizes.map((s) => s / sum);
}

/** 같은 방향으로 중첩된 split 평탄화 (자식 비율은 부모 비율에 곱해 보존) */
function flattenSplit(node: Extract<TermNode, { type: 'split' }>): TermNode {
  const children: TermNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    if (c.type === 'split' && c.direction === node.direction) {
      c.children.forEach((cc, j) => {
        children.push(cc);
        sizes.push(node.sizes[i] * c.sizes[j]);
      });
    } else {
      children.push(c);
      sizes.push(node.sizes[i]);
    }
  });
  return { ...node, children, sizes: normSizes(sizes) };
}

/** 리프 제거 후 남은 형제에 비율 재분배. 자식이 1개면 승격, 모두 사라지면 null */
export function removeTermLeaf(node: TermNode, id: string): TermNode | null {
  if (node.type === 'leaf') return node.id === id ? null : node;
  const kept: TermNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const r = removeTermLeaf(c, id);
    if (r === null) return;
    kept.push(r);
    sizes.push(node.sizes[i] ?? 1 / node.children.length);
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0];
  return flattenSplit({ ...node, children: kept, sizes: normSizes(sizes) });
}

/** targetId 리프 옆(side)에 newId 리프 삽입. 부모가 같은 방향이면 형제로, 아니면 중첩 split 생성 */
export function insertTermAdjacent(
  node: TermNode,
  targetId: string,
  newId: string,
  side: TermDropSide
): TermNode {
  const direction = dirOfSide(side);
  const before = side === 'left' || side === 'top';
  if (node.type === 'leaf') {
    if (node.id !== targetId) return node;
    const nl: TermNode = { type: 'leaf', id: newId };
    return {
      type: 'split',
      direction,
      sizes: [0.5, 0.5],
      children: before ? [nl, node] : [node, nl],
    };
  }
  if (node.direction === direction) {
    const idx = node.children.findIndex((c) => c.type === 'leaf' && c.id === targetId);
    if (idx >= 0) {
      // 대상이 쓰던 공간을 반으로 쪼개 새 패널에 준다
      const half = (node.sizes[idx] ?? 1 / node.children.length) / 2;
      const children = [...node.children];
      const sizes = [...node.sizes];
      sizes[idx] = half;
      children.splice(before ? idx : idx + 1, 0, { type: 'leaf', id: newId });
      sizes.splice(before ? idx : idx + 1, 0, half);
      return { ...node, children, sizes: normSizes(sizes) };
    }
  }
  return {
    ...node,
    children: node.children.map((c) => insertTermAdjacent(c, targetId, newId, side)),
  };
}

/** 해당 리프가 속한 split의 방향 (단독 리프면 null) — 사이드바 재배치 방향 결정에 사용 */
export function parentDirection(node: TermNode, id: string): TermSplitDirection | null {
  if (node.type === 'leaf') return null;
  if (node.children.some((c) => c.type === 'leaf' && c.id === id)) return node.direction;
  for (const c of node.children) {
    const d = parentDirection(c, id);
    if (d) return d;
  }
  return null;
}

/** 재접속 등으로 터미널 id가 바뀔 때 트리의 리프 id 교체 */
function renameTermLeaf(node: TermNode, oldId: string, newId: string): TermNode {
  if (node.type === 'leaf') return node.id === oldId ? { type: 'leaf', id: newId } : node;
  return { ...node, children: node.children.map((c) => renameTermLeaf(c, oldId, newId)) };
}

/** path(자식 인덱스 배열)로 지정된 split 노드의 비율 교체 */
function setSizesAt(node: TermNode, path: number[], sizes: number[]): TermNode {
  if (node.type !== 'split') return node;
  if (path.length === 0) return { ...node, sizes: normSizes(sizes) };
  const [i, ...rest] = path;
  const children = [...node.children];
  children[i] = setSizesAt(children[i], rest, sizes);
  return { ...node, children };
}

function findGroup(groups: TerminalGroup[], terminalId: string): TerminalGroup | undefined {
  return groups.find((g) => collectTermIds(g.root).includes(terminalId));
}

let groupSeq = 0;
function nextGroupId(): string {
  return `tg${++groupSeq}`;
}

/** 빈 그룹 제거 + activeGroup/activeSession 정합성 보정 */
function reconcileActive(
  groups: TerminalGroup[],
  activeGroupId: string | null,
  activeSessionId: string | null
): { groups: TerminalGroup[]; activeGroupId: string | null; activeSessionId: string | null } {
  const pruned = groups.filter((g) => collectTermIds(g.root).length > 0);
  let gid = activeGroupId;
  if (!pruned.some((g) => g.id === gid)) gid = pruned[pruned.length - 1]?.id ?? null;
  const ag = pruned.find((g) => g.id === gid);
  const ids = ag ? collectTermIds(ag.root) : [];
  let sid = activeSessionId;
  if (!ag || !(sid && ids.includes(sid))) sid = ids[ids.length - 1] ?? null;
  return { groups: pruned, activeGroupId: gid, activeSessionId: sid };
}

interface TerminalStore {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  isBottomPanelOpen: boolean;
  /** 분할 그룹 목록 (사이드바 = 그룹별 묶음, 메인 영역 = 활성 그룹의 분할 트리) */
  groups: TerminalGroup[];
  /** 현재 메인 영역에 표시 중인 그룹 */
  activeGroupId: string | null;
  /** 드래그 중인 터미널 세션 id (WKWebView가 dataTransfer 커스텀 타입을 노출 안 하므로 스토어로 전달) */
  draggingTerminal: string | null;

  /** cwd 지정 시 셸 시작 후 해당 경로로 이동 (실패하면 홈 유지). 미지정 시 세션 베이스 경로 사용 */
  createSession: (connectionId: string, title?: string, cwd?: string) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  /** 해당 연결의 모든 터미널을 닫는다 (세션 종료 시) */
  closeConnectionSessions: (connectionId: string) => Promise<void>;
  /** 해당 연결의 죽은 터미널을 새 채널로 재생성한다 (재접속 후). 제목은 유지, scrollback은 초기화 */
  recreateConnectionSessions: (connectionId: string) => Promise<void>;
  setActiveSession: (id: string | null) => void;
  /** 사이드바 클릭: 그 터미널이 속한 그룹을 활성화하고 포커스 */
  focusTerminal: (id: string) => void;
  /** 드래그한 기존 터미널을 target 옆(좌/우/상/하)으로 이동 — 그룹 간 이동·그룹 내 재배치 */
  splitTerminal: (draggedId: string, targetId: string, side: TermDropSide) => void;
  /** target 옆에 같은 연결의 새 터미널을 만들어 같은 그룹에 분할 추가 (쪼개기·분할 버튼) */
  splitNewTerminal: (targetId: string, side: TermDropSide) => Promise<string | null>;
  /** 해당 패널을 그룹에서 분리해 단독 그룹(별도 탭)으로 빼낸다 (세션은 유지) */
  detachPane: (id: string) => void;
  /** 그룹 안 split 노드(path)의 자식 비율 갱신 — 거터 드래그 */
  setSplitSizes: (groupId: string, path: number[], sizes: number[]) => void;
  /** 터미널 이름 변경 (빈 문자열은 무시) */
  renameTerminal: (id: string, title: string) => void;
  setDraggingTerminal: (id: string | null) => void;
  setTerminalTheme: (id: string, theme: 'dark' | 'light') => void;
  toggleBottomPanel: () => void;
  openBottomPanel: () => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isBottomPanelOpen: false,
  groups: [],
  activeGroupId: null,
  draggingTerminal: null,

  createSession: async (connectionId, title, cwd) => {
    try {
      const info = await spawnTerminal(
        connectionId,
        title ?? `터미널 ${get().sessions.length + 1}`,
        cwd
      );
      const gid = nextGroupId();
      set((state) => ({
        sessions: [...state.sessions, info],
        // 새 터미널은 자체 그룹(단독 탭). 기존 분할 그룹은 그대로 유지
        groups: [...state.groups, { id: gid, root: { type: 'leaf', id: info.id } }],
        activeGroupId: gid,
        activeSessionId: info.id,
        isBottomPanelOpen: true,
      }));
      log.info(`터미널 생성: ${info.title}`);
      return info.id;
    } catch (e) {
      log.error(`터미널 생성 실패: ${e}`);
      throw e;
    }
  },

  closeSession: async (sessionId) => {
    await terminalClose(sessionId);
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      const groups = state.groups
        .map((g) => ({ ...g, root: removeTermLeaf(g.root, sessionId) }))
        .filter((g): g is TerminalGroup => g.root !== null);
      const r = reconcileActive(groups, state.activeGroupId, state.activeSessionId);
      return { sessions, ...r, isBottomPanelOpen: sessions.length > 0 };
    });
  },

  closeConnectionSessions: async (connectionId) => {
    const targets = get().sessions.filter((s) => s.connectionId === connectionId);
    for (const t of targets) {
      try {
        await terminalClose(t.id);
      } catch {
        /* 이미 죽은 터미널 — 무시 */
      }
    }
    set((state) => {
      const sessions = state.sessions.filter((s) => s.connectionId !== connectionId);
      let groups = state.groups;
      for (const t of targets) {
        groups = groups
          .map((g) => ({ ...g, root: removeTermLeaf(g.root, t.id) }))
          .filter((g): g is TerminalGroup => g.root !== null);
      }
      const r = reconcileActive(groups, state.activeGroupId, state.activeSessionId);
      return {
        sessions,
        ...r,
        isBottomPanelOpen: sessions.length > 0 ? state.isBottomPanelOpen : false,
      };
    });
  },

  recreateConnectionSessions: async (connectionId) => {
    const targets = get().sessions.filter((s) => s.connectionId === connectionId);
    if (targets.length === 0) return;
    // 죽은 백엔드 채널 정리 후 동일 개수만큼 새 터미널 생성 (id 교체)
    const replacements = await Promise.all(
      targets.map(async (t) => {
        try {
          await terminalClose(t.id);
        } catch {
          /* 무시 */
        }
        try {
          const newId = await terminalCreate(connectionId, 80, 24);
          const dir = useFileTreeStore.getState().rootPaths.get(connectionId);
          if (dir && dir !== '~') {
            const cmd = `cd ${shellQuote(dir)} 2>/dev/null || cd ~\n`;
            terminalWrite(newId, toBase64(cmd)).catch(() => {});
          }
          return { oldId: t.id, info: { ...t, id: newId } };
        } catch {
          return null;
        }
      })
    );
    set((state) => {
      let sessions = [...state.sessions];
      let activeSessionId = state.activeSessionId;
      let groups = state.groups;
      for (const rep of replacements) {
        if (!rep) continue;
        sessions = sessions.map((s) => (s.id === rep.oldId ? rep.info : s));
        if (activeSessionId === rep.oldId) activeSessionId = rep.info.id;
        // 분할 트리의 리프 id도 새 id로 교체 (레이아웃 보존)
        groups = groups.map((g) => ({ ...g, root: renameTermLeaf(g.root, rep.oldId, rep.info.id) }));
      }
      return { sessions, activeSessionId, groups };
    });
    log.info('재접속에 따라 터미널을 새로 시작했습니다');
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  focusTerminal: (id) =>
    set((state) => {
      const g = findGroup(state.groups, id);
      if (!g) return {};
      return { activeGroupId: g.id, activeSessionId: id };
    }),

  splitTerminal: (draggedId, targetId, side) =>
    set((state) => {
      if (draggedId === targetId) return {};
      const targetGroup = findGroup(state.groups, targetId);
      if (!targetGroup) return {};
      // 드래그한 터미널을 원래 위치에서 제거 → target 옆에 삽입
      let groups = state.groups
        .map((g) => ({ ...g, root: removeTermLeaf(g.root, draggedId) }))
        .filter((g): g is TerminalGroup => g.root !== null);
      groups = groups.map((g) =>
        g.id === targetGroup.id
          ? { ...g, root: insertTermAdjacent(g.root, targetId, draggedId, side) }
          : g
      );
      return { groups, activeGroupId: targetGroup.id, activeSessionId: draggedId };
    }),

  splitNewTerminal: async (targetId, side) => {
    const target = get().sessions.find((s) => s.id === targetId);
    if (!target) return null;
    try {
      const info = await spawnTerminal(target.connectionId, `터미널 ${get().sessions.length + 1}`);
      set((state) => {
        const tg = findGroup(state.groups, targetId);
        if (!tg) {
          const gid = nextGroupId();
          return {
            sessions: [...state.sessions, info],
            groups: [...state.groups, { id: gid, root: { type: 'leaf', id: info.id } }],
            activeGroupId: gid,
            activeSessionId: info.id,
            isBottomPanelOpen: true,
          };
        }
        const groups = state.groups.map((g) =>
          g.id === tg.id ? { ...g, root: insertTermAdjacent(g.root, targetId, info.id, side) } : g
        );
        return {
          sessions: [...state.sessions, info],
          groups,
          activeGroupId: tg.id,
          activeSessionId: info.id,
          isBottomPanelOpen: true,
        };
      });
      log.info(`터미널 분할 생성: ${info.title}`);
      return info.id;
    } catch (e) {
      log.error(`터미널 분할 생성 실패: ${e}`);
      return null;
    }
  },

  detachPane: (id) =>
    set((state) => {
      const g = findGroup(state.groups, id);
      if (!g || collectTermIds(g.root).length <= 1) return {}; // 이미 단독 그룹
      const remain = removeTermLeaf(g.root, id);
      if (!remain) return {};
      const idx = state.groups.findIndex((x) => x.id === g.id);
      const groups = [...state.groups];
      groups[idx] = { ...g, root: remain };
      groups.splice(idx + 1, 0, { id: nextGroupId(), root: { type: 'leaf', id } });
      // 원본 그룹을 계속 표시, 빠진 게 포커스였으면 원본의 마지막으로
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === id) {
        const ids = collectTermIds(remain);
        activeSessionId = ids[ids.length - 1];
      }
      return { groups, activeGroupId: g.id, activeSessionId };
    }),

  setSplitSizes: (groupId, path, sizes) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, root: setSizesAt(g.root, path, sizes) } : g
      ),
    })),

  renameTerminal: (id, title) =>
    set((state) => {
      const next = title.trim();
      if (!next) return {};
      return { sessions: state.sessions.map((s) => (s.id === id ? { ...s, title: next } : s)) };
    }),

  setDraggingTerminal: (id) => set({ draggingTerminal: id }),

  setTerminalTheme: (id, theme) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, theme } : s)),
    })),

  toggleBottomPanel: () => {
    set((state) => ({ isBottomPanelOpen: !state.isBottomPanelOpen }));
  },

  openBottomPanel: () => set({ isBottomPanelOpen: true }),
}));
