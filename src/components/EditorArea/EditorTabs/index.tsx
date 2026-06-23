import { useEffect, useMemo, useState } from 'react';
import { Copy, Map as MapIcon, Save, SplitSquareHorizontal, SplitSquareVertical, X } from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useEditorStore, type EditorGroup } from '../../../stores/editorStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { computeTabLabels } from '../../../utils/tabLabels';
import styles from './EditorTabs.module.css';

export default function EditorTabs({ group, groupCount }: { group: EditorGroup; groupCount: number }) {
  const tabsById = useEditorStore((s) => s.tabsById);
  // 모든 열린 탭을 대상으로 라벨 계산 (그룹이 달라도 동일 파일명이면 상위 경로로 구분)
  const labels = useMemo(() => computeTabLabels(Object.values(tabsById)), [tabsById]);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const closeOtherTabs = useEditorStore((s) => s.closeOtherTabs);
  const closeTabsInGroup = useEditorStore((s) => s.closeTabsInGroup);
  const saveTab = useEditorStore((s) => s.saveTab);
  const moveTab = useEditorStore((s) => s.moveTab);
  const splitActive = useEditorStore((s) => s.splitActive);
  const closeGroup = useEditorStore((s) => s.closeGroup);
  const setDraggingTab = useEditorStore((s) => s.setDraggingTab);
  const minimapEnabled = useSettingsStore((s) => s.minimapEnabled);
  const setSetting = useSettingsStore((s) => s.set);

  // 드롭 위치 표시용 (탭 사이 삽입 지점 인덱스)
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  // 드래그가 끝나면(어디서 끝나든) 표시/플래그 정리
  useEffect(() => {
    const clear = () => {
      setDropIdx(null);
      setDraggingTab(null);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [setDraggingTab]);

  const performDrop = (e: React.DragEvent) => {
    const info = useEditorStore.getState().draggingTab;
    if (!info) return;
    e.preventDefault();
    e.stopPropagation(); // 패널 분할(GroupView) 로직이 중복 처리하지 않도록
    const idx = dropIdx;
    setDropIdx(null);
    setDraggingTab(null);
    moveTab(info.tabId, info.fromGroupId, group.id, idx ?? group.tabIds.length);
  };

  // 빈 패널(단일 탭 분할로 만들어진 빈 g2 등): 드롭 가능 + 패널 닫기 버튼 제공
  if (group.tabIds.length === 0) {
    return (
      <div className={styles.bar}>
        <div
          className={styles.tabs}
          onDragEnter={(e) => {
            if (useEditorStore.getState().draggingTab) e.preventDefault();
          }}
          onDragOver={(e) => {
            if (!useEditorStore.getState().draggingTab) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
          onDrop={performDrop}
        />
        {groupCount > 1 && (
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={() => closeGroup(group.id)}
              title="이 패널 닫기"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }

  const lastIdx = group.tabIds.length - 1;

  return (
    <div className={styles.bar}>
      <div
        className={styles.tabs}
        onDragEnter={(e) => {
          if (useEditorStore.getState().draggingTab) e.preventDefault();
        }}
        onDragOver={(e) => {
          if (!useEditorStore.getState().draggingTab) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          // 탭 바의 빈 영역(마지막 탭 오른쪽) 위 → 맨 끝에 삽입
          if (e.target === e.currentTarget) setDropIdx(group.tabIds.length);
        }}
        onDrop={performDrop}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIdx(null);
        }}
      >
        {group.tabIds.map((id, index) => {
          const tab = tabsById[id];
          if (!tab) return null;
          const dropBefore = dropIdx === index;
          const dropAfter = dropIdx === group.tabIds.length && index === lastIdx;
          return (
            <ContextMenu.Root key={id}>
              <ContextMenu.Trigger asChild>
                <div
                  className={`${styles.tab} ${id === group.activeTabId ? styles.active : ''} ${
                    dropBefore ? styles.dropBefore : ''
                  } ${dropAfter ? styles.dropAfter : ''}`}
                  draggable
                  onDragStart={(e) => {
                    // WKWebView 호환: payload는 스토어로 전달하고, 드래그 개시를 위해 setData만 형식적으로 호출
                    e.dataTransfer.setData('text/plain', id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingTab({ tabId: id, fromGroupId: group.id });
                  }}
                  onDragEnd={() => setDraggingTab(null)}
                  onDragEnter={(e) => {
                    if (useEditorStore.getState().draggingTab) e.preventDefault();
                  }}
                  onDragOver={(e) => {
                    if (!useEditorStore.getState().draggingTab) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientX > rect.left + rect.width / 2;
                    setDropIdx(after ? index + 1 : index);
                  }}
                  onDrop={performDrop}
                  onClick={() => setActiveTab(group.id, id)}
                  title={tab.remotePath}
                >
                  {tab.isDirty && <span className={styles.dirty} title="저장되지 않은 변경사항" />}
                  <span className={styles.name}>{tab.fileName}</span>
                  {labels[id]?.hint && (
                    <span className={styles.dirHint} title={tab.remotePath}>
                      {labels[id].hint}
                    </span>
                  )}
                  <button
                    className={styles.close}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(group.id, id);
                    }}
                    title="탭 닫기"
                  >
                    <X size={12} />
                  </button>
                </div>
              </ContextMenu.Trigger>

              <ContextMenu.Portal>
                <ContextMenu.Content className={styles.ctxMenu}>
                  <ContextMenu.Item
                    className={`${styles.ctxItem} ${tab.isDirty ? '' : styles.ctxDisabled}`}
                    disabled={!tab.isDirty}
                    onSelect={() => saveTab(id).catch(() => {})}
                  >
                    <Save size={12} /> 저장
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={styles.ctxSeparator} />
                  <ContextMenu.Item
                    className={styles.ctxItem}
                    onSelect={() => closeTab(group.id, id)}
                  >
                    <X size={12} /> 닫기
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={`${styles.ctxItem} ${
                      group.tabIds.length <= 1 ? styles.ctxDisabled : ''
                    }`}
                    disabled={group.tabIds.length <= 1}
                    onSelect={() => closeOtherTabs(group.id, id)}
                  >
                    다른 탭 닫기
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={styles.ctxItem}
                    onSelect={() => closeTabsInGroup(group.id)}
                  >
                    이 패널의 탭 모두 닫기
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={styles.ctxSeparator} />
                  <ContextMenu.Item
                    className={styles.ctxItem}
                    onSelect={() => navigator.clipboard?.writeText(tab.remotePath).catch(() => {})}
                  >
                    <Copy size={12} /> 경로 복사
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={styles.ctxSeparator} />
                  <ContextMenu.Item
                    className={styles.ctxItem}
                    onSelect={() => setSetting('minimapEnabled', !minimapEnabled)}
                  >
                    <MapIcon size={12} /> {minimapEnabled ? '미니맵 숨기기' : '미니맵 표시'}
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>

      <div className={styles.actions}>
        <button
          className={styles.actionBtn}
          onClick={() => splitActive('horizontal')}
          title="가로 분할 (좌우)"
        >
          <SplitSquareHorizontal size={15} />
        </button>
        <button
          className={styles.actionBtn}
          onClick={() => splitActive('vertical')}
          title="세로 분할 (위아래)"
        >
          <SplitSquareVertical size={15} />
        </button>
        {groupCount > 1 && (
          <button
            className={styles.actionBtn}
            onClick={() => closeGroup(group.id)}
            title="이 패널 닫기"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
