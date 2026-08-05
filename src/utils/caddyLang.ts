/** Caddyfile 문법 하이라이트 — Monaco 내장 언어가 없어 커스텀 Monarch 토크나이저 등록 */

interface MonacoLike {
  languages: {
    getLanguages: () => { id: string }[];
    register: (l: {
      id: string;
      extensions?: string[];
      filenames?: string[];
      aliases?: string[];
    }) => void;
    setMonarchTokensProvider: (id: string, def: unknown) => void;
    setLanguageConfiguration: (id: string, cfg: unknown) => void;
  };
}

// 자주 쓰는 Caddy 디렉티브·매처 키워드 (위치 무관하게 keyword로 강조)
const CADDY_KEYWORDS = [
  // HTTP 디렉티브
  'abort', 'acme_server', 'basic_auth', 'basicauth', 'bind', 'encode', 'error',
  'file_server', 'forward_auth', 'handle', 'handle_errors', 'handle_path',
  'header', 'header_down', 'header_up', 'import', 'invoke', 'log', 'map',
  'method', 'metrics', 'php_fastcgi', 'push', 'redir', 'request_body',
  'request_header', 'respond', 'reverse_proxy', 'rewrite', 'root', 'route',
  'templates', 'tls', 'tracing', 'try_files', 'uri', 'vars',
  // reverse_proxy / 하위 옵션
  'to', 'lb_policy', 'lb_try_duration', 'lb_try_interval', 'health_uri',
  'health_port', 'health_interval', 'health_timeout', 'health_status',
  'fail_duration', 'max_fails', 'unhealthy_status', 'unhealthy_latency',
  'transport', 'dial_timeout', 'response_header_timeout', 'read_timeout',
  'write_timeout', 'flush_interval', 'buffer_requests', 'buffer_responses',
  'trusted_proxies', 'upstream', 'dynamic',
  // 전역 옵션
  'admin', 'auto_https', 'email', 'acme_ca', 'acme_dns', 'on_demand_tls',
  'storage', 'default_sni', 'grace_period', 'servers', 'debug', 'order',
  'key_type', 'preferred_chains', 'renew_interval', 'ocsp_interval',
  // 매처 이름
  'not', 'path', 'path_regexp', 'host', 'header_regexp', 'query',
  'expression', 'remote_ip', 'client_ip', 'protocol', 'file', 'vars_regexp',
];

let registered = false;

export function registerCaddyLanguage(monaco: MonacoLike) {
  if (registered) return;
  if (monaco.languages.getLanguages().some((l) => l.id === 'caddyfile')) {
    registered = true;
    return;
  }

  monaco.languages.register({
    id: 'caddyfile',
    extensions: ['.caddy', '.caddyfile'],
    filenames: ['Caddyfile'],
    aliases: ['Caddyfile', 'caddy'],
  });

  monaco.languages.setLanguageConfiguration('caddyfile', {
    comments: { lineComment: '#' },
    brackets: [['{', '}']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: '`', close: '`' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('caddyfile', {
    defaultToken: '',
    tokenPostfix: '.caddy',
    keywords: CADDY_KEYWORDS,
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        // 플레이스홀더 {env.X} {$ENV} {http.request.host} 및 스니펫 (name)
        [/\{[$]?[\w.$-]*\}/, 'variable'],
        [/\{/, 'delimiter.bracket'],
        [/\}/, 'delimiter.bracket'],
        // 네임드 매처 @name
        [/@[\w-]+/, 'type'],
        // 스키마 포함 주소 http:// https://
        [/https?:\/\/[^\s{]+/, 'string.link'],
        // 문자열
        [/"/, { token: 'string.quote', next: '@dquote' }],
        [/`/, { token: 'string.quote', next: '@backtick' }],
        // 경로 매처 /path
        [/(^|\s)\/[^\s{]*/, 'regexp'],
        // 숫자 + 단위 (10s, 512kb 등)
        [/\b\d+(\.\d+)?[a-z]*\b/, 'number'],
        // 식별자 — 디렉티브면 keyword
        [/[a-zA-Z_][\w.-]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      ],
      dquote: [
        [/[^"]+/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      backtick: [
        [/[^`]+/, 'string'],
        [/`/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  });

  registered = true;
}
