import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileKey,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
} from 'lucide-react';
import { detectLanguage } from './languageDetect';

interface FileIconInfo {
  Icon: typeof File;
  color: string;
}

const DEFAULT: FileIconInfo = { Icon: File, color: 'var(--text-secondary)' };

// detectLanguage()가 돌려주는 언어 id 기준 — languageDetect.ts 의 확장자 매핑을 그대로 재사용
const LANGUAGE_MAP: Record<string, FileIconInfo> = {
  typescript: { Icon: FileCode, color: '#3b82f6' },
  javascript: { Icon: FileCode, color: '#eab308' },
  python: { Icon: FileCode, color: '#3572a5' },
  rust: { Icon: FileCode, color: '#ce422b' },
  go: { Icon: FileCode, color: '#00add8' },
  java: { Icon: FileCode, color: '#b07219' },
  kotlin: { Icon: FileCode, color: '#7f52ff' },
  c: { Icon: FileCode, color: '#5a6bad' },
  cpp: { Icon: FileCode, color: '#f34b7d' },
  csharp: { Icon: FileCode, color: '#68217a' },
  ruby: { Icon: FileCode, color: '#cc342d' },
  php: { Icon: FileCode, color: '#787cb5' },
  swift: { Icon: FileCode, color: '#f05138' },
  shell: { Icon: FileTerminal, color: '#4ade80' },
  powershell: { Icon: FileTerminal, color: '#4ade80' },
  yaml: { Icon: FileCog, color: '#a78bfa' },
  toml: { Icon: FileCog, color: '#9ca3af' },
  json: { Icon: FileJson, color: '#f0b429' },
  xml: { Icon: FileCode, color: '#f97316' },
  html: { Icon: FileCode, color: '#f97316' },
  css: { Icon: FileCode, color: '#3b82f6' },
  scss: { Icon: FileCode, color: '#ec4899' },
  less: { Icon: FileCode, color: '#2563eb' },
  markdown: { Icon: FileText, color: '#60a5fa' },
  sql: { Icon: FileCode, color: '#e38c00' },
  graphql: { Icon: FileCode, color: '#e535ab' },
  dockerfile: { Icon: FileCog, color: '#38bdf8' },
  makefile: { Icon: FileTerminal, color: '#4ade80' },
  hcl: { Icon: FileCog, color: '#844fba' },
  lua: { Icon: FileCode, color: '#000080' },
  r: { Icon: FileCode, color: '#276dc3' },
  scala: { Icon: FileCode, color: '#dc322f' },
  haskell: { Icon: FileCode, color: '#5e5086' },
  elm: { Icon: FileCode, color: '#1293d8' },
  elixir: { Icon: FileCode, color: '#6e4a7e' },
  erlang: { Icon: FileCode, color: '#a90533' },
  clojure: { Icon: FileCode, color: '#5881d8' },
  ini: { Icon: FileCog, color: '#9ca3af' },
  nginx: { Icon: FileCog, color: '#009639' },
  caddyfile: { Icon: FileCog, color: '#22c55e' },
  plaintext: { Icon: FileText, color: '#9ca3af' },
};

// language 로 구분되지 않는 문서/미디어/바이너리류는 확장자로 직접 처리
const EXT_MAP: Record<string, FileIconInfo> = {
  pdf: { Icon: FileText, color: '#ef4444' },
  doc: { Icon: FileText, color: '#3b82f6' },
  docx: { Icon: FileText, color: '#3b82f6' },
  csv: { Icon: FileSpreadsheet, color: '#22c55e' },
  xlsx: { Icon: FileSpreadsheet, color: '#22c55e' },
  xls: { Icon: FileSpreadsheet, color: '#22c55e' },
  svg: { Icon: FileImage, color: '#fb923c' },
  png: { Icon: FileImage, color: '#a78bfa' },
  jpg: { Icon: FileImage, color: '#c084fc' },
  jpeg: { Icon: FileImage, color: '#c084fc' },
  gif: { Icon: FileImage, color: '#e879f9' },
  webp: { Icon: FileImage, color: '#a78bfa' },
  bmp: { Icon: FileImage, color: '#a78bfa' },
  ico: { Icon: FileImage, color: '#a78bfa' },
  mp3: { Icon: FileAudio, color: '#f472b6' },
  wav: { Icon: FileAudio, color: '#f472b6' },
  flac: { Icon: FileAudio, color: '#f472b6' },
  mp4: { Icon: FileVideo, color: '#fb7185' },
  mov: { Icon: FileVideo, color: '#fb7185' },
  mkv: { Icon: FileVideo, color: '#fb7185' },
  avi: { Icon: FileVideo, color: '#fb7185' },
  zip: { Icon: FileArchive, color: '#eab308' },
  tar: { Icon: FileArchive, color: '#d4a373' },
  gz: { Icon: FileArchive, color: '#d4a373' },
  xz: { Icon: FileArchive, color: '#d4a373' },
  rar: { Icon: FileArchive, color: '#d4a373' },
  '7z': { Icon: FileArchive, color: '#d4a373' },
  lock: { Icon: FileKey, color: '#9ca3af' },
  pem: { Icon: FileKey, color: '#facc15' },
  key: { Icon: FileKey, color: '#facc15' },
  crt: { Icon: FileKey, color: '#facc15' },
  woff: { Icon: FileType, color: '#38bdf8' },
  woff2: { Icon: FileType, color: '#38bdf8' },
  ttf: { Icon: FileType, color: '#38bdf8' },
  otf: { Icon: FileType, color: '#38bdf8' },
};

// 확장자 없는 특수 파일명
const NAME_MAP: Record<string, FileIconInfo> = {
  '.env': { Icon: FileKey, color: '#facc15' },
  '.gitignore': { Icon: FileCog, color: '#f97316' },
  '.gitattributes': { Icon: FileCog, color: '#f97316' },
  license: { Icon: FileText, color: '#f59e0b' },
  readme: { Icon: FileText, color: '#60a5fa' },
};

/** 파일명 기준 아이콘·색상 결정 (확장자 → 특수 파일명 → 언어 감지 순) */
export function fileIconFor(name: string): FileIconInfo {
  const lower = name.toLowerCase();
  if (NAME_MAP[lower]) return NAME_MAP[lower];

  const dot = lower.lastIndexOf('.');
  const ext = dot > 0 ? lower.slice(dot + 1) : '';
  if (EXT_MAP[ext]) return EXT_MAP[ext];

  return LANGUAGE_MAP[detectLanguage(name)] ?? DEFAULT;
}
