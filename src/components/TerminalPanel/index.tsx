import { GripVertical, PanelBottom, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import TerminalGrid from '../BottomPanel/TerminalGrid';
import TerminalSidebar from '../BottomPanel/TerminalSidebar';
import styles from './TerminalPanel.module.css';

/**
 * 터미널 전용 패널. App의 그리드 자식으로 한 번만 마운트되고 도킹 위치만 CSS로 바뀌므로
 * 하단 ↔ 우측을 오가도 xterm이 재생성되지 않는다(스크롤백 보존).
 * 헤더는 우측 도킹일 때만 표시 — 하단에서는 BottomPanel의 탭 바가 그 역할을 한다.
 */
export default function TerminalPanel({ visible }: { visible: boolean }) {
  // visible=false면 App이 감싼 영역을 display:none 처리한다 (xterm은 마운트 유지)
  const terminalPosition = useSettingsStore((s) => s.terminalPosition);
  const listCollapsed = useSettingsStore((s) => s.terminalListCollapsed);
  const setSetting = useSettingsStore((s) => s.set);
  const setDraggingPanel = useSettingsStore((s) => s.setDraggingPanel);

  const docked = terminalPosition === 'right';

  return (
    <div className={styles.panel}>
      {docked && (
        <div className={styles.header}>
          <div
            className={styles.dockHandle}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', 'terminal-panel');
              e.dataTransfer.effectAllowed = 'move';
              setDraggingPanel(true);
            }}
            onDragEnd={() => setDraggingPanel(false)}
            title="드래그해서 터미널 위치 이동 (우측 ↔ 하단)"
          >
            <GripVertical size={14} />
          </div>
          <span className={styles.title}>터미널</span>
          <button
            className={styles.actionBtn}
            onClick={() => setSetting('terminalListCollapsed', !listCollapsed)}
            title={listCollapsed ? '터미널 목록 펼치기' : '터미널 목록 접기'}
          >
            {listCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
          </button>
          <button
            className={styles.actionBtn}
            onClick={() => setSetting('terminalPosition', 'bottom')}
            title="하단 패널로 이동"
          >
            <PanelBottom size={14} />
          </button>
        </div>
      )}

      <div className={styles.body}>
        <div className={styles.main}>
          <TerminalGrid active={visible} />
        </div>
        {!listCollapsed && <TerminalSidebar compact={docked} />}
      </div>
    </div>
  );
}
