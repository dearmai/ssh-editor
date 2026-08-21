import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';
import { useEditorStore } from '../../../stores/editorStore';
import styles from './MarkdownPreview.module.css';

interface Props {
  tabId: string;
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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
