import { X } from 'lucide-react';
import { useEditorStore } from '../../../stores/editorStore';
import styles from './EditorTabs.module.css';

interface Props {
  pane: 'left' | 'right';
}

export default function EditorTabs({ pane }: Props) {
  const { tabs, activeTabId, rightPaneTabId, setActiveTab, closeTab, moveToSplit, closeSplitView } =
    useEditorStore();

  const currentTabId = pane === 'left' ? activeTabId : rightPaneTabId;

  if (tabs.length === 0) return <div className={styles.emptyBar} />;

  return (
    <div className={styles.bar}>
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`${styles.tab} ${tab.id === currentTabId ? styles.active : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onDoubleClick={() => moveToSplit(tab.id)}
            title={tab.remotePath}
          >
            {tab.isDirty && <span className={styles.dirty} title="저장되지 않은 변경사항" />}
            <span className={styles.name}>{tab.fileName}</span>
            <button
              className={styles.close}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title="탭 닫기"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        {pane === 'right' && (
          <button className={styles.actionBtn} onClick={closeSplitView} title="분할 뷰 닫기">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
