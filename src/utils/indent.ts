/**
 * 들여쓰기 규칙 — 확장자별 기본값 + 파일별 오버라이드를 해석한다.
 * insertSpaces=true 면 soft tab(공백), false 면 hard tab(\t).
 */
export interface IndentRule {
  insertSpaces: boolean;
  tabSize: number;
}

/** 전역 기본값 (확장자·파일 지정이 없을 때) */
export const DEFAULT_INDENT: IndentRule = { insertSpaces: true, tabSize: 2 };

export const TAB_SIZES = [2, 4, 8] as const;

/**
 * 확장자별 기본 규칙. 키는 소문자 확장자(점 없음) 또는 확장자 없는 특수 파일명.
 * 각 언어 커뮤니티의 통용 스타일을 따랐다.
 */
export const DEFAULT_INDENT_BY_EXT: Record<string, IndentRule> = {
  // hard tab 문화권
  go: { insertSpaces: false, tabSize: 4 },
  makefile: { insertSpaces: false, tabSize: 4 }, // Make는 문법상 탭 필수
  mk: { insertSpaces: false, tabSize: 4 },

  // 4칸 공백
  py: { insertSpaces: true, tabSize: 4 },
  rs: { insertSpaces: true, tabSize: 4 },
  java: { insertSpaces: true, tabSize: 4 },
  kt: { insertSpaces: true, tabSize: 4 },
  cs: { insertSpaces: true, tabSize: 4 },
  c: { insertSpaces: true, tabSize: 4 },
  h: { insertSpaces: true, tabSize: 4 },
  cpp: { insertSpaces: true, tabSize: 4 },
  hpp: { insertSpaces: true, tabSize: 4 },
  php: { insertSpaces: true, tabSize: 4 },
  swift: { insertSpaces: true, tabSize: 4 },
  sql: { insertSpaces: true, tabSize: 4 },
  sh: { insertSpaces: true, tabSize: 4 },
  bash: { insertSpaces: true, tabSize: 4 },
  zsh: { insertSpaces: true, tabSize: 4 },
  ps1: { insertSpaces: true, tabSize: 4 },
  lua: { insertSpaces: true, tabSize: 4 },
  ex: { insertSpaces: true, tabSize: 2 },

  // 2칸 공백
  ts: { insertSpaces: true, tabSize: 2 },
  tsx: { insertSpaces: true, tabSize: 2 },
  js: { insertSpaces: true, tabSize: 2 },
  jsx: { insertSpaces: true, tabSize: 2 },
  mjs: { insertSpaces: true, tabSize: 2 },
  cjs: { insertSpaces: true, tabSize: 2 },
  json: { insertSpaces: true, tabSize: 2 },
  jsonc: { insertSpaces: true, tabSize: 2 },
  yaml: { insertSpaces: true, tabSize: 2 },
  yml: { insertSpaces: true, tabSize: 2 },
  toml: { insertSpaces: true, tabSize: 2 },
  html: { insertSpaces: true, tabSize: 2 },
  htm: { insertSpaces: true, tabSize: 2 },
  vue: { insertSpaces: true, tabSize: 2 },
  svelte: { insertSpaces: true, tabSize: 2 },
  css: { insertSpaces: true, tabSize: 2 },
  scss: { insertSpaces: true, tabSize: 2 },
  less: { insertSpaces: true, tabSize: 2 },
  md: { insertSpaces: true, tabSize: 2 },
  rb: { insertSpaces: true, tabSize: 2 },
  scala: { insertSpaces: true, tabSize: 2 },
  hcl: { insertSpaces: true, tabSize: 2 },
  tf: { insertSpaces: true, tabSize: 2 },
  xml: { insertSpaces: true, tabSize: 2 },
  ini: { insertSpaces: true, tabSize: 2 },
  conf: { insertSpaces: true, tabSize: 2 },
  nginx: { insertSpaces: true, tabSize: 4 },
  caddyfile: { insertSpaces: true, tabSize: 4 },
  dockerfile: { insertSpaces: true, tabSize: 4 },
};

/**
 * 규칙 조회 키 — 소문자 확장자. 확장자가 없으면 파일명 자체(dockerfile, makefile 등).
 */
export function indentKeyFor(filePath: string): string {
  const fileName = (filePath.split('/').pop() ?? '').toLowerCase();
  const dot = fileName.lastIndexOf('.');
  // 앞에 점만 있는 dotfile(.env 등)은 확장자가 아니라 이름으로 취급
  if (dot <= 0) return fileName;
  return fileName.slice(dot + 1);
}

/** 파일 오버라이드 저장 키 — 세션마다 바뀌는 connectionId 대신 서버 식별자를 쓴다 */
export function fileIndentKey(serverKey: string, remotePath: string): string {
  return `${serverKey}:${remotePath}`;
}
