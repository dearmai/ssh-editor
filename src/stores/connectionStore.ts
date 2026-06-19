import { create } from 'zustand';
import {
  deleteProfile,
  getActiveConnections,
  loadProfiles,
  loadSshConfig,
  saveProfile,
  sshConnect,
  sshDisconnect,
} from '../ipc/commands';
import type { ActiveConnection, ConnectionProfile, SshConfigHost } from '../types';
import { log } from './logStore';
import { useTerminalStore } from './terminalStore';

interface ConnectionStore {
  profiles: ConnectionProfile[];
  sshConfigHosts: SshConfigHost[];
  activeConnections: ActiveConnection[];
  selectedSessionId: string | null;
  isLoading: boolean;
  error: string | null;

  loadAll: () => Promise<void>;
  addProfile: (profile: ConnectionProfile) => Promise<void>;
  updateProfile: (profile: ConnectionProfile) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  connect: (profile: ConnectionProfile) => Promise<string>;
  connectFromSshConfig: (host: SshConfigHost) => Promise<string>;
  disconnect: (sessionId: string) => Promise<void>;
  setSelectedSession: (id: string | null) => void;
  refreshActiveConnections: () => Promise<void>;
  /** 활성 연결의 시작 디렉토리 목록을 갱신하고 프로필에 영속화 */
  saveActiveDirectories: (sessionId: string, directories: string[]) => Promise<void>;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  profiles: [],
  sshConfigHosts: [],
  activeConnections: [],
  selectedSessionId: null,
  isLoading: false,
  error: null,

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

  connect: async (profile) => {
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
      // 최초 접속 시 기본 터미널 1개 생성
      useTerminalStore
        .getState()
        .createSession(sessionId, '터미널')
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
}));
