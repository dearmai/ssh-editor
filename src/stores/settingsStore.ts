import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LogLevel } from './logStore';

export const DEFAULT_UI_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
export const DEFAULT_MONO_FONT =
  "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace";

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';
/** 터미널 패널이 붙는 위치 (로그·전송은 항상 하단) */
export type TerminalPosition = 'bottom' | 'right';
/** 하단 패널에서 선택된 탭 */
export type PanelTab = 'log' | 'transfer' | 'terminal';

export interface Settings {
  /** 기본 UI 폰트 (sans-serif) */
  uiFontFamily: string;
  uiFontSize: number;
  /** 에디터 폰트 (monospace) */
  editorFontFamily: string;
  editorFontSize: number;
  /** 터미널 폰트 (monospace) — 에디터와 별개 */
  terminalFontFamily: string;
  terminalFontSize: number;
  /** 로그 최소 표시 레벨 */
  logLevelFilter: LogLevel | 'all';
  /** 전역 테마 모드 */
  theme: ThemeMode;
  /** 서버/폴더별 테마 오버라이드 (scopeKey → mode) */
  themeOverrides: Record<string, ThemeMode>;
  /** 다크 모드일 때 에디터·앱에 사용할 색상 테마 id */
  darkTheme: string;
  /** 라이트 모드일 때 에디터·앱에 사용할 색상 테마 id */
  lightTheme: string;
  /** 다크 모드일 때 터미널에 사용할 색상 테마 id (에디터와 별개) */
  terminalDarkTheme: string;
  /** 라이트 모드일 때 터미널에 사용할 색상 테마 id (에디터와 별개) */
  terminalLightTheme: string;
  /** Monaco 미니맵(코드 미리보기) 표시 여부 */
  minimapEnabled: boolean;
  /** 터미널 도킹 위치 (하단 탭 / 우측 사이드바). 창마다 초기값은 항상 'bottom' — 영속 제외 */
  terminalPosition: TerminalPosition;
  /** 좌측 탐색기 표시 여부 */
  sidebarVisible: boolean;
  /** 하단 패널에서 마지막으로 본 탭 */
  panelTab: PanelTab;
  /** 좌측 탐색기 폭 (px) */
  sidebarWidth: number;
  /** 하단 패널 높이 (px) */
  panelHeight: number;
  /** 우측 도킹 시 터미널 패널 폭 (px) */
  terminalWidth: number;
  /** 터미널 목록 사이드바 접기 */
  terminalListCollapsed: boolean;
}

interface SettingsStore extends Settings {
  /** 현재 창에 실제 적용된 테마 (런타임 전용, 비영속) */
  resolvedTheme: ResolvedTheme;
  /** 터미널 패널을 드래그로 옮기는 중인지 (런타임 전용, 비영속) */
  draggingPanel: boolean;
  setDraggingPanel: (v: boolean) => void;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setThemeOverride: (scopeKey: string, mode: ThemeMode | null) => void;
  setResolvedTheme: (t: ResolvedTheme) => void;
  reset: () => void;
}

const DEFAULTS: Settings = {
  uiFontFamily: DEFAULT_UI_FONT,
  uiFontSize: 13,
  editorFontFamily: DEFAULT_MONO_FONT,
  editorFontSize: 14,
  terminalFontFamily: DEFAULT_MONO_FONT,
  terminalFontSize: 14,
  logLevelFilter: 'all',
  theme: 'dark',
  themeOverrides: {},
  darkTheme: 'vscode-dark',
  lightTheme: 'vscode-light',
  terminalDarkTheme: 'vscode-dark',
  terminalLightTheme: 'vscode-light',
  minimapEnabled: true,
  terminalPosition: 'bottom',
  sidebarVisible: true,
  panelTab: 'log',
  sidebarWidth: 240,
  panelHeight: 220,
  terminalWidth: 420,
  terminalListCollapsed: false,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      resolvedTheme: 'dark',
      draggingPanel: false,
      setDraggingPanel: (v) => set({ draggingPanel: v }),
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      setThemeOverride: (scopeKey, mode) =>
        set((state) => {
          const next = { ...state.themeOverrides };
          if (mode === null) delete next[scopeKey];
          else next[scopeKey] = mode;
          return { themeOverrides: next };
        }),
      setResolvedTheme: (t) => set({ resolvedTheme: t }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'ssh-editor-settings',
      version: 1,
      // v0 저장본에는 terminalPosition(및 구 panelPosition/panelWidth)이 남아 있어
      // 새 창이 우측 도킹으로 복원되므로 제거한다
      migrate: (persisted) => {
        const st = { ...(persisted as Record<string, unknown>) };
        delete st.terminalPosition;
        delete st.panelPosition;
        delete st.panelWidth;
        return st as unknown as Settings;
      },
      // resolvedTheme·draggingPanel은 런타임 값, terminalPosition은 새 창에서 항상
      // 하단으로 시작해야 하므로 영속화에서 제외한다
      partialize: ({
        resolvedTheme: _omit,
        terminalPosition: _tp,
        draggingPanel: _dp,
        setDraggingPanel: _sdp,
        set: _s,
        setThemeOverride: _o,
        setResolvedTheme: _r,
        reset: _rs,
        ...rest
      }) => rest,
    }
  )
);

// ── 스코프 키 헬퍼 ────────────────────────────────
export const serverScopeKey = (profileId: string) => `srv:${profileId}`;
export const folderScopeKey = (profileId: string, path: string) => `dir:${profileId}:${path}`;

// ── 테마 해석 ─────────────────────────────────────
export function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function resolveMode(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode;
}

/** 폴더 → 서버 → 전역 순으로 오버라이드를 해석한 모드(미해석) */
export function effectiveMode(
  s: Pick<Settings, 'theme' | 'themeOverrides'>,
  profileId?: string,
  folderPath?: string
): ThemeMode {
  if (profileId && folderPath) {
    const dir = s.themeOverrides[folderScopeKey(profileId, folderPath)];
    if (dir) return dir;
  }
  if (profileId) {
    const srv = s.themeOverrides[serverScopeKey(profileId)];
    if (srv) return srv;
  }
  return s.theme;
}

/** 실제 적용할 dark/light 값 */
export function effectiveTheme(
  s: Pick<Settings, 'theme' | 'themeOverrides'>,
  profileId?: string,
  folderPath?: string
): ResolvedTheme {
  return resolveMode(effectiveMode(s, profileId, folderPath));
}

// ── DOM 적용 ──────────────────────────────────────
export function applyUiFont(settings: Pick<Settings, 'uiFontFamily' | 'uiFontSize'>) {
  const root = document.documentElement;
  root.style.setProperty('--font-ui', settings.uiFontFamily);
  root.style.setProperty('--font-size-base', `${settings.uiFontSize}px`);
}

/** 에디터/터미널 monospace 폰트를 CSS 변수로 노출 (xterm 렌더 폰트 강제용) */
export function applyEditorFont(settings: Pick<Settings, 'editorFontFamily' | 'editorFontSize'>) {
  const root = document.documentElement;
  root.style.setProperty('--font-mono', settings.editorFontFamily);
  root.style.setProperty('--editor-font-size', `${settings.editorFontSize}px`);
}

export function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved);
}
