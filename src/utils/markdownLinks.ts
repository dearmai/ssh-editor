interface LinkClick {
  button: number;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/** 웹뷰 URL이 아니라 Markdown 파일의 디렉토리를 기준으로 파일 경로를 구한다. */
export function resolveMarkdownFilePath(currentPath: string, href: string): string {
  const base = currentPath.replace(/\\/g, '/');
  const relative = decodeURIComponent(href.split(/[?#]/, 1)[0]);
  if (/[\x00-\x1f\x7f]/.test(relative)) throw new Error('잘못된 파일 경로입니다.');
  if (!relative) return base;
  const drive = base.match(/^[A-Za-z]:/)?.[0] ?? '';
  const path = relative.startsWith('/') ? `${drive}${relative}` : `${base.slice(0, base.lastIndexOf('/') + 1)}${relative}`;
  const parts: string[] = [];
  for (const part of path.slice(drive.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${drive}/${parts.join('/')}`;
}

/** Markdown 링크로 앱 웹뷰가 이동하지 않도록 기본 이동부터 차단한다. */
export function createMarkdownLinkOpener(
  openUrl: (url: string) => Promise<void>,
  onError: (error: unknown) => void,
) {
  return async (
    event: LinkClick,
    href: string,
    scrollToAnchor: (id: string) => void,
    file?: { path: string; open: (path: string) => Promise<void> },
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 && event.button !== 1) return;
    try {
      const value = href.trim();
      if (!value || value.startsWith('#')) {
        scrollToAnchor(decodeURIComponent(value.slice(1)));
        return;
      }
      if (!/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('//')) {
        if (!file) throw new Error('원본 Markdown 파일의 경로가 없습니다.');
        await file.open(resolveMarkdownFilePath(file.path, value));
        return;
      }
      // //example.com 형식도 앱의 tauri: 프로토콜 대신 HTTPS로 연다.
      const url = new URL(value.startsWith('//') ? `https:${value}` : value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('웹 링크(http/https)만 외부 브라우저로 열 수 있습니다.');
      }
      await openUrl(url.href);
    } catch (error) {
      onError(error);
    }
  };
}
