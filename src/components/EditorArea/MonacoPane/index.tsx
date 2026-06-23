import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
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
  const checkExternalChange = useEditorStore((s) => s.checkExternalChange);
  const tab = useEditorStore((s) => s.tabsById[tabId]);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const minimapEnabled = useSettingsStore((s) => s.minimapEnabled);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const lightTheme = useSettingsStore((s) => s.lightTheme);

  const colorTheme = getTheme(resolvedTheme === 'dark' ? darkTheme : lightTheme, resolvedTheme);
  const monacoTheme = monacoThemeName(colorTheme);

  // @monaco-editor/react는 path가 없으면 모든 에디터가 빈 URI("") 모델을 공유하여,
  // 분할/탭 이동 중 한쪽이 언마운트될 때 공유 모델이 dispose → 다른 에디터가 빈 화면/먹통이 된다.
  // 이 컴포넌트 인스턴스마다 고유한 path를 부여해 모델을 완전히 분리한다 (마운트당 1회 생성).
  const modelPath = useRef(`m${Math.random().toString(36).slice(2)}-${tabId}`.replace(/:/g, '_')).current;

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
        path={modelPath}
        value={tab.content}
        language={tab.language}
        theme={monacoTheme}
        beforeMount={(monaco) => defineMonacoThemes(monaco)}
        onMount={(editor) => {
          // 편집 창에 포커스가 들어올 때 서버 측 외부 변경 검사
          editor.onDidFocusEditorWidget(() => {
            checkExternalChange(tabId);
          });
        }}
        onChange={(value) => {
          if (value !== undefined) updateContent(tab.id, value);
        }}
        options={{
          fontSize: editorFontSize,
          fontFamily: editorFontFamily,
          lineNumbers: 'on',
          // 탭 드래그를 .pane이 받도록 Monaco 자체 드롭/드래그 처리 비활성화
          // (켜져 있으면 드롭한 탭의 텍스트가 에디터에 삽입되거나 드롭이 가로채여짐)
          dragAndDrop: false,
          dropIntoEditor: { enabled: false },
          minimap: { enabled: minimapEnabled, scale: 1 },
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
