export interface ConnectionProfile {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: 'password' | 'publicKey' | 'agent';
  password?: string;
  identityFile?: string;
  lastPath?: string;
}

export interface SshConfigHost {
  alias: string;
  hostname: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified?: number;
  permissions?: number;
}

export interface EditorTab {
  id: string; // `${connectionId}:${remotePath}`
  connectionId: string;
  remotePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  language: string;
}

export interface TerminalSessionInfo {
  id: string;
  connectionId: string;
  title: string;
}

export interface ActiveConnection {
  sessionId: string;
  profile: ConnectionProfile;
}

export interface StartupArgs {
  host: string;
  username?: string;
  path?: string;
  profileId?: string;
}

export interface TerminalDataEvent {
  terminalId: string;
  data: string; // Base64
}
