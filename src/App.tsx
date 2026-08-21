import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useEffect, useRef, useState } from 'react';
import { Activity, AppWindow, Clock, WrapText } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import BottomPanel from './components/BottomPanel';
import EditorArea from './components/EditorArea';
import SidePanel from './components/SidePanel';
import SettingsDialog from './components/Dialogs/SettingsDialog';
import SaveConflictDialog from './components/Dialogs/SaveConflictDialog';
import OpenFileDialog from './components/Dialogs/OpenFileDialog';
import ConfirmDialog from './components/Dialogs/ConfirmDialog';
import PromptDialog from './components/Dialogs/PromptDialog';
import ReconnectDialog from './components/Dialogs/ReconnectDialog';
import ExternalChangeDialog from './components/Dialogs/ExternalChangeDialog';
import ThemePicker from './components/ThemePicker';
import LanguageStatus from './components/LanguageStatus';
import { getStartupArgs, openNewWindow, sshPing } from './ipc/commands';
import { onTransferProgress } from './ipc/events';
import { useConnectionStore } from './stores/connectionStore';
import { useEditorStore } from './stores/editorStore';
import { useTransferStore } from './stores/transferStore';
import { useFileTreeStore } from './stores/fileTreeStore';
import {
  applyEditorFont,
  applyUiFont,
  effectiveTheme,
  useSettingsStore,
} from './stores/settingsStore';
import { applyColorTheme, getTheme } from './themes';
import { log } from './stores/logStore';
import type { PingInfo } from './types';
import styles from './App.module.css';

/** 현재 선택된 세션의 파일 트리를 서버 기준으로 새로고침 (열려있던 경로만) */
function refreshVisibleFileTree() {
  const selected = useConnectionStore.getState().selectedSessionId;
  if (selected) useFileTreeStore.getState().refreshConnection(selected).catch(() => {});
}

export default function App() {
  const { loadAll, selectedSessionId, activeConnections } = useConnectionStore();
  const rootPaths = useFileTreeStore((s) => s.rootPaths);
  const [showSettings, setShowSettings] = useState(false);

  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily);
  const uiFontSize = useSettingsStore((s) => s.uiFontSize);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const theme = useSettingsStore((s) => s.theme);
  const themeOverrides = useSettingsStore((s) => s.themeOverrides);
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const lightTheme = useSettingsStore((s) => s.lightTheme);
  const setResolvedTheme = useSettingsStore((s) => s.setResolvedTheme);

  const conn = activeConnections.find((c) => c.sessionId === selectedSessionId);
  const profileId = conn?.profile.id;
  const folderPath = selectedSessionId ? rootPaths.get(selectedSessionId) : undefined;
  const profileName = conn?.profile.name;

  // 타이틀바에 현재 선택된 서버 이름 표시 (창마다 독립적)
  useEffect(() => {
    const title = profileName ? `${profileName} — SSH Editor` : 'SSH Editor';
    getCurrentWindow()
      .setTitle(title)
      .catch((err) => log.warn(`타이틀 변경 실패: ${err}`));
  }, [profileName]);

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

  // 창 복귀(포커스/가시성 전환) 시 연결 생존 점검 → 끊김 감지/재접속 흐름
  useEffect(() => {
    let lastCheck = 0;
    const maybeCheck = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastCheck < 3000) return; // 짧은 연속 포커스 전환 스로틀
      lastCheck = now;
      useConnectionStore.getState().checkConnections();
      // 열린 파일의 서버 측 외부 변경도 함께 검사
      useEditorStore.getState().checkVisibleExternalChanges();
      // 현재 보이는 파일 트리도 서버 쪽 변경사항(새 파일/삭제 등)이 있는지 새로고침
      refreshVisibleFileTree();
    };
    window.addEventListener('focus', maybeCheck);
    document.addEventListener('visibilitychange', maybeCheck);
    // 네이티브 창 포커스 (웹 focus 이벤트가 누락되는 경우 대비)
    let unlistenFocus: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) maybeCheck();
      })
      .then((fn) => {
        unlistenFocus = fn;
      })
      .catch(() => {});
    return () => {
      window.removeEventListener('focus', maybeCheck);
      document.removeEventListener('visibilitychange', maybeCheck);
      unlistenFocus?.();
    };
  }, []);

  // 창이 계속 포커스 상태여도 5초마다 파일 트리를 서버 기준으로 새로고침
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      refreshVisibleFileTree();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Cmd/Ctrl+W: 활성 탭 닫기 → 열린 탭이 하나도 없으면 창 닫기
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'w') return;
      e.preventDefault();
      e.stopPropagation();
      const st = useEditorStore.getState();
      const g = st.groupsById[st.activeGroupId];
      if (g && g.activeTabId) {
        st.closeTab(g.id, g.activeTabId);
        return;
      }
      const total = Object.values(st.groupsById).reduce((n, gr) => n + gr.tabIds.length, 0);
      if (total === 0) getCurrentWindow().close().catch((err) => log.error(`창 닫기 실패: ${err}`));
    };
    // capture: Monaco 등 하위 핸들러보다 먼저 가로채기
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Alt(Option)+Z: 활성 탭 자동 줄바꿈 토글 (메뉴 "보기 > 자동 줄바꿈" + 웹뷰 폴백)
  useEffect(() => {
    const toggleActive = () => {
      const st = useEditorStore.getState();
      const tabId = st.groupsById[st.activeGroupId]?.activeTabId;
      if (tabId) st.toggleWordWrap(tabId);
    };
    const unlistenMenu = listen('menu-toggle-word-wrap', toggleActive);

    // 네이티브 메뉴가 단축키를 못 받는 경우(웹뷰 포커스 등) 대비
    const onKeyDown = (e: KeyboardEvent) => {
      // macOS는 Option+Z가 'Ω'로 들어오므로 물리 키(code)로 판정
      if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== 'KeyZ') return;
      e.preventDefault();
      e.stopPropagation();
      toggleActive();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      unlistenMenu.then((fn) => fn());
    };
  }, []);

  // UI 폰트 적용
  useEffect(() => {
    applyUiFont({ uiFontFamily, uiFontSize });
  }, [uiFontFamily, uiFontSize]);

  // 에디터/터미널 monospace 폰트를 CSS 변수로 적용 (xterm 렌더 폰트 강제)
  useEffect(() => {
    applyEditorFont({ editorFontFamily, editorFontSize });
  }, [editorFontFamily, editorFontSize]);

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
            <WordWrapStatus />
            <LanguageStatus />
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
      <ConfirmDialog />
      <PromptDialog />
      <ReconnectDialog />
      <ExternalChangeDialog />
    </div>
  );
}

/** 상태바의 자동 줄바꿈 표시/토글 (활성 에디터 탭 대상) */
function WordWrapStatus() {
  const activeTab = useEditorStore((s) => {
    const id = s.groupsById[s.activeGroupId]?.activeTabId;
    return id ? s.tabsById[id] : undefined;
  });
  const toggleWordWrap = useEditorStore((s) => s.toggleWordWrap);
  if (!activeTab) return null;

  const on = !!activeTab.wordWrap;
  return (
    <button
      className={`${styles.statusBtn} ${on ? styles.active : ''}`}
      onClick={() => toggleWordWrap(activeTab.id)}
      title={`자동 줄바꿈 ${on ? '켜짐' : '꺼짐'} (⌥Z)`}
    >
      <WrapText size={12} />
      줄바꿈 {on ? '켬' : '끔'}
    </button>
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
    info.pingMs < 80 ? '#57e0c3' : info.pingMs < 200 ? '#f0e090' : '#ff9d85';

  return (
    <>
      <span className={styles.statusItem} title="서버 시간">
        <Clock size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
        {clock}
      </span>
      <span className={styles.pingChip} style={{ color: pingColor }} title="왕복 지연 (ping)">
        <Activity size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
        {info.pingMs}ms
      </span>
    </>
  );
}
