import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createMarkdownLinkOpener, resolveMarkdownFilePath } from '../src/utils/markdownLinks.ts';

function setup() {
  const open = mock.fn(async () => {});
  const error = mock.fn();
  const scroll = mock.fn();
  return { open, error, scroll, click: createMarkdownLinkOpener(open, error) };
}
const event = (changes = {}) => ({ button: 0, preventDefault: mock.fn(), stopPropagation: mock.fn(), ...changes });

test('일반/Cmd/Ctrl/가운데 클릭 모두 앱 이동을 차단하고 외부 브라우저로 연다', async () => {
  for (const changes of [{}, { metaKey: true }, { ctrlKey: true }, { button: 1 }]) {
    const ctx = setup();
    const e = event(changes);
    ctx.open.mock.mockImplementation(async () => {
      assert.equal(e.preventDefault.mock.callCount(), 1);
      assert.equal(e.stopPropagation.mock.callCount(), 1);
    });
    await ctx.click(e, 'https://example.com/docs?q=1#section', ctx.scroll);
    assert.equal(ctx.open.mock.calls[0].arguments[0], 'https://example.com/docs?q=1#section');
    assert.equal(ctx.error.mock.callCount(), 0);
  }
});

test('문서 내부 앵커는 URL을 변경하지 않고 미리보기에서만 이동한다', async () => {
  const ctx = setup();
  await ctx.click(event(), '#%ED%95%9C%EA%B8%80', ctx.scroll);
  assert.equal(ctx.scroll.mock.calls[0].arguments[0], '한글');
  await ctx.click(event(), '#', ctx.scroll);
  assert.equal(ctx.scroll.mock.calls[1].arguments[0], '');
  assert.equal(ctx.open.mock.callCount(), 0);
});

test('프로토콜 생략 웹 주소는 HTTPS로 연다', async () => {
  const ctx = setup();
  await ctx.click(event(), '//example.com/path', ctx.scroll);
  assert.equal(ctx.open.mock.calls[0].arguments[0], 'https://example.com/path');
});

test('slack-manifest.json 상대 링크를 원본 문서 기준으로 에디터에 연다', async () => {
  const ctx = setup();
  const open = mock.fn(async () => {});
  const e = event();
  await ctx.click(e, '../slack-manifest.json', ctx.scroll, { path: '/app/openclaw/docs/setup.md', open });
  assert.equal(open.mock.calls[0].arguments[0], '/app/openclaw/slack-manifest.json');
  assert.equal(e.preventDefault.mock.callCount(), 1);
  assert.equal(ctx.open.mock.callCount(), 0);
  assert.equal(ctx.error.mock.callCount(), 0);
});

test('파일 링크의 상위 경로, 인코딩, fragment와 Windows 드라이브를 처리한다', () => {
  for (const [base, href, expected] of [
    ['/project/docs/a.md', './nested/../../file.json', '/project/file.json'],
    ['/project/docs/a.md', '../hello%20world.json#part', '/project/hello world.json'],
    ['/project/docs/a.md', '/config/file.json', '/config/file.json'],
    ['/a.md', '../../file.json', '/file.json'],
    ['C:\\project\\docs\\a.md', '../file.json', 'C:/project/file.json'],
  ]) assert.equal(resolveMarkdownFilePath(base, href), expected);
});

test('파일 열기 실패도 웹뷰 이동 없이 오류로 표시한다', async () => {
  const ctx = setup();
  const e = event();
  await ctx.click(e, '../missing.json', ctx.scroll, {
    path: '/docs/readme.md', open: async () => { throw new Error('파일 없음'); },
  });
  assert.equal(e.preventDefault.mock.callCount(), 1);
  assert.equal(ctx.error.mock.callCount(), 1);
  assert.equal(ctx.open.mock.callCount(), 0);
});

test('상대 경로/파일/스크립트 링크도 웹뷰를 이동시키지 않는다', async () => {
  const ctx = setup();
  for (const href of ['./other.md', '/README.md', 'file:///tmp/test', 'javascript:alert(1)', 'data:text/html,test', 'tauri://localhost']) {
    const e = event();
    await ctx.click(e, href, ctx.scroll);
    assert.equal(e.preventDefault.mock.callCount(), 1);
  }
  assert.equal(ctx.open.mock.callCount(), 0);
  assert.equal(ctx.error.mock.callCount(), 6);
});

test('브라우저 실행 실패와 잘못된 앵커도 오류만 처리하고 앱 이동은 막는다', async () => {
  const ctx = setup();
  ctx.open.mock.mockImplementation(async () => { throw new Error('opener failed'); });
  for (const href of ['https://example.com', '#%invalid']) {
    const e = event();
    await ctx.click(e, href, ctx.scroll);
    assert.equal(e.preventDefault.mock.callCount(), 1);
  }
  assert.equal(ctx.error.mock.callCount(), 2);
});
