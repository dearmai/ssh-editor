import { Allotment } from 'allotment';
import { useState } from 'react';
import { useEditorStore, type EditorGroup } from '../../stores/editorStore';
import EditorTabs from './EditorTabs';
import MonacoPane from './MonacoPane';
import WelcomeScreen from './WelcomeScreen';
import styles from './EditorArea.module.css';

function GroupView({ group }: { group: EditorGroup }) {
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup);
  const moveTab = useEditorStore((s) => s.moveTab);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData('application/x-editor-tab');
    if (!raw) return;
    try {
      const { tabId, groupId } = JSON.parse(raw) as { tabId: string; groupId: string };
      if (groupId !== group.id) moveTab(tabId, groupId, group.id);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className={`${styles.pane} ${dragOver ? styles.dropTarget : ''}`}
      onMouseDown={() => setActiveGroup(group.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-editor-tab')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={handleDrop}
    >
      <EditorTabs group={group} />
      {group.activeTabId ? (
        <MonacoPane key={group.activeTabId} tabId={group.activeTabId} />
      ) : (
        <WelcomeScreen />
      )}
    </div>
  );
}

export default function EditorArea() {
  const groups = useEditorStore((s) => s.groups);
  const splitDirection = useEditorStore((s) => s.splitDirection);

  return (
    <div className={styles.area}>
      {groups.length === 2 ? (
        <Allotment vertical={splitDirection === 'vertical'}>
          <Allotment.Pane>
            <GroupView group={groups[0]} />
          </Allotment.Pane>
          <Allotment.Pane>
            <GroupView group={groups[1]} />
          </Allotment.Pane>
        </Allotment>
      ) : (
        <GroupView group={groups[0]} />
      )}
    </div>
  );
}
