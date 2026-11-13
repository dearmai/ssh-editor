import { invoke } from '@tauri-apps/api/core';
import type { NativeClipboardUpload } from '../types/uploads';

export const readClipboardUploads = () => invoke<NativeClipboardUpload[]>('read_clipboard_uploads');
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
import { openLimits } from '../stores/settingsStore';

// --- SSH 연결 ---
export const sshConnect = (profile: ConnectionProfile) =>
  invoke<string>('ssh_connect', { profile });

export const sshDisconnect = (sessionId: string) =>
  invoke<void>('ssh_disconnect', { sessionId });

export const sshPing = (sessionId: string) =>
  invoke<PingInfo>('ssh_ping', { sessionId });

/** 세션 생존 여부 점검 (5초 내 ping 성공 시 true) */
export const sshHealthCheck = (sessionId: string) =>
  invoke<boolean>('ssh_health_check', { sessionId });

/** 동일한 sessionId를 유지한 채 재접속 */
export const sshReconnect = (sessionId: string) =>
  invoke<void>('ssh_reconnect', { sessionId });

/** 파일 접근 방식: 'sftp' 또는 SFTP 차단 서버용 셸 대체 경로('shell-gnu' | 'shell-bsd' | 'shell-perl') */
export const sshFileAccess = (sessionId: string) =>
  invoke<string>('ssh_file_access', { sessionId });

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
export const pathHome = (sessionId: string) => invoke<string>('path_home', { sessionId });
export const sftpListDir = (sessionId: string, path: string) =>
  invoke<FileEntry[]>('sftp_list_dir', { sessionId, path });

/** 텍스트 파일 전체 읽기. limit 생략 시 앱 설정의 대용량 파일 한도(로컬/원격)를 적용 */
export const readTextFile = (sessionId: string, path: string, encoding?: string, limit = openLimits(sessionId).large) =>
  invoke<{ text: string; encoding: string }>('text_read_file', { sessionId, path, limit, encoding: encoding ?? null });
export const sftpReadFile = async (sessionId: string, path: string, limit = openLimits(sessionId).large, encoding?: string) =>
  (await readTextFile(sessionId, path, encoding, limit)).text;
/** BOM을 제외한 텍스트 자체의 인코딩 바이트 수 */
export const encodedLengths = (texts: string[], encoding: string) =>
  invoke<number[]>('text_encoded_lengths', { texts, encoding });

// --- 대용량·바이너리 보기 (구간 읽기) ---
export interface TextChunk { text: string; start: number; end: number; size: number }
export interface BytesChunk { data: string; offset: number; size: number }
export interface SearchHit { line: number; offset: number; text: string }
/** 로컬 파일 바이너리 판별 (앞 8KB) */
export const localProbe = (path: string) => invoke<ProbeResult>('local_probe', { path });
/** 로컬 텍스트 구간 — 줄 경계에 맞춰 [start, end) 를 돌려준다 */
export const localReadText = (path: string, offset: number, len: number) =>
  invoke<TextChunk>('local_read_text', { path, offset, len });
/** 바이트 구간 (base64) — 로컬/원격 */
export const readBytes = (sessionId: string, path: string, offset: number, len: number) =>
  sessionId === 'local'
    ? invoke<BytesChunk>('local_read_bytes', { path, offset, len })
    : invoke<BytesChunk>('sftp_read_bytes', { sessionId, path, offset, len });
// --- 대용량 로컬 텍스트: 줄 색인 · 줄 읽기 · 구간 편집 ---
export interface LineIndex { size: number; mtime?: number; newlines: number; total: number; every: number; offsets: number[] }
/** 희소 줄 색인 (every 줄마다 시작 위치). from 을 주면 늘어난 부분만 이어서 센다 */
export const localLineIndex = (path: string, from?: { offset: number; newlines: number }) =>
  invoke<LineIndex>('local_line_index', { path, fromOffset: from?.offset ?? null, fromNewlines: from?.newlines ?? null });
export const localReadLines = (path: string, anchor: number, skip: number, count: number) =>
  invoke<{ lines: string[]; nextOffset: number; eof: boolean }>('local_read_lines', { path, anchor, skip, count });
export interface Segment { text: string; start: number; end: number; lines: number; size: number; mtime?: number }
export const localReadSegment = (path: string, anchor: number, skip: number, count: number, maxBytes: number) =>
  invoke<Segment>('local_read_segment', { path, anchor, skip, count, maxBytes });
/** 원본의 [start, end) 를 content 로 바꿔 끼워 저장 (원본이 바뀌었으면 오류) */
export const localWriteSegment = (path: string, start: number, end: number, content: string, expectSize: number, expectMtime?: number) =>
  invoke<{ end: number; size: number; mtime?: number }>('local_write_segment', {
    path, start, end, content, expectSize, expectMtime: expectMtime ?? null,
  });
/** 로컬 파일 흘려 읽기 검색 (최대 200줄) */
export const localSearch = (path: string, query: string, ignoreCase: boolean) =>
  invoke<{ hits: SearchHit[]; truncated: boolean }>('local_search', { path, query, ignoreCase });

export interface LogChunk { text: string; offset: number; size: number }
export const sftpLogChunk = (sessionId: string, path: string, offset?: number) =>
  invoke<LogChunk>('sftp_log_chunk', { sessionId, path, offset });
export const sftpLogSearch = (sessionId: string, path: string, query: string) =>
  invoke<string>('sftp_log_search', { sessionId, path, query });

export const sftpWriteFile = (sessionId: string, path: string, content: string, encoding = 'utf-8') =>
  invoke<FileStat>('text_write_file', { sessionId, path, content, encoding });

export const sftpStat = (sessionId: string, path: string) =>
  invoke<FileStat>(sessionId === 'local' ? 'local_stat' : 'sftp_stat', { sessionId, path });

export const sftpCreateFile = (sessionId: string, path: string) =>
  invoke<void>('sftp_create_file', { sessionId, path });

export const sftpDeletePath = (sessionId: string, path: string) =>
  invoke<void>('sftp_delete_path', { sessionId, path });

export const sftpRenamePath = (sessionId: string, from: string, to: string) =>
  invoke<void>('sftp_rename_path', { sessionId, from, to });

/** 경로 복사(파일/디렉토리 모두, 재귀) */
export const sftpCopyPath = (sessionId: string, from: string, to: string) =>
  invoke<void>('sftp_copy_path', { sessionId, from, to });

export const sftpCreateDir = (sessionId: string, path: string) =>
  invoke<void>('sftp_create_dir', { sessionId, path });

export const sftpExists = (sessionId: string, path: string) =>
  invoke<boolean>('sftp_exists', { sessionId, path });

/** 디렉토리에 항목 생성/이동 권한(w+x)이 있는지 사전 점검 */
export const sftpCheckWriteAccess = (sessionId: string, path: string) =>
  invoke<boolean>('sftp_check_write_access', { sessionId, path });

// --- 전송 (업로드/다운로드) ---
export const sftpProbe = (sessionId: string, path: string) =>
  invoke<ProbeResult>('sftp_probe', { sessionId, path });

export const sftpUpload = (
  sessionId: string,
  localPath: string,
  remotePath: string,
  transferId: string
) => invoke<void>('sftp_upload', { sessionId, localPath, remotePath, transferId });

/** 드래그 앤 드롭 업로드(청크) — 대용량 파일을 조각내어 여러 번 호출 */
export const sftpUploadDataChunk = (
  sessionId: string,
  remotePath: string,
  dataB64: string,
  transferId: string,
  offset: number,
  total: number,
  isLast: boolean
) =>
  invoke<void>('sftp_upload_data_chunk', {
    sessionId,
    remotePath,
    dataB64,
    transferId,
    offset,
    total,
    isLast,
  });

/** 취소된 청크 업로드가 원격에 남긴 부분 파일 정리 */
export const sftpAbortUploadData = (sessionId: string, remotePath: string) =>
  invoke<void>('sftp_abort_upload_data', { sessionId, remotePath });

/** 진행 중인 전송 취소 요청 */
export const transferCancel = (transferId: string) =>
  invoke<void>('transfer_cancel', { transferId });

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
export const terminalPrepareUpload = (connectionId: string) =>
  invoke<string>('terminal_prepare_upload', { connectionId });

export const terminalCreate = (connectionId: string, cols: number, rows: number) =>
  invoke<string>('terminal_create', { connectionId, cols, rows });

export const terminalWrite = (terminalId: string, data: string) =>
  invoke<void>('terminal_write', { terminalId, data });

export const terminalResize = (terminalId: string, cols: number, rows: number) =>
  invoke<void>('terminal_resize', { terminalId, cols, rows });

/** 종료 확인 결과 보고 — 모든 창이 승인해야 앱이 종료된다 (Cmd+Q 흐름) */
export const exitVote = (approve: boolean) => invoke<void>('exit_vote', { approve });

export const terminalClose = (terminalId: string) =>
  invoke<void>('terminal_close', { terminalId });

// --- CLI ---
export const getStartupArgs = () =>
  invoke<StartupArgs | null>('get_startup_args');

// --- 로컬 작업 폴더 / 운영체제 파일 연결 ---
export const takeOpenFiles = () => invoke<string[]>('take_open_files');
export const localListDir = (path: string) => invoke<FileEntry[]>('local_list_dir', { path });
// --- 로컬 파일 보관(암호화) / 보관 해제(복호화) ---
export type CryptoMode = 'encrypt' | 'decrypt';
/** 선택한 파일·폴더를 처리 대상 파일로 펼침 (루트·시스템 폴더·5개 이상은 오류).
 *  mode 생략 시 자동: 모두 보관된 파일이면 보관 해제, 아니면 보관 */
export const localCryptoPlan = (paths: string[], mode?: CryptoMode) =>
  invoke<{ mode: CryptoMode; files: string[]; skipped: number }>('local_crypto_plan', { paths, mode: mode ?? null });
/** 대상 파일 일괄 처리 — 파일별 결과(output: 결과 경로, error: 실패 사유) */
export const localCryptoBatch = (paths: string[], password: string, extension: string, mode: CryptoMode) =>
  invoke<{ path: string; output: string | null; error: string | null }[]>('local_crypto_batch', {
    paths, password, extension, mode,
  });
/** 탐색기 우클릭 메뉴로 실행된 보관/보관 해제 요청 (한 번만 반환) */
export const takeCryptoRequest = () =>
  invoke<{ paths: string[] } | null>('take_crypto_request');
/** Windows 탐색기 우클릭 메뉴(보관/보관 해제) 등록 여부 */
export const explorerMenuStatus = () => invoke<boolean>('explorer_menu_status');
export const explorerMenuSet = (enabled: boolean) => invoke<void>('explorer_menu_set', { enabled });

// --- 운영체제 파일 연결 관리 (Windows) ---
export interface FileAssocStatus {
  ext: string;
  /** '연결 프로그램' 목록에 SSH Editor 등록 여부 */
  registered: boolean;
  /** 현재 기본 앱이 SSH Editor인지 */
  isDefault: boolean;
  /** 현재 기본 앱 이름 */
  defaultApp: string | null;
}
export interface FileAssocReport {
  supported: boolean;
  items: FileAssocStatus[];
}
export const fileAssocStatus = (exts: string[]) => invoke<FileAssocReport>('file_assoc_status', { exts });
export const fileAssocSet = (exts: string[], enabled: boolean) =>
  invoke<void>('file_assoc_set', { exts, enabled });
export const fileAssocOpenDefaults = () => invoke<void>('file_assoc_open_defaults');
