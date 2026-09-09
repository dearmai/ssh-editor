interface LinkClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  preventDefault: () => void;
}

/** 단순 클릭은 유지하고 OS별 보조 키를 누른 왼쪽 클릭만 기본 브라우저로 전달한다. */
export function createTerminalLinkOpener(
  isMac: boolean,
  openUrl: (url: string) => Promise<void>,
  onError: (error: unknown) => void,
) {
  return async (event: LinkClick, uri: string): Promise<void> => {
    if (event.button !== 0 || !(isMac ? event.metaKey : event.ctrlKey)) return;
    event.preventDefault();
    try {
      const url = new URL(uri);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      await openUrl(url.href);
    } catch (error) {
      onError(error);
    }
  };
}
