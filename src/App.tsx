import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useEffect, useRef, useState } from 'react';
import { Activity, AppWindow, Clock } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import BottomPanel from './components/BottomPanel';
import EditorArea from './components/EditorArea';
import SidePanel from './components/SidePanel';
import SettingsDialog from './components/Dialogs/SettingsDialog';
import SaveConflictDialog from './components/Dialogs/SaveConflictDialog';
import OpenFileDialog from './components/Dialogs/OpenFileDialog';
import ThemePicker from './components/ThemePicker';
import { getStartupArgs, openNewWindow, sshPing } from './ipc/commands';
import { onTransferProgress } from './ipc/events';
import { useConnectionStore } from './stores/connectionStore';
import { useTransferStore } from './stores/transferStore';
import { useFileTreeStore } from './stores/fileTreeStore';
import {
  applyUiFont,
  effectiveTheme,
  useSettingsStore,
} from './stores/settingsStore';
import { applyColorTheme, getTheme } from './themes';
import { log } from './stores/logStore';
import type { PingInfo } from './types';
import styles from './App.module.css';

export default function App() {
  const { loadAll, selectedSessionId, activeConnections } = useConnectionStore();
  const rootPaths = useFileTreeStore((s) => s.rootPaths);
  const [showSettings, setShowSettings] = useState(false);

  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily);
  const uiFontSize = useSettingsStore((s) => s.uiFontSize);
  const theme = useSettingsStore((s) => s.theme);
  const themeOverrides = useSettingsStore((s) => s.themeOverrides);
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const lightTheme = useSettingsStore((s) => s.lightTheme);
  const setResolvedTheme = useSettingsStore((s) => s.setResolvedTheme);

  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);
  const profileId = conn?.profile.id;
  const folderPath = selectedSessionId ? rootPaths.get(selectedSessionId) : undefined;

  // 초기 로드 + 메뉴 이벤트
  useEffect(() => {
    loadAll();
    getStartupArgs().then((args) => {
      if (args) log.info(`CLI 실행 인자: ${JSON.stringify(args)}`);
    });
    log.info('SSH Editor 시작됨');

    const unlistenPrefs = listen('menu-preferences', () => setShowSettings(true));
    const unlistenTransfer = onTransferProgress((p) =>
      useTransferStore.getState().applyProgress(p)
    );
    return () => {
      unlistenPrefs.then((fn) => fn());
      unlistenTransfer.then((fn) => fn());
    };
  }, [loadAll]);

  // UI 폰트 적용
  useEffect(() => {
    applyUiFont({ uiFontFamily, uiFontSize });
  }, [uiFontFamily, uiFontSize]);

  // 테마 적용 (폴더 → 서버 → 전역 해석 + 시스템 변경 추적)
  useEffect(() => {
    const apply = () => {
      const resolved = effectiveTheme({ theme, themeOverrides }, profileId, folderPath);
      const themeId = resolved === 'dark' ? darkTheme : lightTheme;
      applyColorTheme(getTheme(themeId, resolved));
      setResolvedTheme(resolved);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, themeOverrides, darkTheme, lightTheme, profileId, folderPath, setResolvedTheme]);

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
              <Allotment.Pane minSize={80} preferredSize={220}>
                <BottomPanel />
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </div>

      <div className={styles.statusBar}>
        <div className={styles.statusBarContent}>
          <span className={styles.statusItem}>
            {conn
              ? `${conn.profile.username}@${conn.profile.hostname}`
              : 'SSH Editor'}
          </span>
          {selectedSessionId && <ServerStatus sessionId={selectedSessionId} />}
          <TransferStatus />

          <div className={styles.statusRight}>
            <button
              className={styles.statusBtn}
              onClick={() => openNewWindow().catch((e) => log.error(`새 창 열기 실패: ${e}`))}
              title="새 창 (다른 서버 접속)"
            >
              <AppWindow size={12} />
              새 창
            </button>
            <ThemePicker profileId={profileId} folderPath={folderPath} variant="statusbar" />
          </div>
        </div>
      </div>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <SaveConflictDialog />
      <OpenFileDialog />
    </div>
  );
}

function TransferStatus() {
  const transfers = useTransferStore((s) => s.transfers);
  const active = transfers.filter((t) => t.status === 'active' || t.status === 'queued');
  if (active.length === 0) return null;

  const current = active.find((t) => t.status === 'active') ?? active[0];
  const pct =
    current.status === 'active' && current.total > 0
      ? Math.min(100, Math.round((current.transferred / current.total) * 100))
      : null;

  return (
    <span className={styles.statusItem} title="진행 중인 전송">
      {current.kind === 'upload' ? '⬆' : '⬇'} {current.name}
      {pct !== null ? ` ${pct}%` : '…'}
      {active.length > 1 ? ` (+${active.length - 1})` : ''}
    </span>
  );
}

function ServerStatus({ sessionId }: { sessionId: string }) {
  const [info, setInfo] = useState<PingInfo | null>(null);
  const [, setTick] = useState(0);
  const fetchedAtRef = useRef(0);

  // 서버 시간/ping 폴링
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const p = await sshPing(sessionId);
        if (!alive) return;
        setInfo(p);
        fetchedAtRef.current = Date.now();
      } catch {
        if (alive) setInfo(null);
      }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sessionId]);

  // 1초마다 시계 갱신
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!info) return null;

  const drift = Date.now() - fetchedAtRef.current;
  const serverMs = info.epoch * 1000 + drift + info.tzOffsetMinutes * 60000;
  const d = new Date(serverMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const pingColor =
    info.pingMs < 80 ? '#4ec9b0' : info.pingMs < 200 ? '#dcdcaa' : '#f48771';

  return (
    <>
      <span className={styles.statusItem} title="서버 시간">
        <Clock size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
        {clock}
      </span>
      <span className={styles.statusItem} style={{ color: pingColor }} title="왕복 지연 (ping)">
        <Activity size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
        {info.pingMs}ms
      </span>
    </>
  );
}
