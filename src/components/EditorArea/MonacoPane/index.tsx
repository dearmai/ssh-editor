import Editor from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import { useIndent } from '../../../hooks/useIndent';
import { useEditorStore } from '../../../stores/editorStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { defineMonacoThemes, getTheme, monacoThemeName } from '../../../themes';
import { registerCaddyLanguage } from '../../../utils/caddyLang';
import styles from './MonacoPane.module.css';
import { useTextStatsStore } from '../../../stores/textStatsStore';
import { addStats, textStats, TextStatsIndex } from '../../../utils/textStats';
import { encodedLengths } from '../../../ipc/commands';

interface Props {
  tabId: string;
  groupId: string;
}

export default function MonacoPane({ tabId, groupId }: Props) {
  const updateContent = useEditorStore((s) => s.updateContent);
  const saveTab = useEditorStore((s) => s.saveTab);
  const checkExternalChange = useEditorStore((s) => s.checkExternalChange);
  const tab = useEditorStore((s) => s.tabsById[tabId]);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const editorLineHeight = useSettingsStore((s) => s.editorLineHeight);
  const minimapEnabled = useSettingsStore((s) => s.minimapEnabled);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const lightTheme = useSettingsStore((s) => s.lightTheme);

  // 들여쓰기: 파일별 오버라이드 → 확장자 규칙 → 기본값
  const { rule: indent } = useIndent(tab?.connectionId, tab?.remotePath);

  const colorTheme = getTheme(resolvedTheme === 'dark' ? darkTheme : lightTheme, resolvedTheme);
  const monacoTheme = monacoThemeName(colorTheme);

  // @monaco-editor/react는 path가 없으면 모든 에디터가 빈 URI("") 모델을 공유하여,
  // 분할/탭 이동 중 한쪽이 언마운트될 때 공유 모델이 dispose → 다른 에디터가 빈 화면/먹통이 된다.
  // 이 컴포넌트 인스턴스마다 고유한 path를 부여해 모델을 완전히 분리한다 (마운트당 1회 생성).
  const modelPath = useRef(`m${Math.random().toString(36).slice(2)}-${tabId}`.replace(/:/g, '_')).current;

  // remeasureFonts는 런타임엔 있으나 일부 monaco 타입 정의에 누락 → 느슨하게 처리
  type Remeasurable = { remeasureFonts?: () => void };
  const editorRef = useRef<Remeasurable | null>(null);
  const cleanupStats = useRef<(() => void) | null>(null);
  const refreshStats = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupStats.current?.(), []);
  useEffect(() => { refreshStats.current?.(); }, [tab?.encoding]);

  const handleSave = useCallback(async () => {
    await saveTab(tabId);
  }, [tabId, saveTab]);

  // 폰트 변경 시 Monaco가 글리프 폭을 다시 측정하도록 강제.
  // (WKWebView는 폰트 로드 전 측정하면 fallback 폰트 metrics로 그려 터미널과 달라 보임)
  useEffect(() => {
    editorRef.current?.remeasureFonts?.();
  }, [editorFontFamily, editorFontSize, editorLineHeight]);

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
        beforeMount={(monaco) => {
          defineMonacoThemes(monaco);
          registerCaddyLanguage(monaco);
        }}
        onMount={(editor) => {
          const model = editor.getModel();
          if (model) {
            let lineTexts = model.getLinesContent();
            let index = new TextStatsIndex(lineTexts);
            let previousVersion = model.getVersionId();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let byteTimer: ReturnType<typeof setTimeout> | undefined;
            let sequence = 0;
            let disposed = false;
            let cachedBytes: { version: number; encoding: string; value: Promise<number | null> } | undefined;
            const publish = () => {
              const position = editor.getPosition();
              if (!position || model.isDisposed()) return;
              const lineNumber = Math.min(position.lineNumber, model.getLineCount());
              const ranges = (editor.getSelections() ?? []).filter((range) => !range.isEmpty());
              const selection = ranges.length ? ranges.reduce(
                (sum, range) => addStats(sum, textStats(model.getValueInRange(range))),
                { characters: 0, bytes: 0, words: 0 },
              ) : null;
              const encoding = useEditorStore.getState().tabsById[tabId]?.encoding ?? 'utf-8';
              const utf8 = encoding.startsWith('utf-8');
              const snapshot = {
                tabId, file: index.total(model.getEOL()),
                line: index.lines[lineNumber - 1] ?? textStats(''),
                lineNumber: lineNumber + (useEditorStore.getState().tabsById[tabId]?.segment?.startLine ?? 0),
                selection,
              };
              if (encoding === 'utf-8-bom') snapshot.file = { ...snapshot.file, bytes: snapshot.file.bytes + 3 };
              useTextStatsStore.getState().update(groupId, { ...snapshot,
                byteCounts: utf8 ? undefined : { file: null, line: null, selection: null },
              });
              clearTimeout(byteTimer);
              const request = ++sequence;
              if (!utf8) byteTimer = setTimeout(async () => {
                if (disposed || model.isDisposed()) return;
                const version = model.getVersionId();
                if (!cachedBytes || cachedBytes.version !== version || cachedBytes.encoding !== encoding) {
                  cachedBytes = { version, encoding,
                    value: encodedLengths([model.getValue()], encoding).then(([n]) => n + (encoding.startsWith('utf-16') ? 2 : 0)).catch(() => null) };
                }
                const file = cachedBytes.value;
                const line = model.getLineContent(lineNumber);
                const selected = ranges.map((range) => model.getValueInRange(range));
                const [fileBytes, parts] = await Promise.all([
                  file,
                  encodedLengths([line, ...selected], encoding).catch(() => null),
                ]);
                if (disposed || request !== sequence || version !== model.getVersionId()) return;
                useTextStatsStore.getState().update(groupId, { ...snapshot, byteCounts: {
                  file: fileBytes, line: parts?.[0] ?? null,
                  selection: parts ? parts.slice(1).reduce((a, b) => a + b, 0) : null,
                } });
              }, 180);
            };
            const cursor = editor.onDidChangeCursorSelection(() => {
              clearTimeout(timer);
              timer = setTimeout(publish, 60);
            });
            const change = model.onDidChangeContent((event) => {
              if (event.isFlush || event.isEolChange) {
                lineTexts = model.getLinesContent();
                index = new TextStatsIndex(lineTexts);
                cachedBytes = undefined;
              }
              else if (event.changes.length) {
                const first = Math.min(...event.changes.map((c) => c.range.startLineNumber));
                const last = Math.max(...event.changes.map((c) => c.range.endLineNumber));
                const delta = model.getLineCount() - index.lines.length;
                const lines: string[] = [];
                for (let n = first; n <= last + delta; n++) lines.push(model.getLineContent(n));
                const encoding = useEditorStore.getState().tabsById[tabId]?.encoding ?? 'utf-8';
                if (cachedBytes?.version === previousVersion && cachedBytes.encoding === encoding) {
                  const oldText = lineTexts.slice(first - 1, last).join(model.getEOL());
                  const newText = lines.join(model.getEOL());
                  const previous = cachedBytes.value;
                  // UTF-8 외 인코딩도 편집한 줄의 바이트 차이만 반영한다.
                  const fallback = model.createSnapshot();
                  cachedBytes = { version: model.getVersionId(), encoding, value: previous.then(async (bytes) => {
                    if (bytes == null) {
                      const chunks: string[] = [];
                      for (let chunk = fallback.read(); chunk !== null; chunk = fallback.read()) chunks.push(chunk);
                      const [size] = await encodedLengths([chunks.join('')], encoding);
                      return size + (encoding.startsWith('utf-16') ? 2 : 0);
                    }
                    const [before, after] = await encodedLengths([oldText, newText], encoding);
                    return bytes + after - before;
                  }).catch(() => null) };
                }
                lineTexts = lineTexts.slice(0, first - 1).concat(lines, lineTexts.slice(last));
                index.replace(first - 1, last - first + 1, lines);
              }
              previousVersion = model.getVersionId();
              publish();
            });
            cleanupStats.current = () => {
              clearTimeout(timer);
              clearTimeout(byteTimer);
              disposed = true;
              refreshStats.current = null;
              cursor.dispose(); change.dispose();
              useTextStatsStore.getState().remove(groupId);
            };
            refreshStats.current = publish;
            publish();
          }
          const e = editor as unknown as Remeasurable;
          editorRef.current = e;
          // 폰트가 실제 로드된 뒤 다시 측정 → 터미널(xterm)과 동일 폰트로 렌더
          e.remeasureFonts?.();
          document.fonts?.ready.then(() => e.remeasureFonts?.());
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
          // 0~8 값은 Monaco가 글꼴 크기의 배수로 해석
          lineHeight: editorLineHeight,
          // 구간 편집 탭은 원본 파일 기준 줄 번호로 표시
          lineNumbers: tab.segment ? (n: number) => String(n + tab.segment!.startLine) : 'on',
          // 복사 시 문법 강조(색상) HTML을 함께 담지 않고 순수 텍스트만 클립보드에 넣는다
          copyWithSyntaxHighlighting: false,
          // 탭 드래그를 .pane이 받도록 Monaco 자체 드롭/드래그 처리 비활성화
          // (켜져 있으면 드롭한 탭의 텍스트가 에디터에 삽입되거나 드롭이 가로채여짐)
          dragAndDrop: false,
          dropIntoEditor: { enabled: false },
          minimap: { enabled: minimapEnabled, scale: 1 },
          // 들여쓰기는 설정에서 결정 — 파일 내용에서 추론하면 설정이 무시된다
          detectIndentation: false,
          tabSize: indent.tabSize,
          insertSpaces: indent.insertSpaces,
          wordWrap: tab.wordWrap ? 'on' : 'off',
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
