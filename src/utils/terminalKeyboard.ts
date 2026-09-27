/** Shift+Enter를 일반 Enter(CR)와 구분해 원격 CLI에 전달한다. */
export function handleTerminalMultilineKey(
  event: KeyboardEvent,
  input: (data: string) => void,
): boolean {
  // 조합 확정 키는 xterm의 IME 처리에 맡긴다(WebKit의 keyCode 229 포함).
  if (event.isComposing || event.keyCode === 229
    || event.key !== 'Enter' || !event.shiftKey
    || event.altKey || event.ctrlKey || event.metaKey) return true;

  // CSI u: Enter(13), Shift(2). 전체 kitty 프로토콜 지원을 광고하지 않고
  // 이 키만 인코딩한다. 일반 Enter와 Alt/Option+Enter는 xterm이 처리한다.
  if (event.type === 'keydown') input('\x1b[13;2u');
  // keypress까지 흘러가면 CR이 추가로 전송될 수 있으므로 함께 소비한다.
  event.preventDefault();
  return false;
}
