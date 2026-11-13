/**
 * 파일 연결(Windows) 대상 확장자 목록.
 * 설치 시 자동 연결하지 않으며, 환경설정 > 파일 연결에서 사용자가 직접 고른다.
 * (macOS/Linux 번들의 tauri.conf.json fileAssociations 와 같은 구성)
 */
export interface FileAssocGroup {
  name: string;
  exts: string[];
}

export const FILE_ASSOC_GROUPS: FileAssocGroup[] = [
  { name: 'Text', exts: ['txt', 'text', 'log', 'conf', 'cfg', 'ini', 'env'] },
  { name: 'Markdown', exts: ['md', 'markdown', 'mdx'] },
  { name: 'JSON', exts: ['json', 'jsonc', 'map'] },
  { name: 'YAML', exts: ['yaml', 'yml'] },
  { name: 'TOML', exts: ['toml'] },
  { name: 'XML', exts: ['xml', 'xsd', 'xsl', 'svg'] },
  { name: 'HTML', exts: ['html', 'htm', 'vue', 'svelte'] },
  { name: 'CSS', exts: ['css', 'scss', 'sass', 'less'] },
  { name: 'JavaScript', exts: ['js', 'jsx', 'mjs', 'cjs'] },
  { name: 'TypeScript', exts: ['ts', 'tsx', 'mts', 'cts'] },
  { name: 'Python', exts: ['py', 'pyi', 'pyw'] },
  { name: 'Shell', exts: ['sh', 'bash', 'zsh', 'fish'] },
  { name: 'C', exts: ['c', 'h'] },
  { name: 'C++', exts: ['cpp', 'cc', 'cxx', 'hpp', 'hxx'] },
  { name: 'Rust', exts: ['rs'] },
  { name: 'Go', exts: ['go'] },
  { name: 'Java', exts: ['java'] },
  { name: 'Ruby', exts: ['rb'] },
  { name: 'PHP', exts: ['php'] },
  { name: 'SQL', exts: ['sql'] },
  {
    name: '기타 소스',
    exts: [
      'kt', 'kts', 'cs', 'swift', 'lua', 'r', 'scala', 'tf', 'hcl', 'graphql', 'gql',
      'caddy', 'caddyfile', 'dockerfile', 'ps1', 'bat', 'cmd', 'csv', 'tsv',
    ],
  },
];

export const ALL_FILE_ASSOC_EXTS = FILE_ASSOC_GROUPS.flatMap((g) => g.exts);

/** 보통 다른 앱이 열거나 실행되는 확장자 — 연결 시 더블클릭 동작이 바뀔 수 있음 */
export const FILE_ASSOC_CAUTION: Record<string, string> = {
  html: '보통 브라우저로 여는 파일입니다.',
  htm: '보통 브라우저로 여는 파일입니다.',
  svg: '보통 브라우저/이미지 뷰어로 여는 파일입니다.',
  bat: '더블클릭 시 실행되는 스크립트입니다. 기본 앱으로 지정하면 실행 대신 편집됩니다.',
  cmd: '더블클릭 시 실행되는 스크립트입니다. 기본 앱으로 지정하면 실행 대신 편집됩니다.',
  ps1: 'PowerShell 스크립트입니다. 기본 앱으로 지정하면 실행 대신 편집됩니다.',
  pyw: '보통 Python으로 실행되는 파일입니다.',
  csv: '보통 Excel로 여는 파일입니다.',
  tsv: '보통 Excel로 여는 파일입니다.',
};

/** 파일 연결 관리 기능 지원 여부 (Windows만) */
export const isFileAssocPlatform = () => /Win/.test(navigator.platform) || /Windows/.test(navigator.userAgent);
