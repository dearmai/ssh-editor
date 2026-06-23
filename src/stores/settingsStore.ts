import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LogLevel } from './logStore';

export const DEFAULT_UI_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
export const DEFAULT_MONO_FONT =
  "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace";

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export interface Settings {
  /** 기본 UI 폰트 (sans-serif) */
  uiFontFamily: string;
  uiFontSize: number;
  /** 에디터/터미널 폰트 (monospace) */
  editorFontFamily: string;
  editorFontSize: number;
  /** 로그 최소 표시 레벨 */
  logLevelFilter: LogLevel | 'all';
  /** 전역 테마 모드 */
  theme: ThemeMode;
  /** 서버/폴더별 테마 오버라이드 (scopeKey → mode) */
  themeOverrides: Record<string, ThemeMode>;
  /** 다크 모드일 때 사용할 색상 테마 id */
  darkTheme: string;
  /** 라이트 모드일 때 사용할 색상 테마 id */
  lightTheme: string;
  /** Monaco 미니맵(코드 미리보기) 표시 여부 */
  minimapEnabled: boolean;
}

interface SettingsStore extends Settings {
  /** 현재 창에 실제 적용된 테마 (런타임 전용, 비영속) */
  resolvedTheme: ResolvedTheme;
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
  logLevelFilter: 'all',
  theme: 'dark',
  themeOverrides: {},
  darkTheme: 'vscode-dark',
  lightTheme: 'vscode-light',
  minimapEnabled: true,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      resolvedTheme: 'dark',
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
      // resolvedTheme은 런타임 값이므로 영속화 제외
      partialize: ({ resolvedTheme: _omit, set: _s, setThemeOverride: _o, setResolvedTheme: _r, reset: _rs, ...rest }) =>
        rest,
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

export function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved);
}
