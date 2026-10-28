import assert from 'node:assert/strict';
import { test } from 'node:test';
import xterm from '@xterm/xterm';
import { installWebkitInputFix, needsWebkitInputFix } from '../src/utils/terminalWebkitInput.ts';

function setup(t) {
  const term = new xterm.Terminal();
  const container = new EventTarget();
  const textarea = new EventTarget();
  const received = [];
  term.onData((data) => received.push(data));
  let onKey;
  const dispose = installWebkitInputFix(container, {
    textarea,
    input: (data) => term.input(data),
    onKey: (listener) => { onKey = listener; return { dispose() { onKey = undefined; } }; },
  });
  t.after(() => { dispose(); term.dispose(); });
  const dispatch = (target, type, props = {}) => {
    const { cancelable = true, ...rest } = props;
    const event = new Event(type, { cancelable });
    Object.assign(event, rest);
    target.dispatchEvent(event);
    return event;
  };
  return {
    received, term, dispose,
    key: (key, props = {}) => dispatch(container, 'keydown', { key, keyCode: 229, ctrlKey: false, altKey: false, metaKey: false, ...props }),
    input: (data, props = {}) => dispatch(textarea, 'beforeinput', { data, inputType: 'insertText', isComposing: false, ...props }),
    emit: (type) => dispatch(textarea, type),
    forwarded: (key) => { term.input(key); onKey?.({ key }); },
  };
}

test('macOS WebKit에서만 보완을 활성화한다', () => {
  assert.equal(needsWebkitInputFix('MacIntel', 'Mozilla/5.0 AppleWebKit/605.1.15'), true);
  assert.equal(needsWebkitInputFix('MacIntel', 'AppleWebKit/537.36 Chrome/140.0 Safari/537.36'), false);
  assert.equal(needsWebkitInputFix('Linux x86_64', 'AppleWebKit/605.1.15'), false);
});

test('keyup 없는 연속 123123과 Shift 기호를 정확히 한 번 전달한다', (t) => {
  const ctx = setup(t);
  for (const char of '123123"#') {
    ctx.key(char);
    assert.equal(ctx.input(char).defaultPrevented, true);
  }
  assert.equal(ctx.received.join(''), '123123"#');
});

test('xterm이 이미 전송한 keypress 입력은 중복되지 않는다', (t) => {
  const ctx = setup(t);
  ctx.key('1');
  ctx.forwarded('1');
  assert.equal(ctx.input('1').defaultPrevented, true);
  ctx.key('2');
  ctx.input('2');
  assert.equal(ctx.received.join(''), '12');
});

test('xterm의 stale 키 상태가 input 이벤트를 버리는 경우를 보완한다', (t) => {
  const ctx = setup(t);
  ctx.term._core._keyDownSeen = true;
  ctx.term._core._keyPressHandled = true;
  ctx.term._core._inputEvent({ data: '2', inputType: 'insertText', composed: true });
  assert.equal(ctx.received.length, 0);
  ctx.key('2');
  ctx.input('2');
  assert.equal(ctx.received.join(''), '2');
});

test('한글 조합 중 숫자와 조합 직후 입력은 기존 처리에 맡긴다', async (t) => {
  const ctx = setup(t);
  ctx.emit('compositionstart');
  ctx.key('1');
  assert.equal(ctx.input('1').defaultPrevented, false);
  ctx.emit('compositionend');
  assert.equal(ctx.input('1').defaultPrevented, false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ctx.input('가', { isComposing: true }).defaultPrevented, false);
  ctx.key('2');
  assert.equal(ctx.input('2').defaultPrevented, true);
  assert.equal(ctx.received.join(''), '2');
});

test('붙여넣기, 비ASCII 문자, 단축키, dead key는 가로채지 않는다', (t) => {
  const ctx = setup(t);
  for (const [data, props] of [['123', { inputType: 'insertFromPaste' }], ['한글', {}], ['é', {}]]) {
    assert.equal(ctx.input(data, props).defaultPrevented, false);
  }
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    ctx.key('c', { [modifier]: true });
    assert.equal(ctx.input('c').defaultPrevented, false);
  }
  ctx.key('Dead');
  ctx.key('e');
  assert.equal(ctx.input('e').defaultPrevented, false);
  assert.equal(ctx.received.length, 0);
});

test('터미널 dispose 이후에는 보완 리스너가 입력하지 않는다', (t) => {
  const ctx = setup(t);
  ctx.dispose();
  ctx.key('1');
  assert.equal(ctx.input('1').defaultPrevented, false);
  assert.equal(ctx.received.length, 0);
});

test('기본 입력을 취소할 수 없으면 중복 전송 위험 없이 기존 처리를 유지한다', (t) => {
  const ctx = setup(t);
  ctx.key('1');
  ctx.input('1', { cancelable: false });
  assert.equal(ctx.received.length, 0);
});
