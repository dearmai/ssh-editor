import { Columns2, Rows2, SplitSquareHorizontal, SplitSquareVertical, X } from 'lucide-react';
import { useEditorStore, type EditorGroup } from '../../../stores/editorStore';
import styles from './EditorTabs.module.css';

export default function EditorTabs({ group }: { group: EditorGroup }) {
  const tabsById = useEditorStore((s) => s.tabsById);
  const groupsLen = useEditorStore((s) => s.groups.length);
  const splitDirection = useEditorStore((s) => s.splitDirection);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const splitActive = useEditorStore((s) => s.splitActive);
  const setSplitDirection = useEditorStore((s) => s.setSplitDirection);
  const closeGroup = useEditorStore((s) => s.closeGroup);

  if (group.tabIds.length === 0) return <div className={styles.emptyBar} />;

  return (
    <div className={styles.bar}>
      <div className={styles.tabs}>
        {group.tabIds.map((id) => {
          const tab = tabsById[id];
          if (!tab) return null;
          return (
            <div
              key={id}
              className={`${styles.tab} ${id === group.activeTabId ? styles.active : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/x-editor-tab',
                  JSON.stringify({ tabId: id, groupId: group.id })
                );
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => setActiveTab(group.id, id)}
              title={tab.remotePath}
            >
              {tab.isDirty && <span className={styles.dirty} title="저장되지 않은 변경사항" />}
              <span className={styles.name}>{tab.fileName}</span>
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
          );
        })}
      </div>

      <div className={styles.actions}>
        {groupsLen === 1 ? (
          <>
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
          </>
        ) : (
          <>
            <button
              className={styles.actionBtn}
              onClick={() =>
                setSplitDirection(splitDirection === 'horizontal' ? 'vertical' : 'horizontal')
              }
              title="분할 방향 전환"
            >
              {splitDirection === 'horizontal' ? <Rows2 size={14} /> : <Columns2 size={14} />}
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => closeGroup(group.id)}
              title="이 패널 닫기"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
