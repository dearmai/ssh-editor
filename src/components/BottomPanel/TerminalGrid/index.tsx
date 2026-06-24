import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTerminalStore } from '../../../stores/terminalStore';
import TerminalPane from '../Terminal';
import styles from './TerminalGrid.module.css';

const MIN_RATIO = 0.12; // 인접 두 열 사이 최소 비율 (열이 사라지지 않게)
const EMPTY_COLS: string[] = [];

type DropSide = 'left' | 'right';

/** 하단 패널의 터미널 영역. 열(column) 분할 레이아웃 + 드래그 드롭 분할/재배치 + 리사이즈 */
export default function TerminalGrid({ active }: { active: boolean }) {
  const sessions = useTerminalStore((s) => s.sessions);
  // 메인 영역에 보이는 열 = 활성 그룹의 터미널들
  const columns = useTerminalStore((s) => {
    const g = s.groups.find((x) => x.id === s.activeGroupId);
    return g ? g.terminalIds : EMPTY_COLS;
  });
  const columnSizes = useTerminalStore((s) => s.columnSizes);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const focusTerminal = useTerminalStore((s) => s.focusTerminal);
  const splitTerminal = useTerminalStore((s) => s.splitTerminal);
  const splitNewTerminal = useTerminalStore((s) => s.splitNewTerminal);
  const removeColumn = useTerminalStore((s) => s.removeColumn);
  const setColumnSizes = useTerminalStore((s) => s.setColumnSizes);
  const setDraggingTerminal = useTerminalStore((s) => s.setDraggingTerminal);

  const [dropTarget, setDropTarget] = useState<{ id: string; side: DropSide } | null>(null);
  const colRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const split = columns.length > 1;

  const sideFor = (e: React.DragEvent, el: HTMLElement): DropSide => {
    const rect = el.getBoundingClientRect();
    return e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    const dragId = useTerminalStore.getState().draggingTerminal;
    const side = sideFor(e, e.currentTarget as HTMLElement);
    setDropTarget(null);
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingTerminal(null);
    // 자기 열에 드롭(= 단일 터미널 쪼개기) → 새 터미널 생성, 다른 터미널 → 옆으로 이동
    if (dragId === targetId) splitNewTerminal(targetId, side);
    else splitTerminal(dragId, targetId, side);
  };

  // 두 인접 열 사이 거터 드래그 → 비율 재분배 (다른 열 가중치는 보존)
  const startResize = (e: React.PointerEvent, leftId: string, rightId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const leftEl = colRefs.current.get(leftId);
    const rightEl = colRefs.current.get(rightId);
    if (!leftEl || !rightEl) return;
    const total = leftEl.getBoundingClientRect().width + rightEl.getBoundingClientRect().width;
    if (total <= 0) return;
    const leftStart = leftEl.getBoundingClientRect().width;
    const sizes = useTerminalStore.getState().columnSizes;
    const sum = (sizes[leftId] ?? 1) + (sizes[rightId] ?? 1);
    const startX = e.clientX;

    const onMove = (ev: PointerEvent) => {
      let ratio = (leftStart + (ev.clientX - startX)) / total;
      ratio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio));
      setColumnSizes({ [leftId]: sum * ratio, [rightId]: sum * (1 - ratio) });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className={styles.grid}>
      {sessions.length === 0 && (
        <div className={styles.empty}>
          <p>+ 버튼으로 터미널을 여세요</p>
        </div>
      )}

      {sessions.map((session) => {
        const colIndex = columns.indexOf(session.id);
        const visible = colIndex >= 0;
        const isActive = session.id === activeSessionId;
        return (
          <div
            key={session.id}
            ref={(el) => {
              if (el) colRefs.current.set(session.id, el);
              else colRefs.current.delete(session.id);
            }}
            className={`${styles.col} ${isActive && split ? styles.colActive : ''}`}
            style={
              visible
                ? { order: colIndex, flexGrow: columnSizes[session.id] ?? 1, flexBasis: 0, display: 'flex' }
                : { display: 'none' }
            }
            onMouseDown={() => focusTerminal(session.id)}
            onDragEnter={(e) => {
              if (useTerminalStore.getState().draggingTerminal) e.preventDefault();
            }}
            onDragOver={(e) => {
              if (!useTerminalStore.getState().draggingTerminal) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropTarget({ id: session.id, side: sideFor(e, e.currentTarget) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropTarget((t) => (t?.id === session.id ? null : t));
              }
            }}
            onDrop={(e) => handleDrop(e, session.id)}
          >
            {visible && colIndex > 0 && (
              <div
                key="gutter"
                className={styles.gutter}
                onPointerDown={(e) => startResize(e, columns[colIndex - 1], session.id)}
              />
            )}
            {split && (
              <button
                key="unsplit"
                className={styles.unsplit}
                title="이 칸을 분할에서 분리 (별도 탭으로, 터미널은 유지)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeColumn(session.id);
                }}
              >
                <X size={13} />
              </button>
            )}
            <div key="body" className={styles.body}>
              <TerminalPane
                sessionId={session.id}
                connectionId={session.connectionId}
                visible={active && visible}
              />
            </div>
            {dropTarget?.id === session.id && (
              <div
                key="dropzone"
                className={`${styles.dropZone} ${
                  dropTarget.side === 'left' ? styles.zoneLeft : styles.zoneRight
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
