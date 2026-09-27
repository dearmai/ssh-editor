import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test, mock } from 'node:test';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/utils/terminalClipboard.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup({ items, approved = true } = {}) {
  const events = [];
  let alive = true;
  const image = { name: 'capture.png', size: 3, thumbnail: 'data:image/png;base64,AQID',
    source: { kind: 'file', file: new File([new Uint8Array([1, 2, 3])], 'capture.png', { type: 'image/png' }) } };
  const readItems = mock.fn(async () => items ?? [image]);
  const releasePreviews = mock.fn();
  const confirm = mock.fn(async () => { events.push('preview'); return approved; });
  const ipc = {
    terminalPrepareUpload: mock.fn(async () => { events.push('prepare'); return '/tmp/ssh-editor-test'; }),
    sftpUpload: mock.fn(async () => events.push('upload')),
    sftpUploadDataChunk: mock.fn(async () => events.push('chunk')),
    sftpDeletePath: mock.fn(async () => events.push('delete')),
  };
  const target = { connectionId: 'original-server', isAlive: () => alive,
    paste: mock.fn(() => events.push('paste')), setUploading: mock.fn() };
  const toastError = mock.fn();
  const deps = {
    'react/jsx-runtime': jsxRuntime,
    './clipboardPaste': { readItems, releasePreviews },
    './clipboard': { readClipboard: async () => 'plain text\nsecond line' },
    '../ipc/commands': ipc,
    '../stores/confirmStore': { confirm },
    '../stores/toastStore': { toastError },
    '../stores/logStore': { log: { error() {}, warn() {} } },
    '../components/Dialogs/UploadPreview': { default() {} },
  };
  const exports = {};
  runInNewContext(code, { exports, Uint8Array, btoa, crypto,
    require: (id) => { assert.ok(id in deps, id); return deps[id]; } });
  return { paste: exports.createTerminalClipboard(target), ipc, target, confirm, image,
    readItems, releasePreviews, toastError, events, close: () => { alive = false; } };
}

test('이미지 미리보기 → 승인 → 업로드 완료 → 원래 터미널에 경로 입력 순서를 지킨다', async () => {
  const ctx = setup();
  await ctx.paste();
  assert.deepEqual(ctx.events, ['preview', 'prepare', 'chunk', 'paste']);
  const preview = ctx.confirm.mock.calls[0].arguments[0];
  assert.equal(preview.wide, true);
  assert.equal(preview.message.props.children[0].props.items[0], ctx.image);
  const args = ctx.ipc.sftpUploadDataChunk.mock.calls[0].arguments;
  assert.equal(args[0], 'original-server');
  assert.equal(args[2], 'AQID');
  assert.deepEqual(Array.from(args).slice(4), [0, 3, true]);
  assert.equal(ctx.target.paste.mock.calls[0].arguments[0], '/tmp/ssh-editor-test/image-1.png ');
  assert.equal(ctx.ipc.sftpDeletePath.mock.callCount(), 0);
  assert.equal(ctx.releasePreviews.mock.callCount(), 1);
});

test('미리보기 취소 시 원격 파일 생성과 터미널 입력을 하지 않는다', async () => {
  const ctx = setup({ approved: false });
  await ctx.paste();
  assert.deepEqual(ctx.events, ['preview']);
  assert.equal(ctx.releasePreviews.mock.callCount(), 1);
});

test('텍스트 붙여넣기는 이미지 미리보기 없이 그대로 전달한다', async () => {
  const ctx = setup({ items: [] });
  await ctx.paste();
  assert.deepEqual(ctx.events, ['paste']);
  assert.equal(ctx.target.paste.mock.calls[0].arguments[0], 'plain text\nsecond line');
});

test('업로드 실패 시 부분 파일과 디렉토리를 정리하고 경로를 입력하지 않는다', async () => {
  const ctx = setup();
  ctx.ipc.sftpUploadDataChunk.mock.mockImplementation(async () => { throw new Error('offline'); });
  await ctx.paste();
  assert.equal(ctx.target.paste.mock.callCount(), 0);
  assert.equal(ctx.toastError.mock.callCount(), 1);
  assert.deepEqual(ctx.ipc.sftpDeletePath.mock.calls.map((c) => c.arguments[1]), [
    '/tmp/ssh-editor-test/image-1.png', '/tmp/ssh-editor-test',
  ]);
});

test('미리보기 중 닫힌 터미널에는 업로드하지 않는다', async () => {
  const ctx = setup();
  ctx.confirm.mock.mockImplementation(async () => { ctx.close(); return true; });
  await ctx.paste();
  assert.equal(ctx.ipc.terminalPrepareUpload.mock.callCount(), 0);
  assert.equal(ctx.target.paste.mock.callCount(), 0);
});

test('업로드 중 닫힌 터미널의 이미지는 정리하고 경로를 입력하지 않는다', async () => {
  const ctx = setup();
  ctx.ipc.sftpUploadDataChunk.mock.mockImplementation(async () => ctx.close());
  await ctx.paste();
  assert.equal(ctx.target.paste.mock.callCount(), 0);
  assert.equal(ctx.ipc.sftpDeletePath.mock.callCount(), 2);
});

test('미리보기 중 반복 붙여넣기를 무시한다', async () => {
  const ctx = setup();
  let finish;
  ctx.confirm.mock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = ctx.paste();
  await Promise.resolve();
  await ctx.paste();
  assert.equal(ctx.readItems.mock.callCount(), 1);
  finish(false);
  await first;
  assert.equal(ctx.target.paste.mock.callCount(), 0);
});

test('여러 로컬 이미지의 원본 이름은 입력하지 않고 안전한 경로만 전달한다', async () => {
  const ctx = setup({ items: [
    { name: 'a\n$(evil).PNG', source: { kind: 'local', path: '/local/a.PNG' } },
    { name: 'b.jpg', source: { kind: 'local', path: '/local/b.jpg' } },
  ] });
  await ctx.paste();
  assert.equal(ctx.ipc.sftpUpload.mock.callCount(), 2);
  assert.equal(ctx.target.paste.mock.calls[0].arguments[0], '/tmp/ssh-editor-test/image-1.png /tmp/ssh-editor-test/image-2.jpg ');
});

test('이미지가 아닌 파일은 원격 업로드 없이 오류를 표시한다', async () => {
  const ctx = setup({ items: [{ name: 'script.sh' }] });
  await ctx.paste();
  assert.equal(ctx.confirm.mock.callCount(), 0);
  assert.equal(ctx.ipc.terminalPrepareUpload.mock.callCount(), 0);
  assert.equal(ctx.target.paste.mock.callCount(), 0);
  assert.equal(ctx.toastError.mock.callCount(), 1);
});

test('큰 이미지를 여러 청크로 보내고 마지막 청크 완료 이후에만 입력한다', async () => {
  const size = 256 * 1024 + 17;
  const file = new File([new Uint8Array(size)], 'large.png');
  const ctx = setup({ items: [{ name: file.name, size, source: { kind: 'file', file } }] });
  await ctx.paste();
  const calls = ctx.ipc.sftpUploadDataChunk.mock.calls;
  assert.equal(calls.length, 2);
  assert.deepEqual(Array.from(calls[0].arguments).slice(4), [0, size, false]);
  assert.deepEqual(Array.from(calls[1].arguments).slice(4), [256 * 1024, size, true]);
  assert.deepEqual(ctx.events, ['preview', 'prepare', 'chunk', 'chunk', 'paste']);
});
