/** WebKit의 한글 IME는 composition 이벤트 없이 textarea의 마지막 글자를 교체한다. */
export function needsTerminalImeFallback(platform: string, userAgent: string): boolean {
  return /Mac/.test(platform) && /AppleWebKit/.test(userAgent)
    && !/Chrome|Chromium|Edg|OPR/.test(userAgent);
}

const hangulTail = /[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff]$/u;

/** 미확정 마지막 한 글자는 로컬에 보관하고 확정된 앞부분만 PTY에 전달한다. */
export function createTerminalImeFallback(
  container: HTMLElement,
  textarea: HTMLTextAreaElement,
  input: (data: string) => void,
  preview: (text: string) => void,
) {
  let composing = false;
  let nativeEnding = false;
  let receivedInput = false;
  let active = false;
  let offset = 0;
  let sent = '';
  let pending = '';

  const flush = () => {
    if (!active) return;
    if (pending) input(pending);
    active = false;
    sent = pending = '';
    textarea.value = '';
    preview('');
  };

  const isHangulInput = (e: InputEvent) =>
    (e.inputType === 'insertText' || e.inputType === 'insertReplacementText')
    && !!e.data && hangulTail.test(e.data);

  const onBeforeInput = (event: Event) => {
    const e = event as InputEvent;
    if (e.target !== textarea || composing || nativeEnding || e.isComposing) return;
    if ((!active && isHangulInput(e)) || (active && !receivedInput)) {
      active = true;
      receivedInput = false;
      // 길이가 아니라 실제 교체/삽입 위치를 사용한다. 첫 입력이 선택 영역을
      // 교체할 수 있으며, WebKit에서는 229 keydown보다 먼저 올 수도 있다.
      offset = textarea.selectionStart ?? textarea.value.length;
    }
  };

  const onInput = (event: Event) => {
    const e = event as InputEvent;
    if (e.target !== textarea || composing || e.isComposing) return;
    // 표준 IME의 compositionend 직후 확정 input은 계속 xterm이 처리한다.
    if (nativeEnding) {
      nativeEnding = false;
      return;
    }
    if (!active) {
      if (!isHangulInput(e)) return;
      active = true;
      // beforeinput이 없는 경우에도 첫 input을 시작점으로 삼는다.
      offset = Math.max(0, (textarea.selectionStart ?? textarea.value.length) - e.data!.length);
    }
    receivedInput = true;
    // xterm의 input 처리와 keyCode 229 타이머가 같은 글자를 다시 보내지 않게 한다.
    e.stopImmediatePropagation();
    const value = textarea.value.slice(offset);
    const characters = Array.from(value);
    // 교체가 delete + insert로 나뉘면 잠시 value === sent가 된다.
    // 이때 이미 확정한 끝 글자를 다시 조합 글자로 취급해 DEL을 보내면 안 된다.
    const hasUncommittedTail = !sent.startsWith(value);
    pending = hasUncommittedTail && hangulTail.test(value) ? characters.pop()! : '';
    const committed = characters.join('');
    // IME의 삭제/교체가 이미 확정된 부분까지 영향을 준 경우도 처리한다.
    const previous = Array.from(sent);
    let common = 0;
    while (common < previous.length && previous[common] === characters[common]) common++;
    const data = '\x7f'.repeat(previous.length - common) + characters.slice(common).join('');
    sent = committed;
    if (data) input(data);
    preview(pending);
  };
  const onStart = () => { flush(); composing = true; nativeEnding = false; };
  const onEnd = () => { composing = false; nativeEnding = true; };
  container.addEventListener('beforeinput', onBeforeInput, true);
  container.addEventListener('input', onInput, true);
  container.addEventListener('compositionstart', onStart, true);
  container.addEventListener('compositionend', onEnd, true);
  container.addEventListener('blur', flush, true);
  container.addEventListener('paste', flush, true);

  return {
    flush,
    handleKey(event: KeyboardEvent): boolean {
      if (composing || event.isComposing) return true;
      if (event.type === 'keydown') {
        nativeEnding = false;
        if (event.keyCode === 229) {
          if (!active) {
            active = true;
            receivedInput = false;
            offset = textarea.selectionStart ?? textarea.value.length;
          }
          // preventDefault는 호출하지 않는다. 네이티브 IME는 textarea를 계속 편집해야 한다.
          return false;
        }
        if (!['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) flush();
      }
      // IME가 keypress도 발생시키는 경우 중복 전송을 막는다.
      return !(active && event.type === 'keypress');
    },
    dispose() {
      container.removeEventListener('beforeinput', onBeforeInput, true);
      container.removeEventListener('input', onInput, true);
      container.removeEventListener('compositionstart', onStart, true);
      container.removeEventListener('compositionend', onEnd, true);
      container.removeEventListener('blur', flush, true);
      container.removeEventListener('paste', flush, true);
      preview('');
    },
  };
}
