import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEditorStore } from '../../../stores/editorStore';
import { toastError } from '../../../stores/toastStore';
import { log } from '../../../stores/logStore';
import { createMarkdownLinkOpener } from '../../../utils/markdownLinks';
import type { EditorTab } from '../../../types';
import styles from './MarkdownPreview.module.css';

interface Props {
  tabId: string;
}

const openLink = createMarkdownLinkOpener(openUrl, (error) => {
  log.error(`Markdown 링크 열기 실패: ${String(error)}`);
  toastError(`링크를 열지 못했습니다: ${String(error)}`);
});

function handleLinkClick(event: React.MouseEvent<HTMLDivElement>, tab: EditorTab) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest('a[href]');
  if (!link || !event.currentTarget.contains(link)) return;
  const body = event.currentTarget;
  void openLink(event, link.getAttribute('href') ?? '', (id) => {
    if (!id) {
      body.parentElement?.scrollTo({ top: 0 });
      return;
    }
    // ID를 CSS 선택자에 삽입하지 않고 비교한다. 다른 패널로 이동하지 않는다.
    const anchor = Array.from(body.querySelectorAll('[id], a[name]'))
      .find((element) => element.id === id || element.getAttribute('name') === id);
    anchor?.scrollIntoView({ block: 'start' });
  }, {
    path: tab.remotePath,
    open: (path) => useEditorStore.getState().openFile(tab.connectionId, {
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      isDir: false,
      size: 0,
    }),
  });
}

/** 렌더된 미리보기에서 복사할 때 굵기/색 등 서식 없이 순수 텍스트만 클립보드에 담기 */
function stripFormattingOnCopy(e: React.ClipboardEvent<HTMLDivElement>) {
  const text = window.getSelection()?.toString();
  if (!text) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', text);
}

export default function MarkdownPreview({ tabId }: Props) {
  const tab = useEditorStore((s) => s.tabsById[tabId]);

  const html = useMemo(() => {
    if (!tab) return '';
    const raw = marked.parse(tab.content, { async: false, breaks: true }) as string;
    return DOMPurify.sanitize(raw);
  }, [tab?.content]);

  if (!tab) return null;

  return (
    <div className={styles.preview}>
      <div
        className={styles.body}
        data-selectable="true"
        onCopy={stripFormattingOnCopy}
        onClick={(event) => handleLinkClick(event, tab)}
        onAuxClick={(event) => handleLinkClick(event, tab)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
