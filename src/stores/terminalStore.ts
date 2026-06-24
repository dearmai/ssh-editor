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

/** 분할 그룹 = VSCode식 "터미널 탭". 여러 터미널을 나란히(가로 분할) 묶는다. 순서 = 열 순서 */
export interface TerminalGroup {
  id: string;
  terminalIds: string[];
}

let groupSeq = 0;
function nextGroupId(): string {
  return `tg${++groupSeq}`;
}

function findGroup(groups: TerminalGroup[], terminalId: string): TerminalGroup | undefined {
  return groups.find((g) => g.terminalIds.includes(terminalId));
}

/** 빈 그룹 제거 + activeGroup/activeSession 정합성 보정 */
function reconcileActive(
  groups: TerminalGroup[],
  activeGroupId: string | null,
  activeSessionId: string | null
): { groups: TerminalGroup[]; activeGroupId: string | null; activeSessionId: string | null } {
  const pruned = groups.filter((g) => g.terminalIds.length > 0);
  let gid = activeGroupId;
  if (!pruned.some((g) => g.id === gid)) gid = pruned[pruned.length - 1]?.id ?? null;
  const ag = pruned.find((g) => g.id === gid);
  let sid = activeSessionId;
  if (!ag || !(sid && ag.terminalIds.includes(sid))) {
    sid = ag ? ag.terminalIds[ag.terminalIds.length - 1] : null;
  }
  return { groups: pruned, activeGroupId: gid, activeSessionId: sid };
}

interface TerminalStore {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  isBottomPanelOpen: boolean;
  /** 분할 그룹 목록 (사이드바 = 그룹별 묶음, 메인 영역 = 활성 그룹의 패널들 나란히) */
  groups: TerminalGroup[];
  /** 현재 메인 영역에 표시 중인 그룹 */
  activeGroupId: string | null;
  /** 열별 flex 가중치(상대값). 터미널 id 기준. 미지정 시 1 — 동일 폭 */
  columnSizes: Record<string, number>;
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
  /** 드래그한 기존 터미널을 target 패널의 그룹에 합쳐(좌/우) 가로 분할 — 그룹 간 이동·그룹 내 재배치 */
  splitTerminal: (draggedId: string, targetId: string, side: 'left' | 'right') => void;
  /** target 패널 옆에 같은 연결의 새 터미널을 만들어 같은 그룹에 분할 추가 (단일 쪼개기·분할 버튼) */
  splitNewTerminal: (targetId: string, side: 'left' | 'right') => Promise<string | null>;
  /** 해당 패널을 그룹에서 분리해 단독 그룹(별도 탭)으로 빼낸다 (세션은 유지) */
  removeColumn: (id: string) => void;
  setColumnSizes: (sizes: Record<string, number>) => void;
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
  columnSizes: {},
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
        groups: [...state.groups, { id: gid, terminalIds: [info.id] }],
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
      const groups = state.groups.map((g) => ({
        ...g,
        terminalIds: g.terminalIds.filter((t) => t !== sessionId),
      }));
      const { [sessionId]: _drop, ...columnSizes } = state.columnSizes;
      const r = reconcileActive(groups, state.activeGroupId, state.activeSessionId);
      return { sessions, columnSizes, ...r, isBottomPanelOpen: sessions.length > 0 };
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
      const alive = new Set(sessions.map((s) => s.id));
      const groups = state.groups.map((g) => ({
        ...g,
        terminalIds: g.terminalIds.filter((t) => alive.has(t)),
      }));
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
      let groups = state.groups.map((g) => ({ ...g, terminalIds: [...g.terminalIds] }));
      const columnSizes = { ...state.columnSizes };
      for (const rep of replacements) {
        if (!rep) continue;
        sessions = sessions.map((s) => (s.id === rep.oldId ? rep.info : s));
        if (activeSessionId === rep.oldId) activeSessionId = rep.info.id;
        // 그룹 멤버·가중치도 새 id로 교체 (id가 바뀌므로)
        groups = groups.map((g) => ({
          ...g,
          terminalIds: g.terminalIds.map((t) => (t === rep.oldId ? rep.info.id : t)),
        }));
        if (rep.oldId in columnSizes) {
          columnSizes[rep.info.id] = columnSizes[rep.oldId];
          delete columnSizes[rep.oldId];
        }
      }
      return { sessions, activeSessionId, groups, columnSizes };
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
      // 드래그한 터미널을 모든 그룹에서 제거 → target 그룹의 target 옆에 삽입
      let groups = state.groups.map((g) => ({
        ...g,
        terminalIds: g.terminalIds.filter((t) => t !== draggedId),
      }));
      groups = groups.map((g) => {
        if (g.id !== targetGroup.id) return g;
        const ids = [...g.terminalIds];
        let ti = ids.indexOf(targetId);
        if (ti < 0) ti = ids.length - 1;
        ids.splice(side === 'left' ? ti : ti + 1, 0, draggedId);
        return { ...g, terminalIds: ids };
      });
      groups = groups.filter((g) => g.terminalIds.length > 0);
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
            groups: [...state.groups, { id: gid, terminalIds: [info.id] }],
            activeGroupId: gid,
            activeSessionId: info.id,
            isBottomPanelOpen: true,
          };
        }
        const groups = state.groups.map((g) => {
          if (g.id !== tg.id) return g;
          const ids = [...g.terminalIds];
          let ti = ids.indexOf(targetId);
          if (ti < 0) ti = ids.length - 1;
          ids.splice(side === 'left' ? ti : ti + 1, 0, info.id);
          return { ...g, terminalIds: ids };
        });
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

  removeColumn: (id) =>
    set((state) => {
      const g = findGroup(state.groups, id);
      if (!g || g.terminalIds.length <= 1) return {}; // 이미 단독 그룹
      const idx = state.groups.findIndex((x) => x.id === g.id);
      const updated = { ...g, terminalIds: g.terminalIds.filter((t) => t !== id) };
      const newGid = nextGroupId();
      const groups = [...state.groups];
      groups[idx] = updated;
      groups.splice(idx + 1, 0, { id: newGid, terminalIds: [id] }); // 분리된 패널 = 새 단독 그룹
      // 원본 그룹을 계속 표시, 빠진 게 포커스였으면 원본의 마지막으로
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === id) activeSessionId = updated.terminalIds[updated.terminalIds.length - 1];
      return { groups, activeGroupId: g.id, activeSessionId };
    }),

  setColumnSizes: (sizes) =>
    set((state) => ({ columnSizes: { ...state.columnSizes, ...sizes } })),

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
