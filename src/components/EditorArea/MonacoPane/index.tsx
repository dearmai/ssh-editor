import Editor from '@monaco-editor/react';
import { useCallback, useEffect } from 'react';
import { useEditorStore } from '../../../stores/editorStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { defineMonacoThemes, getTheme, monacoThemeName } from '../../../themes';
import styles from './MonacoPane.module.css';

interface Props {
  tabId: string;
}

export default function MonacoPane({ tabId }: Props) {
  const updateContent = useEditorStore((s) => s.updateContent);
  const saveTab = useEditorStore((s) => s.saveTab);
  const tab = useEditorStore((s) => s.tabsById[tabId]);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const lightTheme = useSettingsStore((s) => s.lightTheme);

  const colorTheme = getTheme(resolvedTheme === 'dark' ? darkTheme : lightTheme, resolvedTheme);
  const monacoTheme = monacoThemeName(colorTheme);

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
        theme={monacoTheme}
        beforeMount={(monaco) => defineMonacoThemes(monaco)}
        onChange={(value) => {
          if (value !== undefined) updateContent(tab.id, value);
        }}
        options={{
          fontSize: editorFontSize,
          fontFamily: editorFontFamily,
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
