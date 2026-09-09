import assert from 'node:assert/strict';
import { test } from 'node:test';
import xterm from '@xterm/xterm';
import { TerminalViewport } from '../src/utils/terminalViewport.ts';

const write = (term, data) => new Promise((resolve) => term.write(data, resolve));
const lines = (count, start = 0) => Array.from({ length: count }, (_, i) => `line-${i + start}\r\n`).join('');

function setup(t, options = {}) {
  const term = new xterm.Terminal({ cols: 80, rows: 10, scrollback: 100, ...options });
  // DOM 없이 실행하므로 Viewport의 스크롤 요청만 코어에 전달한다.
  // 출력 파싱, 버퍼, 마커와 줄 재배치는 실제 xterm을 사용한다.
  term._core.viewport = {
    scrollLines: (amount) => term._core.scrollLines(amount, false, 1),
    syncScrollArea() {},
  };
  const viewport = new TerminalViewport(term);
  t.after(() => { viewport.dispose(); term.dispose(); });
  return { term, viewport };
}

test('맨 아래에서 떠난 터미널은 새 출력 이후에도 맨 아래로 복원한다', async (t) => {
  const { term, viewport } = setup(t);
  await write(term, lines(50));
  viewport.capture();
  await write(term, lines(20, 50));
  term.scrollToTop();
  viewport.restore();
  assert.equal(term.buffer.active.viewportY, term.buffer.active.baseY);
  assert.ok(term.buffer.active.viewportY > 0);
});

test('지난 출력을 읽던 위치는 새 출력이 추가되어도 유지한다', async (t) => {
  const { term, viewport } = setup(t);
  await write(term, lines(50));
  term.scrollToLine(12);
  viewport.capture();
  await write(term, lines(10, 50));
  term.scrollToTop();
  viewport.restore();
  assert.equal(term.buffer.active.viewportY, 12);
});

test('스크롤백 앞부분이 삭제되어도 같은 내용의 줄로 복원한다', async (t) => {
  const { term, viewport } = setup(t, { scrollback: 30 });
  await write(term, lines(35));
  term.scrollToLine(15);
  const content = term.buffer.active.getLine(15).translateToString(true);
  viewport.capture();
  await write(term, lines(10, 35));
  term.scrollToTop();
  viewport.restore();
  assert.equal(term.buffer.active.getLine(term.buffer.active.viewportY).translateToString(true), content);
  assert.ok(term.buffer.active.viewportY < 15);
});

test('저장했던 줄까지 삭제되면 남은 스크롤백의 첫 줄을 보여준다', async (t) => {
  const { term, viewport } = setup(t, { scrollback: 20 });
  await write(term, lines(30));
  term.scrollToLine(2);
  viewport.capture();
  await write(term, lines(40, 30));
  term.scrollToBottom();
  viewport.restore();
  assert.equal(term.buffer.active.viewportY, 0);
});

test('화면 크기가 바뀌어 줄이 재배치되어도 읽던 내용을 보존한다', async (t) => {
  const { term, viewport } = setup(t);
  await write(term, Array.from({ length: 30 }, (_, i) => `${String(i).padStart(2, '0')}-${'x'.repeat(50)}\r\n`).join(''));
  term.scrollToLine(10);
  viewport.capture();
  term.resize(40, 10);
  term.scrollToTop();
  viewport.restore();
  assert.match(term.buffer.active.getLine(term.buffer.active.viewportY).translateToString(true), /^10-/);
});

test('전체 화면 앱의 별도 버퍼와 일반 셸의 스크롤 위치를 섞지 않는다', async (t) => {
  const { term, viewport } = setup(t);
  await write(term, lines(50));
  term.scrollToLine(12);
  viewport.capture();
  await write(term, '\x1b[?1049hTUI');
  viewport.capture();
  viewport.restore();
  assert.equal(term.buffer.active.type, 'alternate');
  assert.equal(term.buffer.active.viewportY, 0);
  await write(term, '\x1b[?1049l');
  term.scrollToTop();
  viewport.restore();
  assert.equal(term.buffer.active.viewportY, 12);
});

test('각 터미널은 자신의 스크롤 위치를 따로 기억한다', async (t) => {
  const a = setup(t);
  const b = setup(t);
  await write(a.term, lines(40));
  await write(b.term, lines(60));
  a.term.scrollToLine(8);
  a.viewport.capture();
  b.viewport.capture();
  a.term.scrollToTop();
  b.term.scrollToTop();
  a.viewport.restore();
  b.viewport.restore();
  assert.equal(a.term.buffer.active.viewportY, 8);
  assert.equal(b.term.buffer.active.viewportY, b.term.buffer.active.baseY);
});
