import { Allotment } from 'allotment';
import { useEffect, useState } from 'react';
import { nodeKey, useEditorStore, type DropSide, type LayoutNode } from '../../stores/editorStore';
import EditorTabs from './EditorTabs';
import MonacoPane from './MonacoPane';
import WelcomeScreen from './WelcomeScreen';
import styles from './EditorArea.module.css';

const TAB_BAR_H = 35;
const EDGE = 0.25; // 가장자리 판정 비율
type Zone = DropSide | 'center';

/** 패널 본문 내 커서 위치로 영역 판정. 탭 바(상단)는 EditorTabs가 처리하므로 null */
function zoneFromBody(e: React.DragEvent): Zone | null {
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top;
  if (y < TAB_BAR_H) return null;
  const xf = (e.clientX - rect.left) / rect.width;
  const yf = (y - TAB_BAR_H) / Math.max(1, rect.height - TAB_BAR_H);
  const dl = xf;
  const dr = 1 - xf;
  const dt = yf;
  const db = 1 - yf;
  const min = Math.min(dl, dr, dt, db);
  if (min > EDGE) return 'center';
  if (min === dr) return 'right';
  if (min === dl) return 'left';
  if (min === db) return 'bottom';
  return 'top';
}

function GroupView({ groupId }: { groupId: string }) {
  const group = useEditorStore((s) => s.groupsById[groupId]);
  const groupCount = useEditorStore((s) => Object.keys(s.groupsById).length);
  const isActiveGroup = useEditorStore((s) => s.activeGroupId === groupId);
  const setActiveGroup = useEditorStore((s) => s.setActiveGroup);
  const moveTab = useEditorStore((s) => s.moveTab);
  const dropSplit = useEditorStore((s) => s.dropSplit);
  const setDraggingTab = useEditorStore((s) => s.setDraggingTab);
  const [zone, setZone] = useState<Zone | null>(null);

  const handleDrop = (e: React.DragEvent) => {
    const info = useEditorStore.getState().draggingTab;
    const z = zoneFromBody(e);
    setZone(null);
    if (!info || z === null) return; // 드래그 정보 없음 또는 탭 바(EditorTabs가 처리)
    e.preventDefault();
    e.stopPropagation();
    setDraggingTab(null);
    if (z === 'center') {
      if (info.fromGroupId !== groupId) moveTab(info.tabId, info.fromGroupId, groupId);
    } else {
      dropSplit(info.tabId, info.fromGroupId, groupId, z);
    }
  };

  if (!group) return null;

  return (
    <div
      className={`${styles.pane} ${isActiveGroup && groupCount > 1 ? styles.paneActive : ''}`}
      onMouseDown={() => setActiveGroup(groupId)}
      onDragEnter={(e) => {
        if (useEditorStore.getState().draggingTab) e.preventDefault();
      }}
      onDragOver={(e) => {
        if (!useEditorStore.getState().draggingTab) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setZone(zoneFromBody(e));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null);
      }}
      onDrop={handleDrop}
    >
      {isActiveGroup && groupCount > 1 && <div className={styles.activeStrip} />}
      <EditorTabs group={group} groupCount={groupCount} />
      {group.activeTabId ? (
        <MonacoPane key={`${groupId}:${group.activeTabId}`} tabId={group.activeTabId} />
      ) : groupCount > 1 ? (
        <div className={styles.emptyPane}>
          {isActiveGroup
            ? '여기로 파일이 열립니다 — 좌측 트리에서 파일을 선택하세요'
            : '좌측 파일 트리에서 파일을 열면 이 패널에 표시됩니다'}
        </div>
      ) : (
        <WelcomeScreen />
      )}
      {zone && <div className={`${styles.dropZone} ${styles[`zone_${zone}`]}`} />}
    </div>
  );
}

/** 레이아웃 트리를 중첩 Allotment로 렌더 */
function renderNode(node: LayoutNode): React.ReactNode {
  if (node.type === 'leaf') return <GroupView groupId={node.groupId} />;
  return (
    <Allotment vertical={node.direction === 'vertical'}>
      {node.children.map((child) => (
        <Allotment.Pane key={nodeKey(child)}>{renderNode(child)}</Allotment.Pane>
      ))}
    </Allotment>
  );
}

export default function EditorArea() {
  const layout = useEditorStore((s) => s.layout);

  // 드래그가 끝나면(드롭/취소 무관) 드래그 상태를 확실히 해제
  useEffect(() => {
    const clear = () => useEditorStore.getState().setDraggingTab(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  return <div className={styles.area}>{renderNode(layout)}</div>;
}
