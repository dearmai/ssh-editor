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
  /** 즐겨찾기/시작 디렉토리 목록 (첫 번째가 기본 시작 디렉토리) */
  directories?: string[];
}

export interface PingInfo {
  /** 서버 UTC epoch (초) */
  epoch: number;
  /** 서버 타임존 오프셋 (분) */
  tzOffsetMinutes: number;
  /** 왕복 지연 (ms) */
  pingMs: number;
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

export interface FileStat {
  size: number;
  mtime?: number;
}

export interface ProbeResult {
  size: number;
  isBinary: boolean;
}

export type ArchiveFormat = 'zip' | 'targz' | 'tarxz';

export interface TransferProgressEvent {
  id: string;
  transferred: number;
  total: number;
  status: 'active' | 'done' | 'error';
  error?: string;
}

export interface EditorTab {
  id: string; // `${connectionId}:${remotePath}`
  connectionId: string;
  remotePath: string;
  fileName: string;
  content: string;
  isDirty: boolean;
  language: string;
  /** 마지막으로 읽거나 저장한 시점의 원격 파일 mtime/size (외부 변경 감지용) */
  baseMtime?: number;
  baseSize?: number;
  /** 사용자가 이미 "무시"한 외부 변경의 mtime (같은 변경을 반복해서 묻지 않기 위함) */
  seenMtime?: number;
}

export interface TerminalSessionInfo {
  id: string;
  connectionId: string;
  title: string;
  /** 터미널 개별 테마 오버라이드 (비영속). 없으면 앱 테마를 따름 */
  theme?: 'dark' | 'light';
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
