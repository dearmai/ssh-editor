import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import changelog from '../../../CHANGELOG.md?raw';
import { version } from '../../../package.json';
import markdown from '../EditorArea/MarkdownPreview/MarkdownPreview.module.css';
import dialog from './Dialog.module.css';
import styles from './ReleaseNotesDialog.module.css';

// Ship the same changelog as the repository, including offline installations.
// Repository-relative documentation links are displayed as text in this view.
const html = DOMPurify.sanitize(
  marked.parse(changelog.replace(/^# .*(?:\r?\n|$)/, ''), { async: false }),
  { FORBID_TAGS: ['a', 'img'] },
);

export default function ReleaseNotesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialog.overlay} />
        <Dialog.Content className={`${dialog.content} ${styles.content}`}>
          <div className={dialog.header}>
            <div>
              <Dialog.Title className={dialog.title}>버전 수정 내역</Dialog.Title>
              <Dialog.Description className={styles.version}>SSH Editor {version}</Dialog.Description>
            </div>
            <Dialog.Close className={dialog.closeBtn} aria-label="닫기" title="닫기">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className={styles.notes} tabIndex={0} role="region" aria-label="버전별 수정 내역">
            <article className={markdown.body} data-selectable="true" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
