import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTerminalImeFallback } from '../src/utils/terminalIme.ts';
import { installWebkitInputFix } from '../src/utils/terminalWebkitInput.ts';

// Terminal/index.tsx처럼 두 보완을 함께 설치한다.
// 실제 DOM에서는 container capture(IME 보완)가 textarea capture(WebKit 입력 보완)보다 먼저 실행되므로
// 같은 EventTarget에 IME 보완을 먼저 등록해 순서를 맞춘다.
function setup(t) {
  const target = new EventTarget();
  target.value = '';
  target.selectionStart = 0;
  const output = [];
  const send = (data) => output.push(data);
  const ime = createTerminalImeFallback(target, target, send, () => {});
  const disposeFix = installWebkitInputFix(target, {
    textarea: target,
    input: send,
    onKey: () => ({ dispose() {} }),
  });
  t.after(() => { disposeFix(); ime.dispose(); });
  const dispatch = (type, props = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { isComposing: false, ...props });
    target.dispatchEvent(event);
    return event;
  };
  const key = (key = 'Unidentified', keyCode = 229) => {
    const props = { key, keyCode, ctrlKey: false, altKey: false, metaKey: false };
    dispatch('keydown', props);
    ime.handleKey({ type: 'keydown', isComposing: false, ...props });
  };
  // 네이티브 편집: beforeinput이 취소되지 않았을 때만 textarea가 바뀌고 input이 발생한다.
  // replace: WebKit 한글 IME처럼 마지막 글자를 교체한다.
  const type = (data, replace = false) => {
    const inputType = replace ? 'insertReplacementText' : 'insertText';
    const base = replace ? Array.from(target.value).slice(0, -1).join('') : target.value;
    target.selectionStart = base.length;
    if (dispatch('beforeinput', { data, inputType }).defaultPrevented) return;
    const value = base + data;
    target.value = value;
    target.selectionStart = value.length;
    dispatch('input', { data, inputType });
  };
  return { target, output, ime, key, type };
}

test('미확정 한글 뒤 공백/숫자는 한글을 먼저 확정한 뒤 전송한다', (t) => {
  const s = setup(t);
  s.key(); s.type('ㅎ');
  s.key(); s.type('하', true);
  s.key(); s.type('한', true);
  assert.deepEqual(s.output, []);
  s.key(' ', 229); s.type(' ');
  s.key('1', 229); s.type('1');
  assert.equal(s.output.join(''), '한 1');
});

test('한글·영문을 섞어도 순서를 유지한다', (t) => {
  const s = setup(t);
  s.key('a', 65); s.type('a');
  s.key(); s.type('ㄱ');
  s.key(); s.type('가', true);
  s.key('b', 229); s.type('b');
  s.key(); s.type('ㄴ');
  s.key(); s.type('나', true);
  s.key('Enter', 13);
  assert.equal(s.output.join(''), 'a가b나');
});
