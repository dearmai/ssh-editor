import { X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  collectTermIds,
  useTerminalStore,
  type TermDropSide,
  type TermNode,
  type TermSplitDirection,
} from '../../../stores/terminalStore';
import TerminalPane from '../Terminal';
import styles from './TerminalGrid.module.css';

const MIN_RATIO = 0.1; // 인접 두 패널 사이 최소 비율 (패널이 사라지지 않게)

/** 패널 배치 결과 (모두 컨테이너 대비 %) */
interface PaneRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 두 패널 경계의 리사이즈 거터 */
interface GutterInfo {
  key: string;
  path: number[]; // 그룹 루트에서 이 split 노드까지의 자식 인덱스 경로
  index: number; // children[index] / children[index+1] 사이 경계
  direction: TermSplitDirection;
  sizes: number[];
  /** 거터 위치 (%) — 주축은 경계 좌표, 교차축은 부모 split 범위 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 부모 split 노드의 영역 (%) — 픽셀 환산용 */
  px: number;
  py: number;
  pw: number;
  ph: number;
}

/** 분할 트리를 순회해 각 리프의 사각형과 거터 목록을 계산 */
function layoutTree(root: TermNode): { rects: PaneRect[]; gutters: GutterInfo[] } {
  const rects: PaneRect[] = [];
  const gutters: GutterInfo[] = [];

  const walk = (node: TermNode, path: number[], x: number, y: number, w: number, h: number) => {
    if (node.type === 'leaf') {
      rects.push({ id: node.id, x, y, w, h });
      return;
    }
    const horiz = node.direction === 'horizontal';
    let offset = 0;
    node.children.forEach((child, i) => {
      const frac = node.sizes[i] ?? 1 / node.children.length;
      const cx = horiz ? x + w * offset : x;
      const cy = horiz ? y : y + h * offset;
      const cw = horiz ? w * frac : w;
      const ch = horiz ? h : h * frac;
      walk(child, [...path, i], cx, cy, cw, ch);
      offset += frac;
      if (i < node.children.length - 1) {
        gutters.push({
          key: `${path.join('.')}:${i}`,
          path,
          index: i,
          direction: node.direction,
          sizes: node.sizes,
          x: horiz ? x + w * offset : x,
          y: horiz ? y : y + h * offset,
          w: horiz ? 0 : w,
          h: horiz ? h : 0,
          px: x,
          py: y,
          pw: w,
          ph: h,
        });
      }
    });
  };

  walk(root, [], 0, 0, 100, 100);
  return { rects, gutters };
}

/** 커서 위치에서 가장 가까운 가장자리 → 드롭 방향 */
function sideFor(e: React.DragEvent, el: HTMLElement): TermDropSide {
  const r = el.getBoundingClientRect();
  const fx = (e.clientX - r.left) / Math.max(1, r.width);
  const fy = (e.clientY - r.top) / Math.max(1, r.height);
  const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
  let best: TermDropSide = 'right';
  for (const k of ['left', 'right', 'top', 'bottom'] as TermDropSide[]) {
    if (d[k] < d[best]) best = k;
  }
  return best;
}

/** 터미널 분할 영역. 좌우·상하 중첩 분할 트리 + 드래그 드롭 분할/재배치 + 거터 리사이즈 */
export default function TerminalGrid({ active }: { active: boolean }) {
  const sessions = useTerminalStore((s) => s.sessions);
  const activeGroup = useTerminalStore((s) => s.groups.find((g) => g.id === s.activeGroupId));
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const focusTerminal = useTerminalStore((s) => s.focusTerminal);
  const splitTerminal = useTerminalStore((s) => s.splitTerminal);
  const splitNewTerminal = useTerminalStore((s) => s.splitNewTerminal);
  const detachPane = useTerminalStore((s) => s.detachPane);
  const setSplitSizes = useTerminalStore((s) => s.setSplitSizes);
  const setDraggingTerminal = useTerminalStore((s) => s.setDraggingTerminal);

  const [dropTarget, setDropTarget] = useState<{ id: string; side: TermDropSide } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const { rects, gutters } = useMemo(
    () => (activeGroup ? layoutTree(activeGroup.root) : { rects: [], gutters: [] }),
    [activeGroup]
  );
  const rectById = useMemo(() => new Map(rects.map((r) => [r.id, r])), [rects]);
  const split = activeGroup ? collectTermIds(activeGroup.root).length > 1 : false;

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    const dragId = useTerminalStore.getState().draggingTerminal;
    const side = sideFor(e, e.currentTarget as HTMLElement);
    setDropTarget(null);
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingTerminal(null);
    // 자기 패널에 드롭(= 쪼개기) → 새 터미널 생성, 다른 터미널 → 그 자리로 이동
    if (dragId === targetId) splitNewTerminal(targetId, side);
    else splitTerminal(dragId, targetId, side);
  };

  // 거터 드래그 → 인접 두 자식 비율 재분배 (나머지 형제 비율은 보존)
  const startResize = (e: React.PointerEvent, g: GutterInfo) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    const groupId = useTerminalStore.getState().activeGroupId;
    if (!grid || !groupId) return;
    const gr = grid.getBoundingClientRect();
    const horiz = g.direction === 'horizontal';
    // 부모 split 노드의 픽셀 범위
    const parentStart = horiz ? gr.left + (gr.width * g.px) / 100 : gr.top + (gr.height * g.py) / 100;
    const parentLen = horiz ? (gr.width * g.pw) / 100 : (gr.height * g.ph) / 100;
    if (parentLen <= 0) return;
    const before = g.sizes.slice(0, g.index).reduce((a, b) => a + b, 0);
    const pair = (g.sizes[g.index] ?? 0) + (g.sizes[g.index + 1] ?? 0);
    if (pair <= 0) return;

    const onMove = (ev: PointerEvent) => {
      const pos = ((horiz ? ev.clientX : ev.clientY) - parentStart) / parentLen;
      let rel = (pos - before) / pair;
      rel = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, rel));
      const sizes = [...g.sizes];
      sizes[g.index] = pair * rel;
      sizes[g.index + 1] = pair * (1 - rel);
      setSplitSizes(groupId, g.path, sizes);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = horiz ? 'col-resize' : 'row-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div ref={gridRef} className={styles.grid}>
      {sessions.length === 0 && (
        <div className={styles.empty}>
          <p>+ 버튼으로 터미널을 여세요</p>
        </div>
      )}

      {sessions.map((session) => {
        const rect = rectById.get(session.id);
        const visible = !!rect;
        const isActive = session.id === activeSessionId;
        return (
          <div
            key={session.id}
            className={`${styles.pane} ${isActive && split ? styles.paneActive : ''}`}
            style={
              rect
                ? {
                    display: 'flex',
                    left: `${rect.x}%`,
                    top: `${rect.y}%`,
                    width: `${rect.w}%`,
                    height: `${rect.h}%`,
                  }
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
            {split && (
              <button
                key="unsplit"
                className={styles.unsplit}
                title="이 칸을 분할에서 분리 (별도 탭으로, 터미널은 유지)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  detachPane(session.id);
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
                className={`${styles.dropZone} ${styles[`zone_${dropTarget.side}`]}`}
              />
            )}
          </div>
        );
      })}

      {gutters.map((g) => (
        <div
          key={g.key}
          className={`${styles.gutter} ${
            g.direction === 'horizontal' ? styles.gutterV : styles.gutterH
          }`}
          style={
            g.direction === 'horizontal'
              ? { left: `${g.x}%`, top: `${g.y}%`, height: `${g.h}%` }
              : { top: `${g.y}%`, left: `${g.x}%`, width: `${g.w}%` }
          }
          onPointerDown={(e) => startResize(e, g)}
        />
      ))}
    </div>
  );
}
