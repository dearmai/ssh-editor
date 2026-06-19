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
    try {
      const sessionId = await sshConnect(profile);
      set((state) => ({
        activeConnections: [
          ...state.activeConnections,
          { sessionId, profile },
        ],
        selectedSessionId: sessionId,
      }));
      return sessionId;
    } catch (e) {
      set({ error: String(e) });
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
    await sshDisconnect(sessionId);
    set((state) => ({
      activeConnections: state.activeConnections.filter((c) => c.sessionId !== sessionId),
      selectedSessionId:
        state.selectedSessionId === sessionId ? null : state.selectedSessionId,
    }));
  },

  setSelectedSession: (id) => set({ selectedSessionId: id }),

  refreshActiveConnections: async () => {
    const activeConnections = await getActiveConnections();
    set({ activeConnections });
  },
}));
