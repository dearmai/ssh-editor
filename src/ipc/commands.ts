import { invoke } from '@tauri-apps/api/core';
import type {
  ActiveConnection,
  ArchiveFormat,
  ConnectionProfile,
  FileEntry,
  FileStat,
  PingInfo,
  ProbeResult,
  SshConfigHost,
  StartupArgs,
} from '../types';

// --- SSH 연결 ---
export const sshConnect = (profile: ConnectionProfile) =>
  invoke<string>('ssh_connect', { profile });

export const sshDisconnect = (sessionId: string) =>
  invoke<void>('ssh_disconnect', { sessionId });

export const sshPing = (sessionId: string) =>
  invoke<PingInfo>('ssh_ping', { sessionId });

export const openNewWindow = () =>
  invoke<void>('open_new_window');

export const getActiveConnections = () =>
  invoke<ActiveConnection[]>('get_active_connections');

// --- 설정 ---
export const loadSshConfig = () =>
  invoke<SshConfigHost[]>('load_ssh_config');

export const loadProfiles = () =>
  invoke<ConnectionProfile[]>('load_profiles');

export const saveProfile = (profile: ConnectionProfile) =>
  invoke<void>('save_profile', { profile });

export const deleteProfile = (id: string) =>
  invoke<void>('delete_profile', { id });

// --- SFTP ---
export const sftpListDir = (sessionId: string, path: string) =>
  invoke<FileEntry[]>('sftp_list_dir', { sessionId, path });

export const sftpReadFile = (sessionId: string, path: string) =>
  invoke<string>('sftp_read_file', { sessionId, path });

export const sftpWriteFile = (sessionId: string, path: string, content: string) =>
  invoke<FileStat>('sftp_write_file', { sessionId, path, content });

export const sftpStat = (sessionId: string, path: string) =>
  invoke<FileStat>('sftp_stat', { sessionId, path });

export const sftpCreateFile = (sessionId: string, path: string) =>
  invoke<void>('sftp_create_file', { sessionId, path });

export const sftpDeletePath = (sessionId: string, path: string) =>
  invoke<void>('sftp_delete_path', { sessionId, path });

export const sftpRenamePath = (sessionId: string, from: string, to: string) =>
  invoke<void>('sftp_rename_path', { sessionId, from, to });

export const sftpCreateDir = (sessionId: string, path: string) =>
  invoke<void>('sftp_create_dir', { sessionId, path });

// --- 전송 (업로드/다운로드) ---
export const sftpProbe = (sessionId: string, path: string) =>
  invoke<ProbeResult>('sftp_probe', { sessionId, path });

export const sftpUpload = (
  sessionId: string,
  localPath: string,
  remotePath: string,
  transferId: string
) => invoke<void>('sftp_upload', { sessionId, localPath, remotePath, transferId });

export const sftpDownload = (
  sessionId: string,
  remotePath: string,
  localPath: string,
  transferId: string
) => invoke<void>('sftp_download', { sessionId, remotePath, localPath, transferId });

export const sftpDownloadDir = (
  sessionId: string,
  remotePath: string,
  localPath: string,
  format: ArchiveFormat,
  transferId: string
) => invoke<void>('sftp_download_dir', { sessionId, remotePath, localPath, format, transferId });

// --- 터미널 ---
export const terminalCreate = (connectionId: string, cols: number, rows: number) =>
  invoke<string>('terminal_create', { connectionId, cols, rows });

export const terminalWrite = (terminalId: string, data: string) =>
  invoke<void>('terminal_write', { terminalId, data });

export const terminalResize = (terminalId: string, cols: number, rows: number) =>
  invoke<void>('terminal_resize', { terminalId, cols, rows });

export const terminalClose = (terminalId: string) =>
  invoke<void>('terminal_close', { terminalId });

// --- CLI ---
export const getStartupArgs = () =>
  invoke<StartupArgs | null>('get_startup_args');
