import { readClipboardUploads, sftpCheckWriteAccess, sftpListDir } from '../ipc/commands';
import { confirm } from '../stores/confirmStore';
import { useFileTreeStore } from '../stores/fileTreeStore';
import { useTransferStore } from '../stores/transferStore';
import { toastError } from '../stores/toastStore';
import { log } from '../stores/logStore';
import type { UploadItem } from '../types/uploads';
import UploadPreview from '../components/Dialogs/UploadPreview';

let pasting = false;

async function browserItem(file: File): Promise<UploadItem> {
  const item: UploadItem = { name: file.name || `clipboard-${crypto.randomUUID()}.png`, size: file.size, source: { kind: 'file', file } };
  if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name)) {
    item.thumbnail = URL.createObjectURL(file);
  } else {
    const bytes = await file.slice(0, 8192).arrayBuffer();
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) item.textPreview = text;
    } catch { /* 바이너리 파일은 메타데이터로 표시 */ }
  }
  return item;
}

async function readItems(files: File[]): Promise<UploadItem[]> {
  if (files.length) {
    const items: UploadItem[] = [];
    try {
      for (const file of files) items.push(await browserItem(file));
      return items;
    } catch (e) {
      releasePreviews(items);
      throw e;
    }
  }
  const native = await readClipboardUploads();
  return native.map((item) => {
    let source: UploadItem['source'];
    if (item.localPath) source = { kind: 'local', path: item.localPath };
    else {
      if (!item.dataBase64) throw new Error('클립보드 이미지 데이터가 없습니다');
      const bytes = Uint8Array.from(atob(item.dataBase64), (char) => char.charCodeAt(0));
      source = { kind: 'file', file: new File([bytes], item.name, { type: 'image/png' }) };
    }
    return { name: item.name, size: item.size, source,
      thumbnail: item.thumbnail ?? undefined, textPreview: item.textPreview ?? undefined };
  });
}

function releasePreviews(items: UploadItem[]) {
  for (const item of items) {
    if (item.thumbnail?.startsWith('blob:')) URL.revokeObjectURL(item.thumbnail);
  }
}

/** 키보드/편집 메뉴/우클릭 메뉴가 공유하는 붙여넣기 처리. 대상은 호출 시점에 고정한다. */
export async function pasteClipboardInto(connectionId: string, remoteDir: string, files: File[] = []) {
  if (pasting) return;
  pasting = true;
  let items: UploadItem[] = [];
  try {
    items = await readItems(files);
    if (!items.length) {
      const store = useFileTreeStore.getState();
      if (store.clipboard?.connectionId === connectionId) await store.pasteInto(connectionId, remoteDir);
      else toastError('클립보드에 업로드할 이미지나 파일이 없습니다.');
      return;
    }
    const names = new Set<string>();
    for (const item of items) {
      if (!item.name || item.name === '.' || item.name === '..' || /[/\\\x00]/.test(item.name)) {
        throw new Error(`업로드할 수 없는 파일 이름: ${item.name}`);
      }
      if (names.has(item.name)) throw new Error(`같은 이름의 파일이 여러 개 있습니다: ${item.name}`);
      names.add(item.name);
    }
    if (!(await sftpCheckWriteAccess(connectionId, remoteDir))) {
      throw new Error(`대상 디렉토리에 쓰기 권한이 없습니다: ${remoteDir}`);
    }
    // 목록 조회가 실패하면 진행하지 않는다. 기존 폴더/읽기 전용 파일 덮어쓰기도 차단한다.
    const entries = await sftpListDir(connectionId, remoteDir);
    const collisions: string[] = [];
    for (const entry of entries.filter((entry) => names.has(entry.name))) {
      if (entry.isDir) throw new Error(`같은 이름의 폴더가 있습니다: ${entry.name}`);
      if (!(await sftpCheckWriteAccess(connectionId, entry.path))) {
        throw new Error(`기존 파일에 쓰기 권한이 없습니다: ${entry.path}`);
      }
      collisions.push(entry.name);
    }
    const approved = await confirm({
      title: '클립보드 파일 업로드',
      wide: items.some((item) => !!item.thumbnail),
      message: <UploadPreview items={items} remoteDir={remoteDir} collisions={collisions} />,
      confirmLabel: collisions.length ? '덮어쓰기 및 업로드' : '업로드',
      danger: collisions.length > 0,
    });
    if (!approved) return;
    useTransferStore.getState().enqueueClipboardUploads(connectionId, remoteDir, items);
  } catch (e) {
    const text = `붙여넣기 업로드 실패: ${String(e)}`;
    log.error(text);
    toastError(text);
  } finally {
    releasePreviews(items);
    pasting = false;
  }
}
