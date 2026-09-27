import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import xterm from '@xterm/xterm';
import { handleTerminalMultilineKey } from '../src/utils/terminalKeyboard.ts';

const event = (changes = {}) => ({
  type: 'keydown', key: 'Enter', keyCode: 13,
  shiftKey: true, altKey: false, ctrlKey: false, metaKey: false,
  isComposing: false, preventDefault: mock.fn(), ...changes,
});

test('Shift+Enter는 SSH 전송에 쓰이는 onData에 구분된 키를 한 번만 전달한다', (t) => {
  const term = new xterm.Terminal();
  t.after(() => term.dispose());
  const received = [];
  term.onData((data) => received.push(data));
  for (const type of ['keydown', 'keypress', 'keyup']) {
    const e = event({ type });
    assert.equal(handleTerminalMultilineKey(e, (data) => term.input(data)), false);
    assert.equal(e.preventDefault.mock.callCount(), 1);
  }
  assert.deepEqual(received, ['\x1b[13;2u']);
});

test('일반 Enter, 다른 보조 키, 복사/붙여넣기는 기존 키 처리로 넘긴다', () => {
  for (const changes of [
    { shiftKey: false }, { altKey: true }, { ctrlKey: true }, { metaKey: true },
    { key: 'c', ctrlKey: true }, { key: 'v', metaKey: true }, { key: 'a' },
  ]) {
    const e = event(changes);
    const input = mock.fn();
    assert.equal(handleTerminalMultilineKey(e, input), true);
    assert.equal(input.mock.callCount(), 0);
    assert.equal(e.preventDefault.mock.callCount(), 0);
  }
});

test('한글 등 IME 조합 확정 중에는 줄바꿈을 따로 보내지 않는다', () => {
  for (const changes of [{ isComposing: true }, { keyCode: 229 }]) {
    const e = event(changes);
    const input = mock.fn();
    assert.equal(handleTerminalMultilineKey(e, input), true);
    assert.equal(input.mock.callCount(), 0);
    assert.equal(e.preventDefault.mock.callCount(), 0);
  }
});
