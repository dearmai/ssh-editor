import { create } from 'zustand';
import {
  deleteProfile,
  getActiveConnections,
  loadProfiles,
  loadSshConfig,
  saveProfile,
  sshConnect,
  sshDisconnect,
  sshHealthCheck,
  sshReconnect,
} from '../ipc/commands';
import type { ActiveConnection, ConnectionProfile, SshConfigHost } from '../types';
import { log } from './logStore';
import { useEditorStore } from './editorStore';
import { useFileTreeStore } from './fileTreeStore';
import { useTerminalStore } from './terminalStore';

/** 끊긴 연결 복구 다이얼로그 상태 */
export interface ReconnectState {
  sessionId: string;
  profileName: string;
  /** 'reconnecting': 자동 재접속 시도 중 / 'failed': 5초 내 실패 → 사용자 선택 대기 */
  phase: 'reconnecting' | 'failed';
}

const RECONNECT_TIMEOUT_MS = 5000;

interface ConnectionStore {
  profiles: ConnectionProfile[];
  sshConfigHosts: SshConfigHost[];
  activeConnections: ActiveConnection[];
  selectedSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  /** 끊긴 연결 복구 다이얼로그 상태 (null이면 닫힘) */
  reconnect: ReconnectState | null;

  loadAll: () => Promise<void>;
  addProfile: (profile: ConnectionProfile) => Promise<void>;
  updateProfile: (profile: ConnectionProfile) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  /** startPath: 이 세션이 열릴 시작 경로 (기본 터미널의 cwd로도 사용) */
  connect: (profile: ConnectionProfile, startPath?: string) => Promise<string>;
  connectFromSshConfig: (host: SshConfigHost) => Promise<string>;
  disconnect: (sessionId: string) => Promise<void>;
  setSelectedSession: (id: string | null) => void;
  refreshActiveConnections: () => Promise<void>;
  /** 활성 연결의 시작 디렉토리 목록을 갱신하고 프로필에 영속화 */
  saveActiveDirectories: (sessionId: string, directories: string[]) => Promise<void>;

  /** 활성 연결들의 생존을 점검하고, 끊긴 연결이 있으면 자동 재접속을 시도한다 (창 복귀 시 호출) */
  checkConnections: () => Promise<void>;
  /** 끊긴 세션을 5초 제한으로 재접속 시도. 실패 시 다이얼로그를 'failed'로 전환 */
  attemptReconnect: (sessionId: string) => Promise<void>;
  /** 재접속 다이얼로그에서의 사용자 선택 처리 ('retry' 재시도 / 'close' 세션 종료) */
  resolveReconnect: (action: 'retry' | 'close') => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  profiles: [],
  sshConfigHosts: [],
  activeConnections: [],
  selectedSessionId: null,
  isLoading: false,
  error: null,
  reconnect: null,

  loadAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const [profiles, sshConfigHosts, activeConnections] = await Promise.all([
        loadProfiles(),
        loadSshConfig(),
        getActiveConnections(),
      ]);
      set({ profiles, sshConfigHosts, activeConnections });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  addProfile: async (profile) => {
    await saveProfile(profile);
    const profiles = await loadProfiles();
    set({ profiles });
  },

  updateProfile: async (profile) => {
    await saveProfile(profile);
    const profiles = await loadProfiles();
    set({ profiles });
  },

  removeProfile: async (id) => {
    await deleteProfile(id);
    set((state) => ({ profiles: state.profiles.filter((p) => p.id !== id) }));
  },

  connect: async (profile, startPath) => {
    set({ isLoading: true, error: null });
    log.info(`연결 시도: ${profile.username}@${profile.hostname}:${profile.port}`);
    try {
      const sessionId = await sshConnect(profile);
      set((state) => ({
        activeConnections: [
          ...state.activeConnections,
          { sessionId, profile },
        ],
        selectedSessionId: sessionId,
      }));
      log.info(`연결됨: ${profile.name} (${profile.hostname})`);
      // 최초 접속 시 기본 터미널 1개 생성 (세션 시작 경로에서 시작)
      const base = startPath ?? profile.directories?.[0] ?? profile.lastPath;
      useTerminalStore
        .getState()
        .createSession(sessionId, '터미널', base)
        .catch((e) => log.warn(`기본 터미널 생성 실패: ${e}`));
      return sessionId;
    } catch (e) {
      set({ error: String(e) });
      log.error(`연결 실패: ${profile.hostname} — ${e}`);
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  connectFromSshConfig: async (host) => {
    const profile: ConnectionProfile = {
      id: `ssh-config:${host.alias}`,
      name: host.alias,
      hostname: host.hostname,
      port: host.port ?? 22,
      username: host.user ?? '',
      authType: host.identityFile ? 'publicKey' : 'agent',
      identityFile: host.identityFile,
    };
    return get().connect(profile);
  },

  disconnect: async (sessionId) => {
    const conn = get().activeConnections.find((c) => c.sessionId === sessionId);
    await sshDisconnect(sessionId);
    set((state) => ({
      activeConnections: state.activeConnections.filter((c) => c.sessionId !== sessionId),
      selectedSessionId:
        state.selectedSessionId === sessionId ? null : state.selectedSessionId,
    }));
    if (conn) log.warn(`연결 해제: ${conn.profile.name} (${conn.profile.hostname})`);
  },

  setSelectedSession: (id) => set({ selectedSessionId: id }),

  refreshActiveConnections: async () => {
    const activeConnections = await getActiveConnections();
    set({ activeConnections });
  },

  saveActiveDirectories: async (sessionId, directories) => {
    const conn = get().activeConnections.find((c) => c.sessionId === sessionId);
    if (!conn) return;
    const updated: ConnectionProfile = { ...conn.profile, directories };

    // 활성 연결 스냅샷 + 저장된 프로필 목록 즉시 갱신
    set((state) => ({
      activeConnections: state.activeConnections.map((c) =>
        c.sessionId === sessionId ? { ...c, profile: updated } : c
      ),
      profiles: state.profiles.some((p) => p.id === updated.id)
        ? state.profiles.map((p) => (p.id === updated.id ? updated : p))
        : state.profiles,
    }));

    // 프로필에 영속화 (upsert)
    try {
      await saveProfile(updated);
      log.info(`시작 디렉토리 저장: ${updated.name} (${directories.length}개)`);
    } catch (e) {
      log.warn(`시작 디렉토리 저장 실패: ${e}`);
    }
  },

  checkConnections: async () => {
    // 이미 복구 다이얼로그가 떠 있으면 중복 점검하지 않음
    if (get().reconnect) return;
    for (const c of get().activeConnections) {
      const alive = await sshHealthCheck(c.sessionId).catch(() => false);
      // 점검 도중 다른 흐름이 다이얼로그를 띄웠으면 중단
      if (get().reconnect) return;
      if (!alive) {
        await get().attemptReconnect(c.sessionId);
        return; // 한 번에 하나씩 처리 (성공/종료 후 이어서 재점검)
      }
    }
  },

  attemptReconnect: async (sessionId) => {
    const conn = get().activeConnections.find((c) => c.sessionId === sessionId);
    if (!conn) {
      set({ reconnect: null });
      return;
    }
    const profileName = conn.profile.name;
    set({ reconnect: { sessionId, profileName, phase: 'reconnecting' } });
    log.warn(`연결 끊김 감지 — 재접속 시도: ${profileName}`);

    const ok = await Promise.race([
      sshReconnect(sessionId).then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), RECONNECT_TIMEOUT_MS)),
    ]);

    if (ok) {
      set({ reconnect: null });
      log.info(`재접속 성공: ${profileName}`);
      // 열린 디렉토리 새로고침 + 죽은 터미널 재생성
      await useFileTreeStore.getState().refreshConnection(sessionId).catch(() => {});
      await useTerminalStore.getState().recreateConnectionSessions(sessionId).catch(() => {});
      // 다른 끊긴 연결이 있으면 이어서 점검
      get().checkConnections();
    } else {
      set({ reconnect: { sessionId, profileName, phase: 'failed' } });
      log.error(`재접속 실패 (${RECONNECT_TIMEOUT_MS / 1000}초 초과): ${profileName}`);
    }
  },

  resolveReconnect: async (action) => {
    const r = get().reconnect;
    if (!r) return;
    if (action === 'retry') {
      await get().attemptReconnect(r.sessionId);
      return;
    }
    // 'close' — 이 세션의 탭/터미널을 닫고 연결을 정리
    set({ reconnect: null });
    const { sessionId, profileName } = r;
    useEditorStore.getState().closeConnectionTabs(sessionId);
    await useTerminalStore.getState().closeConnectionSessions(sessionId).catch(() => {});
    await get().disconnect(sessionId).catch(() => {});
    log.warn(`세션 종료: ${profileName}`);
    // 남은 연결 재점검
    get().checkConnections();
  },
}));
