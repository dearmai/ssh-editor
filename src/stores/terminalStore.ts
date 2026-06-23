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

interface TerminalStore {
  sessions: TerminalSessionInfo[];
  activeSessionId: string | null;
  isBottomPanelOpen: boolean;

  /** cwd 지정 시 셸 시작 후 해당 경로로 이동 (실패하면 홈 유지). 미지정 시 세션 베이스 경로 사용 */
  createSession: (connectionId: string, title?: string, cwd?: string) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  /** 해당 연결의 모든 터미널을 닫는다 (세션 종료 시) */
  closeConnectionSessions: (connectionId: string) => Promise<void>;
  /** 해당 연결의 죽은 터미널을 새 채널로 재생성한다 (재접속 후). 제목은 유지, scrollback은 초기화 */
  recreateConnectionSessions: (connectionId: string) => Promise<void>;
  setActiveSession: (id: string | null) => void;
  setTerminalTheme: (id: string, theme: 'dark' | 'light') => void;
  toggleBottomPanel: () => void;
  openBottomPanel: () => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isBottomPanelOpen: false,

  createSession: async (connectionId, title, cwd) => {
    try {
      const sessionId = await terminalCreate(connectionId, 80, 24);

      // 시작 디렉토리로 이동 (현재 세션 베이스 경로 → 실패 시 홈)
      const dir = cwd ?? useFileTreeStore.getState().rootPaths.get(connectionId);
      if (dir && dir !== '~') {
        const cmd = `cd ${shellQuote(dir)} 2>/dev/null || cd ~\n`;
        terminalWrite(sessionId, toBase64(cmd)).catch(() => {});
      }

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
      const activeAlive = sessions.some((s) => s.id === state.activeSessionId);
      return {
        sessions,
        activeSessionId: activeAlive ? state.activeSessionId : sessions[sessions.length - 1]?.id ?? null,
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
      for (const r of replacements) {
        if (!r) continue;
        sessions = sessions.map((s) => (s.id === r.oldId ? r.info : s));
        if (activeSessionId === r.oldId) activeSessionId = r.info.id;
      }
      return { sessions, activeSessionId };
    });
    log.info('재접속에 따라 터미널을 새로 시작했습니다');
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
