import type { ITheme } from '@xterm/xterm';

export interface ColorTheme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  /** CSS 변수 맵 */
  vars: Record<string, string>;
  /** Monaco 테마 정의 */
  monaco: {
    base: 'vs' | 'vs-dark';
    colors: Record<string, string>;
    rules: { token: string; foreground?: string; fontStyle?: string }[];
  };
  /** xterm 터미널 테마 */
  terminal: ITheme;
}

interface Palette {
  bg: string;
  bgAlt: string;
  bgAlt2: string;
  hover: string;
  active: string;
  fg: string;
  fgDim: string;
  fgMuted: string;
  border: string;
  accent: string;
  accentHover: string;
  selection: string;
  statusBg: string;
  statusFg: string;
  dirty: string;
  // 구문 강조
  comment: string;
  keyword: string;
  str: string;
  num: string;
  type: string;
  func: string;
  // ANSI 16색
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const noHash = (c: string) => c.replace('#', '');

function mk(id: string, name: string, type: 'dark' | 'light', p: Palette): ColorTheme {
  return {
    id,
    name,
    type,
    vars: {
      '--bg-primary': p.bg,
      '--bg-secondary': p.bgAlt,
      '--bg-tertiary': p.bgAlt2,
      '--bg-hover': p.hover,
      '--bg-active': p.active,
      '--text-primary': p.fg,
      '--text-secondary': p.fgDim,
      '--text-muted': p.fgMuted,
      '--border': p.border,
      '--accent': p.accent,
      '--accent-hover': p.accentHover,
      '--activity-bar-bg': p.bgAlt2,
      '--activity-bar-fg': p.fgMuted,
      '--activity-bar-active': p.fg,
      '--tab-active-bg': p.bg,
      '--tab-inactive-bg': p.bgAlt2,
      '--tab-active-border': p.accent,
      '--dirty-dot': p.dirty,
      '--status-bar-bg': p.statusBg,
      '--status-bar-fg': p.statusFg,
      '--scrollbar-thumb': p.active,
    },
    monaco: {
      base: type === 'dark' ? 'vs-dark' : 'vs',
      colors: {
        'editor.background': p.bg,
        'editor.foreground': p.fg,
        'editorLineNumber.foreground': p.fgMuted,
        'editorLineNumber.activeForeground': p.fgDim,
        'editorCursor.foreground': p.accent,
        'editor.selectionBackground': p.selection,
        'editor.lineHighlightBackground': p.hover,
        'editorWidget.background': p.bgAlt,
        'editorWidget.border': p.border,
        'editorIndentGuide.background': p.border,
        'editorGutter.background': p.bg,
        'minimap.background': p.bg,
        'scrollbarSlider.background': `${p.active}88`,
      },
      rules: [
        { token: '', foreground: noHash(p.fg) },
        { token: 'comment', foreground: noHash(p.comment), fontStyle: 'italic' },
        { token: 'keyword', foreground: noHash(p.keyword) },
        { token: 'keyword.control', foreground: noHash(p.keyword) },
        { token: 'string', foreground: noHash(p.str) },
        { token: 'number', foreground: noHash(p.num) },
        { token: 'type', foreground: noHash(p.type) },
        { token: 'type.identifier', foreground: noHash(p.type) },
        { token: 'function', foreground: noHash(p.func) },
        { token: 'variable', foreground: noHash(p.fg) },
        { token: 'tag', foreground: noHash(p.keyword) },
        { token: 'attribute.name', foreground: noHash(p.func) },
        { token: 'delimiter', foreground: noHash(p.fgDim) },
      ],
    },
    terminal: {
      background: p.bg,
      foreground: p.fg,
      cursor: p.accent,
      cursorAccent: p.bg,
      selectionBackground: p.selection,
      black: p.black,
      red: p.red,
      green: p.green,
      yellow: p.yellow,
      blue: p.blue,
      magenta: p.magenta,
      cyan: p.cyan,
      white: p.white,
      brightBlack: p.brightBlack,
      brightRed: p.brightRed,
      brightGreen: p.brightGreen,
      brightYellow: p.brightYellow,
      brightBlue: p.brightBlue,
      brightMagenta: p.brightMagenta,
      brightCyan: p.brightCyan,
      brightWhite: p.brightWhite,
    },
  };
}

// ─────────────────────────── 다크 테마 ───────────────────────────
const DARK: ColorTheme[] = [
  mk('vscode-dark', 'VS Code Dark+', 'dark', {
    bg: '#1e1e1e', bgAlt: '#252526', bgAlt2: '#2d2d30', hover: '#2a2d2e', active: '#37373d',
    fg: '#cccccc', fgDim: '#858585', fgMuted: '#6a6a6a', border: '#3c3c3c',
    accent: '#007acc', accentHover: '#1a8ad4', selection: '#264f78', statusBg: '#007acc', statusFg: '#ffffff', dirty: '#e8a54b',
    comment: '#6a9955', keyword: '#569cd6', str: '#ce9178', num: '#b5cea8', type: '#4ec9b0', func: '#dcdcaa',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
  }),
  mk('dracula', 'Dracula', 'dark', {
    bg: '#282a36', bgAlt: '#21222c', bgAlt2: '#191a21', hover: '#2d2f3b', active: '#44475a',
    fg: '#f8f8f2', fgDim: '#bdbecb', fgMuted: '#6272a4', border: '#191a21',
    accent: '#bd93f9', accentHover: '#caa5fb', selection: '#44475a', statusBg: '#bd93f9', statusFg: '#282a36', dirty: '#ffb86c',
    comment: '#6272a4', keyword: '#ff79c6', str: '#f1fa8c', num: '#bd93f9', type: '#8be9fd', func: '#50fa7b',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
  }),
  mk('one-dark', 'One Dark', 'dark', {
    bg: '#282c34', bgAlt: '#21252b', bgAlt2: '#1b1f23', hover: '#2c313a', active: '#3e4451',
    fg: '#abb2bf', fgDim: '#828997', fgMuted: '#5c6370', border: '#181a1f',
    accent: '#61afef', accentHover: '#7bbef0', selection: '#3e4451', statusBg: '#61afef', statusFg: '#282c34', dirty: '#e5c07b',
    comment: '#5c6370', keyword: '#c678dd', str: '#98c379', num: '#d19a66', type: '#e5c07b', func: '#61afef',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  }),
  mk('monokai', 'Monokai', 'dark', {
    bg: '#272822', bgAlt: '#2d2e28', bgAlt2: '#1e1f1c', hover: '#34352f', active: '#49483e',
    fg: '#f8f8f2', fgDim: '#a59f85', fgMuted: '#75715e', border: '#1e1f1c',
    accent: '#a6e22e', accentHover: '#b6f23e', selection: '#49483e', statusBg: '#a6e22e', statusFg: '#272822', dirty: '#fd971f',
    comment: '#75715e', keyword: '#f92672', str: '#e6db74', num: '#ae81ff', type: '#66d9ef', func: '#a6e22e',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75', blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75', brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
  }),
  mk('nord', 'Nord', 'dark', {
    bg: '#2e3440', bgAlt: '#2b303b', bgAlt2: '#272c36', hover: '#3b4252', active: '#434c5e',
    fg: '#d8dee9', fgDim: '#a8b1c2', fgMuted: '#6c7689', border: '#3b4252',
    accent: '#88c0d0', accentHover: '#8fbcbb', selection: '#434c5e', statusBg: '#5e81ac', statusFg: '#eceff4', dirty: '#ebcb8b',
    comment: '#616e88', keyword: '#81a1c1', str: '#a3be8c', num: '#b48ead', type: '#8fbcbb', func: '#88c0d0',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  }),
  mk('tokyo-night', 'Tokyo Night', 'dark', {
    bg: '#1a1b26', bgAlt: '#16161e', bgAlt2: '#13131a', hover: '#1f2335', active: '#292e42',
    fg: '#c0caf5', fgDim: '#9aa5ce', fgMuted: '#565f89', border: '#1f2335',
    accent: '#7aa2f7', accentHover: '#89b4fa', selection: '#283457', statusBg: '#7aa2f7', statusFg: '#1a1b26', dirty: '#e0af68',
    comment: '#565f89', keyword: '#bb9af7', str: '#9ece6a', num: '#ff9e64', type: '#2ac3de', func: '#7aa2f7',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
  }),
  mk('solarized-dark', 'Solarized Dark', 'dark', {
    bg: '#002b36', bgAlt: '#073642', bgAlt2: '#00313d', hover: '#073642', active: '#094a58',
    fg: '#93a1a1', fgDim: '#839496', fgMuted: '#586e75', border: '#073642',
    accent: '#268bd2', accentHover: '#2aa198', selection: '#073642', statusBg: '#268bd2', statusFg: '#fdf6e3', dirty: '#b58900',
    comment: '#586e75', keyword: '#859900', str: '#2aa198', num: '#d33682', type: '#b58900', func: '#268bd2',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  }),
  mk('gruvbox-dark', 'Gruvbox Dark', 'dark', {
    bg: '#282828', bgAlt: '#32302f', bgAlt2: '#1d2021', hover: '#3c3836', active: '#504945',
    fg: '#ebdbb2', fgDim: '#d5c4a1', fgMuted: '#928374', border: '#3c3836',
    accent: '#fe8019', accentHover: '#fabd2f', selection: '#504945', statusBg: '#458588', statusFg: '#ebdbb2', dirty: '#fabd2f',
    comment: '#928374', keyword: '#fb4934', str: '#b8bb26', num: '#d3869b', type: '#fabd2f', func: '#b8bb26',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
  }),
];

// ─────────────────────────── 라이트 테마 ───────────────────────────
const LIGHT: ColorTheme[] = [
  mk('vscode-light', 'VS Code Light', 'light', {
    bg: '#ffffff', bgAlt: '#f3f3f3', bgAlt2: '#ececec', hover: '#e8e8e8', active: '#dcdcdc',
    fg: '#1f1f1f', fgDim: '#5a5a5a', fgMuted: '#8a8a8a', border: '#d4d4d4',
    accent: '#0066b8', accentHover: '#1a7ad4', selection: '#add6ff', statusBg: '#0066b8', statusFg: '#ffffff', dirty: '#c08a2b',
    comment: '#008000', keyword: '#0000ff', str: '#a31515', num: '#098658', type: '#267f99', func: '#795e26',
    black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
    brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5',
  }),
  mk('solarized-light', 'Solarized Light', 'light', {
    bg: '#fdf6e3', bgAlt: '#eee8d5', bgAlt2: '#e7e0c9', hover: '#eee8d5', active: '#ddd6c1',
    fg: '#586e75', fgDim: '#657b83', fgMuted: '#93a1a1', border: '#d8d2bf',
    accent: '#268bd2', accentHover: '#2aa198', selection: '#eee8d5', statusBg: '#268bd2', statusFg: '#fdf6e3', dirty: '#b58900',
    comment: '#93a1a1', keyword: '#859900', str: '#2aa198', num: '#d33682', type: '#b58900', func: '#268bd2',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  }),
  mk('github-light', 'GitHub Light', 'light', {
    bg: '#ffffff', bgAlt: '#f6f8fa', bgAlt2: '#eaeef2', hover: '#eaeef2', active: '#d0d7de',
    fg: '#1f2328', fgDim: '#57606a', fgMuted: '#8c959f', border: '#d0d7de',
    accent: '#0969da', accentHover: '#1a7ad4', selection: '#b6e3ff', statusBg: '#0969da', statusFg: '#ffffff', dirty: '#9a6700',
    comment: '#6e7781', keyword: '#cf222e', str: '#0a3069', num: '#0550ae', type: '#953800', func: '#8250df',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  }),
  mk('gruvbox-light', 'Gruvbox Light', 'light', {
    bg: '#fbf1c7', bgAlt: '#f2e5bc', bgAlt2: '#ebdbb2', hover: '#ebdbb2', active: '#d5c4a1',
    fg: '#3c3836', fgDim: '#504945', fgMuted: '#7c6f64', border: '#d5c4a1',
    accent: '#af3a03', accentHover: '#d65d0e', selection: '#ebdbb2', statusBg: '#427b58', statusFg: '#fbf1c7', dirty: '#b57614',
    comment: '#928374', keyword: '#9d0006', str: '#79740e', num: '#8f3f71', type: '#b57614', func: '#79740e',
    black: '#fbf1c7', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#7c6f64',
    brightBlack: '#928374', brightRed: '#9d0006', brightGreen: '#79740e', brightYellow: '#b57614', brightBlue: '#076678', brightMagenta: '#8f3f71', brightCyan: '#427b58', brightWhite: '#3c3836',
  }),
];

export const DARK_THEMES = DARK;
export const LIGHT_THEMES = LIGHT;

const BY_ID: Record<string, ColorTheme> = {};
for (const t of [...DARK, ...LIGHT]) BY_ID[t.id] = t;

export function getTheme(id: string, fallbackType: 'dark' | 'light' = 'dark'): ColorTheme {
  return BY_ID[id] ?? (fallbackType === 'dark' ? DARK[0] : LIGHT[0]);
}

/** :root 에 CSS 변수 + data-theme 적용 */
export function applyColorTheme(t: ColorTheme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  root.setAttribute('data-theme', t.type);
}

/** Monaco 테마 이름 (커스텀은 sshe-<id>) */
export function monacoThemeName(t: ColorTheme): string {
  if (t.id === 'vscode-dark') return 'vs-dark';
  if (t.id === 'vscode-light') return 'vs';
  return `sshe-${t.id}`;
}

let definedMonaco = false;
/** 모든 커스텀 Monaco 테마를 한 번 정의 */
export function defineMonacoThemes(monaco: { editor: { defineTheme: (name: string, data: unknown) => void } }) {
  if (definedMonaco) return;
  for (const t of [...DARK, ...LIGHT]) {
    if (t.id === 'vscode-dark' || t.id === 'vscode-light') continue;
    monaco.editor.defineTheme(monacoThemeName(t), {
      base: t.monaco.base,
      inherit: true,
      rules: t.monaco.rules,
      colors: t.monaco.colors,
    });
  }
  definedMonaco = true;
}
