import type { Terminal } from '@xterm/xterm';

export function needsWebkitInputFix(platform: string, userAgent: string): boolean {
  return /Mac/.test(platform) && /AppleWebKit\//.test(userAgent)
    && !/(Chrome|Chromium|Edg|OPR)\//.test(userAgent);
}

/**
 * xterm 5.5의 WebKit 입력 누락 보완.
 * keyCode 229의 textarea 차이 추정 대신 취소 가능한 beforeinput의 확정 ASCII를 쓴다.
 * 네이티브 편집을 막으므로 xterm의 지연된 textarea 비교에서도 중복 전송되지 않는다.
 * 조합/붙여넣기/단축키/취소 불가능한 이벤트는 기존 입력 경로에 맡긴다.
 */
export function installWebkitInputFix(
  container: HTMLElement,
  term: Pick<Terminal, 'textarea' | 'input' | 'onKey'>,
): () => void {
  const textarea = term.textarea;
  if (!textarea) return () => {};
  let composing = false;
  let settling = false;
  let modified = false;
  let deadKey = false;
  let forwarded: string | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    forwarded = null;
    modified = event.ctrlKey || event.altKey || event.metaKey;
    if (event.key === 'Dead' || event.key === 'AltGraph') deadKey = true;
  };
  const onKey = term.onKey(({ key }) => { forwarded = key; });
  const onCompositionStart = () => {
    clearTimeout(settleTimer);
    composing = true;
    settling = false;
  };
  const onCompositionEnd = () => {
    composing = false;
    settling = true;
    // xterm이 같은 이벤트 묶음의 최종 조합 문자열을 전송할 때까지 기다린다.
    settleTimer = setTimeout(() => { settling = false; deadKey = false; }, 0);
  };
  const onBeforeInput = (event: InputEvent) => {
    const sent = forwarded;
    forwarded = null;
    if (event.defaultPrevented || !event.cancelable || event.isComposing || composing || settling
      || modified || deadKey || event.inputType !== 'insertText'
      || !event.data || !/^[\x20-\x7e]+$/.test(event.data)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    // keydown/keypress에서 이미 전달한 문자는 중복 전송하지 않는다.
    if (sent !== event.data) term.input(event.data);
  };
  const onInput = () => { if (!composing) deadKey = false; };
  const onBlur = () => {
    clearTimeout(settleTimer);
    composing = settling = modified = deadKey = false;
    forwarded = null;
  };

  container.addEventListener('keydown', onKeyDown, { capture: true });
  textarea.addEventListener('compositionstart', onCompositionStart, { capture: true });
  textarea.addEventListener('compositionend', onCompositionEnd, { capture: true });
  textarea.addEventListener('beforeinput', onBeforeInput, { capture: true });
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('blur', onBlur);
  return () => {
    clearTimeout(settleTimer);
    onKey.dispose();
    container.removeEventListener('keydown', onKeyDown, { capture: true });
    textarea.removeEventListener('compositionstart', onCompositionStart, { capture: true });
    textarea.removeEventListener('compositionend', onCompositionEnd, { capture: true });
    textarea.removeEventListener('beforeinput', onBeforeInput, { capture: true });
    textarea.removeEventListener('input', onInput);
    textarea.removeEventListener('blur', onBlur);
  };
}
