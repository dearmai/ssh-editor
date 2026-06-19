const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  json: 'json',
  jsonc: 'json',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  md: 'markdown',
  mdx: 'markdown',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  tf: 'hcl',
  hcl: 'hcl',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  hs: 'haskell',
  elm: 'elm',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  vue: 'html',
  svelte: 'html',
  ini: 'ini',
  env: 'shell',
  conf: 'ini',
  nginx: 'nginx',
  log: 'plaintext',
  txt: 'plaintext',
};

export function detectLanguage(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? '';
  const lower = fileName.toLowerCase();

  // 특수 파일명 처리
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  if (lower === '.env' || lower.startsWith('.env.')) return 'shell';
  if (lower === 'nginx.conf' || lower.endsWith('.nginx')) return 'nginx';

  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx === -1) return 'plaintext';

  const ext = fileName.slice(dotIdx + 1).toLowerCase();
  return EXT_MAP[ext] ?? 'plaintext';
}
