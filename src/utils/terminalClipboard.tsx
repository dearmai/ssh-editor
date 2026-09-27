import { readItems, releasePreviews } from './clipboardPaste';
import { readClipboard } from './clipboard';
import { terminalPrepareUpload, sftpUpload, sftpUploadDataChunk, sftpDeletePath } from '../ipc/commands';
import { confirm } from '../stores/confirmStore';
import { toastError } from '../stores/toastStore';
import { log } from '../stores/logStore';
import UploadPreview from '../components/Dialogs/UploadPreview';
import type { UploadItem } from '../types/uploads';

interface Target {
  connectionId: string;
  isAlive: () => boolean;
  paste: (text: string) => void;
  setUploading: (uploading: boolean) => void;
}

/** 한 터미널에서 미리보기/업로드 중 반복 붙여넣기를 막는다. */
export function createTerminalClipboard(target: Target) {
  let busy = false;
  return async (files: File[] = []) => {
    if (busy || !target.isAlive()) return;
    busy = true;
    let items: UploadItem[] = [];
    let remoteDir: string | undefined;
    let inserted = false;
    const uploadedPaths: string[] = [];
    try {
      items = await readItems(files);
      if (!target.isAlive()) return;
      if (!items.length) {
        const text = await readClipboard();
        if (text && target.isAlive()) target.paste(text);
        return;
      }
      if (items.some((item) => !/\.(png|jpe?g|webp|gif)$/i.test(item.name))) {
        throw new Error('터미널에는 PNG, JPEG, WebP, GIF 이미지를 붙여넣을 수 있습니다.');
      }
      const approved = await confirm({
        title: '터미널에 이미지 붙여넣기',
        wide: true,
        message: <>
          <UploadPreview items={items} remoteDir="이 터미널의 SSH 서버 · /tmp/ssh-editor-…" collisions={[]} />
          <p>이미지를 업로드한 뒤 원격 경로를 입력합니다. 설명을 추가하고 Enter로 전송하세요.</p>
        </>,
        confirmLabel: '업로드 후 경로 입력',
      });
      if (!approved || !target.isAlive()) return;
      target.setUploading(true);
      remoteDir = await terminalPrepareUpload(target.connectionId);
      const paths: string[] = [];
      for (const [index, item] of items.entries()) {
        if (!target.isAlive()) return;
        // 원본 파일명의 공백/제어문자/셸 문자가 터미널 입력에 섞이지 않도록 한다.
        const ext = item.name.split('.').pop()!.toLowerCase();
        const path = `${remoteDir}/image-${index + 1}.${ext}`;
        uploadedPaths.push(path);
        const id = crypto.randomUUID();
        if (item.source.kind === 'local') {
          await sftpUpload(target.connectionId, item.source.path, path, id);
        } else {
          const file = item.source.file;
          const chunkSize = 256 * 1024;
          let offset = 0;
          do {
            if (!target.isAlive()) return;
            const end = Math.min(offset + chunkSize, file.size);
            const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            await sftpUploadDataChunk(target.connectionId, path, btoa(binary), id, offset, file.size, end === file.size);
            offset = end;
          } while (offset < file.size);
        }
        paths.push(path);
      }
      if (!target.isAlive()) return;
      target.paste(`${paths.join(' ')} `);
      inserted = true;
    } catch (error) {
      const message = `터미널 붙여넣기 실패: ${String(error)}`;
      log.error(message);
      if (target.isAlive()) toastError(message);
    } finally {
      if (remoteDir && !inserted) {
        for (const path of uploadedPaths) {
          await sftpDeletePath(target.connectionId, path).catch((error) => {
            log.warn(`임시 이미지 정리 실패: ${path} — ${String(error)}`);
          });
        }
        await sftpDeletePath(target.connectionId, remoteDir).catch((error) => {
          log.warn(`임시 이미지 정리 실패: ${remoteDir} — ${String(error)}`);
        });
      }
      releasePreviews(items);
      if (target.isAlive()) target.setUploading(false);
      busy = false;
    }
  };
}
