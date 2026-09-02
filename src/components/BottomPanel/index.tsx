import { GripVertical, PanelRight, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useTransferStore } from '../../stores/transferStore';
import LogPane from './LogPane';
import TransferPane from './TransferPane';
import styles from './BottomPanel.module.css';

/**
 * 하단 패널 — 로그/전송은 항상 여기에 있고, 터미널은 하단 도킹일 때만 탭으로 참여한다.
 * 터미널 본체(TerminalPanel)는 App의 그리드 자식이라 여기서 렌더하지 않는다(재마운트 방지).
 */
export default function BottomPanel() {
  const sessions = useTerminalStore((s) => s.sessions);
  const setDraggingTerminal = useTerminalStore((s) => s.setDraggingTerminal);
  const activeTransfers = useTransferStore(
    (s) => s.transfers.filter((t) => t.status === 'active' || t.status === 'queued').length
  );
  const terminalPosition = useSettingsStore((s) => s.terminalPosition);
  const panelTab = useSettingsStore((s) => s.panelTab);
  const listCollapsed = useSettingsStore((s) => s.terminalListCollapsed);
  const setSetting = useSettingsStore((s) => s.set);
  const setDraggingPanel = useSettingsStore((s) => s.setDraggingPanel);

  const terminalDocked = terminalPosition === 'bottom';

  // 드래그가 끝나면(드롭/취소 무관) 드래그 상태를 확실히 해제
  useEffect(() => {
    const clear = () => {
      setDraggingTerminal(null);
      setDraggingPanel(false);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [setDraggingTerminal, setDraggingPanel]);

  // 터미널이 우측으로 빠지면 하단 탭 선택을 로그로 되돌린다
  useEffect(() => {
    if (!terminalDocked && panelTab === 'terminal') setSetting('panelTab', 'log');
  }, [terminalDocked, panelTab, setSetting]);

  const isLogActive = panelTab === 'log';
  const isTransferActive = panelTab === 'transfer';
  const isTerminalActive = terminalDocked && panelTab === 'terminal';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${isLogActive ? styles.active : ''}`}
            onClick={() => setSetting('panelTab', 'log')}
          >
            로그
          </button>
          <button
            className={`${styles.tab} ${isTransferActive ? styles.active : ''}`}
            onClick={() => setSetting('panelTab', 'transfer')}
          >
            전송
            {activeTransfers > 0 && <span className={styles.badge}>{activeTransfers}</span>}
          </button>
          {terminalDocked && (
            <button
              className={`${styles.tab} ${isTerminalActive ? styles.active : ''}`}
              onClick={() => setSetting('panelTab', 'terminal')}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'terminal-panel');
                e.dataTransfer.effectAllowed = 'move';
                setSetting('panelTab', 'terminal');
                setDraggingPanel(true);
              }}
              onDragEnd={() => setDraggingPanel(false)}
              title="터미널 — 드래그해서 우측 사이드바로 이동"
            >
              터미널
              {sessions.length > 0 && <span className={styles.count}>{sessions.length}</span>}
            </button>
          )}
        </div>

        {isTerminalActive && (
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={() => setSetting('terminalListCollapsed', !listCollapsed)}
              title={listCollapsed ? '터미널 목록 펼치기' : '터미널 목록 접기'}
            >
              {listCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => setSetting('terminalPosition', 'right')}
              title="터미널을 우측 사이드바로 이동"
            >
              <PanelRight size={14} />
            </button>
            {/* 드래그해서 도킹 위치를 바꾸는 손잡이 */}
            <div
              className={styles.dockHandle}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', 'terminal-panel');
                e.dataTransfer.effectAllowed = 'move';
                setDraggingPanel(true);
              }}
              onDragEnd={() => setDraggingPanel(false)}
              title="드래그해서 터미널 위치 이동 (하단 ↔ 우측)"
            >
              <GripVertical size={14} />
            </div>
          </div>
        )}
      </div>

      <div className={styles.content}>
        <div style={{ display: isLogActive ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <LogPane />
        </div>
        <div style={{ display: isTransferActive ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <TransferPane />
        </div>
      </div>
    </div>
  );
}
