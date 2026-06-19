import Editor from '@monaco-editor/react';
import { useCallback, useEffect } from 'react';
import { useEditorStore } from '../../../stores/editorStore';
import styles from './MonacoPane.module.css';

interface Props {
  tabId: string;
}

export default function MonacoPane({ tabId }: Props) {
  const { tabs, updateContent, saveTab } = useEditorStore();
  const tab = tabs.find((t) => t.id === tabId);

  const handleSave = useCallback(async () => {
    await saveTab(tabId);
  }, [tabId, saveTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  if (!tab) return null;

  return (
    <div className={styles.container}>
      <Editor
        key={tab.id}
        value={tab.content}
        language={tab.language}
        theme="vs-dark"
        onChange={(value) => {
          if (value !== undefined) updateContent(tab.id, value);
        }}
        options={{
          fontSize: 14,
          fontFamily: "'SF Mono', 'Fira Code', Menlo, monospace",
          lineNumbers: 'on',
          minimap: { enabled: true, scale: 1 },
          wordWrap: 'off',
          scrollBeyondLastLine: false,
          renderWhitespace: 'selection',
          bracketPairColorization: { enabled: true },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          padding: { top: 8 },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
        loading={<div className={styles.loading}>로딩 중...</div>}
      />
    </div>
  );
}
