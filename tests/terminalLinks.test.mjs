import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createTerminalLinkOpener } from '../src/utils/terminalLinks.ts';

function setup(isMac) {
  const open = mock.fn(async () => {});
  const error = mock.fn();
  const click = createTerminalLinkOpener(isMac, open, error);
  const event = (changes = {}) => ({ button: 0, metaKey: false, ctrlKey: false, preventDefault: mock.fn(), ...changes });
  return { open, error, click, event };
}

test('macOS에서는 Cmd+클릭으로 URL을 기본 브라우저에 전달한다', async () => {
  const ctx = setup(true);
  const url = 'https://example.com/path?first=1&second=2#section';
  await ctx.click(ctx.event({ metaKey: true }), url);
  assert.equal(ctx.open.mock.calls[0].arguments[0], url);
});

test('Windows/Linux에서는 Ctrl+클릭으로 연다', async () => {
  const ctx = setup(false);
  await ctx.click(ctx.event({ ctrlKey: true }), 'http://localhost:3000/');
  assert.equal(ctx.open.mock.calls[0].arguments[0], 'http://localhost:3000/');
});

test('보조 키 없는 클릭과 다른 플랫폼 보조 키로는 열지 않는다', async () => {
  for (const isMac of [true, false]) {
    const ctx = setup(isMac);
    const plain = ctx.event();
    await ctx.click(plain, 'https://example.com');
    await ctx.click(ctx.event(isMac ? { ctrlKey: true } : { metaKey: true }), 'https://example.com');
    assert.equal(ctx.open.mock.callCount(), 0);
    assert.equal(plain.preventDefault.mock.callCount(), 0);
  }
});

test('우클릭이나 가운데 클릭으로는 열지 않는다', async () => {
  const ctx = setup(true);
  for (const button of [1, 2]) await ctx.click(ctx.event({ button, metaKey: true }), 'https://example.com');
  assert.equal(ctx.open.mock.callCount(), 0);
});

test('터미널 출력에 포함된 비웹 프로토콜을 실행하지 않는다', async () => {
  const ctx = setup(true);
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'ssh://server']) {
    await ctx.click(ctx.event({ metaKey: true }), url);
  }
  assert.equal(ctx.open.mock.callCount(), 0);
});

test('잘못된 URL과 시스템 브라우저 실행 실패를 오류 처리한다', async () => {
  const ctx = setup(true);
  await ctx.click(ctx.event({ metaKey: true }), 'invalid-url');
  ctx.open.mock.mockImplementation(async () => { throw new Error('브라우저 실행 실패'); });
  await ctx.click(ctx.event({ metaKey: true }), 'https://example.com');
  assert.equal(ctx.error.mock.callCount(), 2);
});
