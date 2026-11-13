import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_INDENT, DEFAULT_INDENT_BY_EXT, indentKeyFor, type IndentRule } from '../utils/indent';
import type { LogLevel } from './logStore';

export const DEFAULT_UI_FONT =
  "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
export const DEFAULT_MONO_FONT =
  "'D2Coding', 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace";

/** 번들 폰트 도입 이전 기본값들 — 저장본 마이그레이션 판별용 */
const LEGACY_UI_FONTS = [
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
];
const LEGACY_MONO_FONTS = [
  "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  "D2Coding, 'D2Coding ligature', 'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
];

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
  /** 에디터 줄 높이 (글꼴 크기 배수) */
  editorLineHeight: number;
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
  /** 확장자·파일명 지정이 없을 때 쓰는 기본 들여쓰기 */
  indentDefault: IndentRule;
  /** 확장자(소문자, 점 없음) 또는 특수 파일명 → 들여쓰기 규칙 */
  indentByExt: Record<string, IndentRule>;
  /** 로컬 파일 암복호화 기능 사용 여부 */
  localCryptoEnabled: boolean;
  /** 암호화 시 붙이고 복호화 시 떼는 확장자 (빈 값이면 확장자 변경 없이 제자리 교체) */
  localCryptoExtension: string;
  /** 파일 열기 용량 한도 (MB) — 일반: 확인 없이 편집기로, 대용량: 확인 후 편집기로 전체 로딩 가능, 초과: 보기 모드만 */
  localNormalMB: number;
  localLargeMB: number;
  remoteNormalMB: number;
  remoteLargeMB: number;
  /** eco: 열린 탭 내용 합계가 이 값(MB)을 넘으면 안 보이는 탭을 메모리에서 해제 (0 = 자동 해제 끔) */
  ecoThresholdMB: number;
}

interface SettingsStore extends Settings {
  /** 현재 창에 실제 적용된 테마 (런타임 전용, 비영속) */
  resolvedTheme: ResolvedTheme;
  /** 터미널 패널을 드래그로 옮기는 중인지 (런타임 전용, 비영속) */
  draggingPanel: boolean;
  setDraggingPanel: (v: boolean) => void;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setThemeOverride: (scopeKey: string, mode: ThemeMode | null) => void;
  /** 확장자별 들여쓰기 규칙 설정 (rule=null 이면 항목 삭제 → 기본값 사용) */
  setIndentRule: (ext: string, rule: IndentRule | null) => void;
  setResolvedTheme: (t: ResolvedTheme) => void;
  reset: () => void;
}

const DEFAULTS: Settings = {
  uiFontFamily: DEFAULT_UI_FONT,
  uiFontSize: 13,
  editorFontFamily: DEFAULT_MONO_FONT,
  editorFontSize: 14,
  editorLineHeight: 1.5,
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
  indentDefault: DEFAULT_INDENT,
  indentByExt: DEFAULT_INDENT_BY_EXT,
  localCryptoEnabled: false,
  localCryptoExtension: '.data',
  localNormalMB: 50,
  localLargeMB: 100,
  remoteNormalMB: 1,
  remoteLargeMB: 10,
  ecoThresholdMB: 200,
};

/** 편집기로 전체를 읽을 수 있는 최대 크기 (Rust file_view::MAX_OPEN_LIMIT 과 같게) */
export const MAX_OPEN_MB = 512;

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
      setIndentRule: (ext, rule) =>
        set((s) => {
          const key = ext.trim().toLowerCase().replace(/^[.*]+/, '');
          if (!key) return s;
          const indentByExt = { ...s.indentByExt };
          if (rule) indentByExt[key] = rule;
          else delete indentByExt[key];
          return { indentByExt };
        }),
      setResolvedTheme: (t) => set({ resolvedTheme: t }),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'ssh-editor-settings',
      version: 3,
      // v0 저장본에는 terminalPosition(및 구 panelPosition/panelWidth)이 남아 있어
      // 새 창이 우측 도킹으로 복원되므로 제거한다.
      // v1 → v2: 폰트를 번들 Pretendard/D2Coding으로 교체. 사용자가 직접 바꾼 값은
      // 존중하고, 예전 기본값 그대로인 항목만 새 기본값으로 올린다.
      migrate: (persisted) => {
        const st = { ...(persisted as Record<string, unknown>) };
        delete st.terminalPosition;
        delete st.panelPosition;
        delete st.panelWidth;

        for (const [key, legacy, next] of [
          ['uiFontFamily', LEGACY_UI_FONTS, DEFAULT_UI_FONT],
          ['editorFontFamily', LEGACY_MONO_FONTS, DEFAULT_MONO_FONT],
          ['terminalFontFamily', LEGACY_MONO_FONTS, DEFAULT_MONO_FONT],
        ] as const) {
          const cur = st[key];
          if (typeof cur === 'string' && legacy.includes(cur)) st[key] = next;
        }
        // v2 → v3: 로컬 일반 파일 한도 기본값 10MB → 50MB (직접 바꾼 값은 유지)
        if (st.localNormalMB === 10) st.localNormalMB = 50;
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
        setIndentRule: _si,
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

/** 확장자 규칙 + 전역 기본값으로 해석한 파일의 들여쓰기 (파일별 오버라이드는 indentStore에서 우선 적용) */
export function indentForPath(filePath: string, settings: Settings): IndentRule {
  return settings.indentByExt[indentKeyFor(filePath)] ?? settings.indentDefault ?? DEFAULT_INDENT;
}

// ── 파일 열기 용량 한도 ────────────────────────────
/** 연결(로컬/원격)별 파일 열기 한도 (바이트) */
export function openLimits(connectionId: string): { normal: number; large: number } {
  const s = useSettingsStore.getState();
  const local = connectionId === 'local';
  const MB = 1024 * 1024;
  const large = Math.min(MAX_OPEN_MB, Math.max(1, local ? s.localLargeMB : s.remoteLargeMB));
  const normal = Math.min(large, Math.max(0.1, local ? s.localNormalMB : s.remoteNormalMB));
  return { normal: normal * MB, large: large * MB };
}
