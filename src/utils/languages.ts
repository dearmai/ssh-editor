/** 언어 모드 선택용 목록 (Monaco 언어 id ↔ 표시 이름). 상태바 표시·언어 선택 팔레트에서 사용 */
export interface LanguageOption {
  id: string;
  label: string;
}

export const LANGUAGES: LanguageOption[] = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'abap', label: 'ABAP' },
  { id: 'bat', label: 'Batch' },
  { id: 'bicep', label: 'Bicep' },
  { id: 'c', label: 'C' },
  { id: 'clojure', label: 'Clojure' },
  { id: 'coffeescript', label: 'CoffeeScript' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'dart', label: 'Dart' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'elixir', label: 'Elixir' },
  { id: 'elm', label: 'Elm' },
  { id: 'erlang', label: 'Erlang' },
  { id: 'fsharp', label: 'F#' },
  { id: 'go', label: 'Go' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'handlebars', label: 'Handlebars' },
  { id: 'haskell', label: 'Haskell' },
  { id: 'hcl', label: 'Terraform / HCL' },
  { id: 'html', label: 'HTML' },
  { id: 'ini', label: 'INI' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'julia', label: 'Julia' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'less', label: 'Less' },
  { id: 'lua', label: 'Lua' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'nginx', label: 'NGINX' },
  { id: 'objective-c', label: 'Objective-C' },
  { id: 'pascal', label: 'Pascal' },
  { id: 'perl', label: 'Perl' },
  { id: 'pgsql', label: 'PostgreSQL' },
  { id: 'php', label: 'PHP' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'python', label: 'Python' },
  { id: 'r', label: 'R' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'scala', label: 'Scala' },
  { id: 'scheme', label: 'Scheme' },
  { id: 'scss', label: 'SCSS' },
  { id: 'shell', label: 'Shell Script' },
  { id: 'sol', label: 'Solidity' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'tcl', label: 'Tcl' },
  { id: 'toml', label: 'TOML' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'vb', label: 'Visual Basic' },
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML' },
];

const LABELS = new Map(LANGUAGES.map((l) => [l.id, l.label]));

/** 언어 id의 표시 이름 (목록에 없으면 id 그대로) */
export function languageLabel(id: string): string {
  return LABELS.get(id) ?? id;
}
