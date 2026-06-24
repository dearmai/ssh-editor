import { Moon, Plus, SplitSquareHorizontal, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { confirm } from '../../../stores/confirmStore';
import { useConnectionStore } from '../../../stores/connectionStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTerminalStore } from '../../../stores/terminalStore';
import styles from './TerminalSidebar.module.css';

/** VSCode식 터미널 탭 사이드바 (우측). 분할 그룹별로 묶어 세로 목록으로 관리 */
export default function TerminalSidebar() {
  const sessions = useTerminalStore((s) => s.sessions);
  const groups = useTerminalStore((s) => s.groups);
  const activeGroupId = useTerminalStore((s) => s.activeGroupId);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const focusTerminal = useTerminalStore((s) => s.focusTerminal);
  const createSession = useTerminalStore((s) => s.createSession);
  const splitNewTerminal = useTerminalStore((s) => s.splitNewTerminal);
  const splitTerminal = useTerminalStore((s) => s.splitTerminal);
  const closeSession = useTerminalStore((s) => s.closeSession);
  const setTerminalTheme = useTerminalStore((s) => s.setTerminalTheme);
  const setDraggingTerminal = useTerminalStore((s) => s.setDraggingTerminal);
  const selectedSessionId = useConnectionStore((s) => s.selectedSessionId);
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme);

  // 사이드바 내 드래그 재배치 시 삽입 위치 (left=위/앞, right=아래/뒤)
  const [dropAt, setDropAt] = useState<{ id: string; side: 'left' | 'right' } | null>(null);

  useEffect(() => {
    const clear = () => setDropAt(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  const titleOf = (id: string) => sessions.find((s) => s.id === id)?.title ?? id;
  const activeTerminal = sessions.find((s) => s.id === activeSessionId);
  const activeTheme = activeTerminal?.theme ?? resolvedTheme;

  const sideForRow = (e: React.DragEvent, el: HTMLElement): 'left' | 'right' => {
    const r = el.getBoundingClientRect();
    return e.clientY - r.top < r.height / 2 ? 'left' : 'right';
  };

  const handleClose = async (id: string) => {
    const ok = await confirm({
      title: '터미널 닫기',
      message: `'${titleOf(id)}' 터미널을 닫을까요? 실행 중인 셸과 작업이 종료됩니다.`,
      confirmLabel: '닫기',
      danger: true,
    });
    if (ok) closeSession(id);
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.head}>
        <span className={styles.headTitle}>터미널</span>
        <div className={styles.headActions}>
          {activeTerminal && (
            <button
              className={styles.iconBtn}
              onClick={() =>
                setTerminalTheme(activeTerminal.id, activeTheme === 'light' ? 'dark' : 'light')
              }
              title="이 터미널 라이트/다크 전환"
            >
              {activeTheme === 'light' ? <Moon size={13} /> : <Sun size={13} />}
            </button>
          )}
          <button
            className={styles.iconBtn}
            onClick={() => activeSessionId && splitNewTerminal(activeSessionId, 'right')}
            disabled={!activeSessionId}
            title="가로 분할 (옆에 새 터미널)"
          >
            <SplitSquareHorizontal size={13} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={() => selectedSessionId && createSession(selectedSessionId)}
            disabled={!selectedSessionId}
            title="새 터미널"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {sessions.length === 0 && <div className={styles.empty}>터미널 없음</div>}
        {groups.map((group) => {
          const isActiveGroup = group.id === activeGroupId;
          const split = group.terminalIds.length > 1;
          return (
            <div
              key={group.id}
              className={`${styles.group} ${split ? styles.splitGroup : ''} ${
                isActiveGroup ? styles.activeGroup : ''
              }`}
            >
              {group.terminalIds.map((id) => {
                const focused = id === activeSessionId;
                const dropBefore = dropAt?.id === id && dropAt.side === 'left';
                const dropAfter = dropAt?.id === id && dropAt.side === 'right';
                return (
                  <div
                    key={id}
                    className={`${styles.row} ${split ? styles.rowGrouped : ''} ${
                      focused ? styles.focused : ''
                    } ${dropBefore ? styles.dropBefore : ''} ${dropAfter ? styles.dropAfter : ''}`}
                    draggable
                    onDragStart={(e) => {
                      // WKWebView 호환: payload는 스토어로, setData는 드래그 개시용
                      e.dataTransfer.setData('text/plain', id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingTerminal(id);
                    }}
                    onDragEnd={() => setDraggingTerminal(null)}
                    onDragEnter={(e) => {
                      if (useTerminalStore.getState().draggingTerminal) e.preventDefault();
                    }}
                    onDragOver={(e) => {
                      const dragId = useTerminalStore.getState().draggingTerminal;
                      if (!dragId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragId === id) {
                        setDropAt(null);
                        return;
                      }
                      setDropAt({ id, side: sideForRow(e, e.currentTarget) });
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDropAt((d) => (d?.id === id ? null : d));
                      }
                    }}
                    onDrop={(e) => {
                      const dragId = useTerminalStore.getState().draggingTerminal;
                      setDropAt(null);
                      if (!dragId) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const side = sideForRow(e, e.currentTarget);
                      setDraggingTerminal(null);
                      splitTerminal(dragId, id, side); // 같은 그룹=순서변경, 다른 그룹=이동
                    }}
                    onClick={() => focusTerminal(id)}
                    title={`${titleOf(id)} — 클릭: 표시 / 드래그: 순서변경·그룹 이동`}
                  >
                    <span className={styles.rowTitle}>{titleOf(id)}</span>
                    <button
                      className={styles.rowClose}
                      title="터미널 닫기"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClose(id);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
