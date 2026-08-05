import { create } from 'zustand';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  sftpCheckWriteAccess,
  sftpDownload,
  sftpDownloadDir,
  sftpExists,
  sftpUpload,
  sftpUploadData,
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
  clearFinished: () => void;
}

// 전송 실행 함수(큐). 직렬 처리.
const runners = new Map<string, () => Promise<void>>();
let running = false;

function joinPath(dir: string, name: string): string {
  if (dir === '/') return `/${name}`;
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

function extFor(format: ArchiveFormat): string {
  return format === 'zip' ? 'zip' : format === 'tarxz' ? 'tar.xz' : 'tar.gz';
}

/** File → base64 (data URL 의 페이로드 부분) */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('파일 읽기 실패'));
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export const useTransferStore = create<TransferStore>((set) => ({
  transfers: [],

  applyProgress: (e) =>
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === e.id
          ? {
              ...t,
              transferred: e.transferred,
              total: e.total || t.total,
              ...(e.status === 'error' ? { status: 'error' as const, error: e.error } : {}),
            }
          : t
      ),
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
          { id, kind: 'upload', name, remotePath, localPath, total: 0, transferred: 0, status: 'queued', startedAt: Date.now() },
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
        const dataB64 = await fileToBase64(file);
        await sftpUploadData(sessionId, remotePath, dataB64, id);
        await useFileTreeStore.getState().refreshDir(sessionId, remoteDir).catch(() => {});
      });
      set((s) => ({
        transfers: [
          ...s.transfers,
          { id, kind: 'upload', name: file.name, remotePath, localPath: '(드래그 앤 드롭)', total: file.size, transferred: 0, status: 'queued', startedAt: Date.now() },
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
        { id, kind: 'download', name, remotePath, localPath, total: 0, transferred: 0, status: 'queued', startedAt: Date.now() },
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
        { id, kind: 'download', name: fileName, remotePath, localPath, total: 0, transferred: 0, status: 'queued', startedAt: Date.now() },
      ],
    }));
    kick();
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
    store.setState((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === next.id ? { ...t, status: 'done', transferred: t.total || t.transferred } : t
      ),
    }));
    log.info(`전송 완료: ${next.name}`);
  } catch (e) {
    store.setState((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === next.id ? { ...t, status: 'error', error: String(e) } : t
      ),
    }));
    log.error(`전송 실패: ${next.name} — ${e}`);
  } finally {
    runners.delete(next.id);
    running = false;
    kick();
  }
}
