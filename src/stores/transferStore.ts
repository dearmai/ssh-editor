import { create } from 'zustand';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  sftpAbortUploadData,
  sftpCheckWriteAccess,
  sftpDownload,
  sftpDownloadDir,
  sftpExists,
  sftpUpload,
  sftpUploadDataChunk,
  transferCancel,
} from '../ipc/commands';
import type { ArchiveFormat, TransferProgressEvent } from '../types';
import { confirm } from './confirmStore';
import { log } from './logStore';
import { useFileTreeStore } from './fileTreeStore';

export type TransferStatus = 'queued' | 'active' | 'done' | 'error' | 'canceled';

export interface Transfer {
  id: string;
  kind: 'upload' | 'download';
  name: string;
  remotePath: string;
  localPath: string;
  total: number;
  transferred: number;
  speed: number; // 바이트/초
  status: TransferStatus;
  error?: string;
  startedAt: number;
}

interface TransferStore {
  transfers: Transfer[];
  applyProgress: (e: TransferProgressEvent) => void;
  uploadFiles: (sessionId: string, remoteDir: string) => Promise<void>;
  /** 드래그 앤 드롭으로 받은 File 객체들을 업로드 (권한·이름 충돌 사전 점검 포함) */
  uploadDroppedFiles: (sessionId: string, remoteDir: string, files: File[]) => Promise<void>;
  downloadFile: (sessionId: string, remotePath: string, name: string) => Promise<void>;
  downloadDir: (
    sessionId: string,
    remotePath: string,
    name: string,
    format: ArchiveFormat
  ) => Promise<void>;
  /** 대기/진행 중인 전송 취소 */
  cancel: (id: string) => void;
  clearFinished: () => void;
}

// 전송 실행 함수(큐). 직렬 처리.
const runners = new Map<string, () => Promise<void>>();
// 취소 요청된 transferId. Rust 쪽 단발 invoke 는 transferCancel IPC 로,
// 청크 업로드(JS 루프)는 이 Set 을 매 청크마다 확인해 직접 중단한다.
const canceling = new Set<string>();
let running = false;

function joinPath(dir: string, name: string): string {
  if (dir === '/') return `/${name}`;
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

function extFor(format: ArchiveFormat): string {
  return format === 'zip' ? 'zip' : format === 'tarxz' ? 'tar.xz' : 'tar.gz';
}

// 대용량 파일을 한 번에 base64 문자열로 만들면(readAsDataURL) V8 문자열
// 길이 한도에 걸려 RangeError: Out of memory 발생 → 조각내어 순차 전송.
const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB
const BASE64_SUBCHUNK = 0x8000; // String.fromCharCode 스택 한도 회피

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_SUBCHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_SUBCHUNK));
  }
  return btoa(binary);
}

/** File → 원격 경로. 청크 단위로 읽어 순차 전송(메모리에 파일 전체를 올리지 않음). */
async function uploadFileChunked(
  sessionId: string,
  file: File,
  remotePath: string,
  transferId: string
): Promise<void> {
  const total = file.size;
  let offset = 0;
  do {
    if (canceling.has(transferId)) {
      await sftpAbortUploadData(sessionId, remotePath).catch(() => {});
      return;
    }
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, total);
    const buf = await file.slice(offset, end).arrayBuffer();
    const dataB64 = arrayBufferToBase64(buf);
    const isLast = end >= total;
    await sftpUploadDataChunk(sessionId, remotePath, dataB64, transferId, offset, total, isLast);
    offset = end;
  } while (offset < total);
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  transfers: [],

  applyProgress: (e) =>
    set((s) => ({
      transfers: s.transfers.map((t) => {
        if (t.id !== e.id) return t;
        // 취소/완료/실패로 이미 끝난 전송은 뒤늦게 도착한 진행 이벤트를 무시
        if (t.status === 'canceled' || t.status === 'done' || t.status === 'error') return t;
        return {
          ...t,
          transferred: e.transferred,
          total: e.total || t.total,
          speed: e.speed,
          ...(e.status === 'error' ? { status: 'error' as const, error: e.error } : {}),
          ...(e.status === 'canceled' ? { status: 'canceled' as const } : {}),
        };
      }),
    })),

  uploadFiles: async (sessionId, remoteDir) => {
    const selected = await openDialog({ multiple: true, title: '업로드할 파일 선택' });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const localPath of paths) {
      const name = localPath.split('/').pop() ?? localPath;
      const remotePath = joinPath(remoteDir, name);
      const id = crypto.randomUUID();
      runners.set(id, () =>
        sftpUpload(sessionId, localPath, remotePath, id).then(() =>
          useFileTreeStore.getState().refreshDir(sessionId, remoteDir).catch(() => {})
        )
      );
      set((s) => ({
        transfers: [
          ...s.transfers,
          { id, kind: 'upload', name, remotePath, localPath, total: 0, transferred: 0, speed: 0, status: 'queued', startedAt: Date.now() },
        ],
      }));
    }
    kick();
  },

  uploadDroppedFiles: async (sessionId, remoteDir, files) => {
    if (files.length === 0) return;

    // 1) 대상 디렉토리 쓰기 권한 사전 점검 (점검 자체가 실패하면 실제 업로드에서 판정)
    try {
      const writable = await sftpCheckWriteAccess(sessionId, remoteDir);
      if (!writable) {
        log.error(`업로드 불가: ${remoteDir} 에 쓰기 권한이 없습니다`);
        await confirm({
          title: '업로드 불가',
          message: `대상 디렉토리에 쓰기 권한이 없습니다: ${remoteDir}`,
          confirmLabel: '확인',
        });
        return;
      }
    } catch (e) {
      log.warn(`권한 사전 점검 실패, 업로드 계속 시도: ${e}`);
    }

    // 2) 이름 충돌 사전 점검 → 덮어쓰기 확인
    const collisions: string[] = [];
    for (const f of files) {
      const exists = await sftpExists(sessionId, joinPath(remoteDir, f.name)).catch(() => false);
      if (exists) collisions.push(f.name);
    }
    if (collisions.length > 0) {
      const ok = await confirm({
        title: '덮어쓰기 확인',
        message: `이미 존재하는 파일 ${collisions.length}개를 덮어씁니다: ${collisions.join(', ')}`,
        confirmLabel: '덮어쓰기',
        danger: true,
      });
      if (!ok) return;
    }

    // 3) 전송 큐에 추가
    for (const file of files) {
      const remotePath = joinPath(remoteDir, file.name);
      const id = crypto.randomUUID();
      runners.set(id, async () => {
        await uploadFileChunked(sessionId, file, remotePath, id);
        await useFileTreeStore.getState().refreshDir(sessionId, remoteDir).catch(() => {});
      });
      set((s) => ({
        transfers: [
          ...s.transfers,
          { id, kind: 'upload', name: file.name, remotePath, localPath: '(드래그 앤 드롭)', total: file.size, transferred: 0, speed: 0, status: 'queued', startedAt: Date.now() },
        ],
      }));
    }
    kick();
  },

  downloadFile: async (sessionId, remotePath, name) => {
    const localPath = await saveDialog({ defaultPath: name, title: '저장 위치 선택' });
    if (!localPath) return;
    const id = crypto.randomUUID();
    runners.set(id, () => sftpDownload(sessionId, remotePath, localPath, id));
    set((s) => ({
      transfers: [
        ...s.transfers,
        { id, kind: 'download', name, remotePath, localPath, total: 0, transferred: 0, speed: 0, status: 'queued', startedAt: Date.now() },
      ],
    }));
    kick();
  },

  downloadDir: async (sessionId, remotePath, name, format) => {
    const fileName = `${name}.${extFor(format)}`;
    const localPath = await saveDialog({ defaultPath: fileName, title: '아카이브 저장 위치' });
    if (!localPath) return;
    const id = crypto.randomUUID();
    runners.set(id, () => sftpDownloadDir(sessionId, remotePath, localPath, format, id));
    set((s) => ({
      transfers: [
        ...s.transfers,
        { id, kind: 'download', name: fileName, remotePath, localPath, total: 0, transferred: 0, speed: 0, status: 'queued', startedAt: Date.now() },
      ],
    }));
    kick();
  },

  cancel: (id) => {
    const t = get().transfers.find((x) => x.id === id);
    if (!t || (t.status !== 'queued' && t.status !== 'active')) return;
    if (t.status === 'active') {
      canceling.add(id);
      transferCancel(id).catch(() => {});
    } else {
      runners.delete(id); // 대기 중이면 실행될 일이 없으니 바로 정리
    }
    set((s) => ({
      transfers: s.transfers.map((x) => (x.id === id ? { ...x, status: 'canceled' as const } : x)),
    }));
  },

  clearFinished: () =>
    set((s) => ({
      transfers: s.transfers.filter((t) => t.status === 'active' || t.status === 'queued'),
    })),
}));

async function kick() {
  if (running) return;
  const store = useTransferStore;
  const next = store.getState().transfers.find((t) => t.status === 'queued');
  if (!next) return;

  running = true;
  store.setState((s) => ({
    transfers: s.transfers.map((t) => (t.id === next.id ? { ...t, status: 'active' } : t)),
  }));
  log.info(`${next.kind === 'upload' ? '업로드' : '다운로드'} 시작: ${next.name}`);

  const runner = runners.get(next.id);
  try {
    if (runner) await runner();
    if (canceling.has(next.id)) {
      canceling.delete(next.id);
      log.info(`전송 취소됨: ${next.name}`);
    } else {
      store.setState((s) => ({
        transfers: s.transfers.map((t) =>
          t.id === next.id ? { ...t, status: 'done', transferred: t.total || t.transferred } : t
        ),
      }));
      log.info(`전송 완료: ${next.name}`);
    }
  } catch (e) {
    if (canceling.has(next.id)) {
      canceling.delete(next.id);
      log.info(`전송 취소됨: ${next.name}`);
    } else {
      store.setState((s) => ({
        transfers: s.transfers.map((t) =>
          t.id === next.id ? { ...t, status: 'error', error: String(e) } : t
        ),
      }));
      log.error(`전송 실패: ${next.name} — ${e}`);
    }
  } finally {
    runners.delete(next.id);
    running = false;
    kick();
  }
}
