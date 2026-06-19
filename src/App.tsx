import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useEffect, useState } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import BottomPanel from './components/BottomPanel';
import EditorArea from './components/EditorArea';
import SidePanel from './components/SidePanel';
import SettingsDialog from './components/Dialogs/SettingsDialog';
import { getStartupArgs } from './ipc/commands';
import { useConnectionStore } from './stores/connectionStore';
import { useTerminalStore } from './stores/terminalStore';
import { useLogStore } from './stores/logStore';
import styles from './App.module.css';

export default function App() {
  const { loadAll } = useConnectionStore();
  const { isBottomPanelOpen, toggleBottomPanel } = useTerminalStore();
  const { addLog } = useLogStore();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadAll();
    getStartupArgs().then((args) => {
      if (args) addLog('info', `CLI 실행 인자: ${JSON.stringify(args)}`);
    });

    // 메뉴바 "환경설정" 이벤트
    const unlisten = listen('menu-preferences', () => {
      setShowSettings(true);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadAll]);

  return (
    <div className={styles.app}>
      <div className={styles.main}>
        <Allotment>
          <Allotment.Pane minSize={160} maxSize={480} preferredSize={240} snap>
            <SidePanel />
          </Allotment.Pane>
          <Allotment.Pane>
            <Allotment vertical>
              <Allotment.Pane>
                <EditorArea />
              </Allotment.Pane>
              {isBottomPanelOpen && (
                <Allotment.Pane minSize={80} preferredSize={240} snap>
                  <BottomPanel />
                </Allotment.Pane>
              )}
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </div>
      <div className={styles.statusBar}>
        <StatusBar onTogglePanel={toggleBottomPanel} isPanelOpen={isBottomPanelOpen} />
      </div>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

function StatusBar({
  onTogglePanel,
  isPanelOpen,
}: {
  onTogglePanel: () => void;
  isPanelOpen: boolean;
}) {
  const { selectedSessionId, activeConnections } = useConnectionStore();
  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);

  return (
    <div className={styles.statusBarContent}>
      <span className={styles.statusItem}>
        {conn
          ? `SSH: ${conn.profile.username}@${conn.profile.hostname}`
          : 'SSH Editor'}
      </span>
      <div className={styles.statusRight}>
        <button
          className={`${styles.statusBtn} ${isPanelOpen ? styles.active : ''}`}
          onClick={onTogglePanel}
          title="터미널 / 로그 토글"
        >
          <TerminalIcon size={12} />
          터미널
        </button>
      </div>
    </div>
  );
}
