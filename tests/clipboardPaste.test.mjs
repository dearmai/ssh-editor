import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test, mock } from 'node:test';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/utils/clipboardPaste.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function setup({ writable = true, approved = true, entries = [], items } = {}) {
  const events = [];
  const ipc = {
    readClipboardUploads: mock.fn(async () => items ?? [{ name: 'hello.txt', size: 5, localPath: '/tmp/hello.txt', textPreview: 'hello' }]),
    sftpCheckWriteAccess: mock.fn(async () => { events.push('check'); return writable; }),
    sftpListDir: mock.fn(async () => entries),
  };
  const confirm = mock.fn(async () => { events.push('confirm'); return approved; });
  const enqueueClipboardUploads = mock.fn(() => events.push('enqueue'));
  const toastError = mock.fn();
  const fileTree = { clipboard: null, pasteInto: mock.fn(async () => {}) };
  const deps = {
    'react/jsx-runtime': jsxRuntime,
    '../ipc/commands': ipc,
    '../stores/confirmStore': { confirm },
    '../stores/fileTreeStore': { useFileTreeStore: { getState: () => fileTree } },
    '../stores/transferStore': { useTransferStore: { getState: () => ({ enqueueClipboardUploads }) } },
    '../stores/toastStore': { toastError },
    '../stores/logStore': { log: { error() {} } },
    '../components/Dialogs/UploadPreview': { default() {} },
  };
  const exports = {};
  runInNewContext(code, { exports, File, TextDecoder, URL, Uint8Array, atob, crypto,
    require: (id) => { assert.ok(id in deps, id); return deps[id]; } });
  return { paste: exports.pasteClipboardInto, ipc, confirm, enqueueClipboardUploads, toastError, events, fileTree };
}

test('쓰기 권한 실패 시 Toast만 표시하고 확인창과 업로드를 실행하지 않는다', async () => {
  const ctx = setup({ writable: false });
  await ctx.paste('server', '/target');
  assert.equal(ctx.confirm.mock.callCount(), 0);
  assert.equal(ctx.enqueueClipboardUploads.mock.callCount(), 0);
  assert.match(ctx.toastError.mock.calls[0].arguments[0], /쓰기 권한/);
});

for (const method of ['sftpCheckWriteAccess', 'sftpListDir']) {
  test(`${method} 오류 시 업로드를 중단한다`, async () => {
    const ctx = setup();
    ctx.ipc[method].mock.mockImplementation(async () => { throw new Error('서버 연결 실패'); });
    await ctx.paste('server', '/target');
    assert.equal(ctx.confirm.mock.callCount(), 0);
    assert.equal(ctx.enqueueClipboardUploads.mock.callCount(), 0);
    assert.equal(ctx.toastError.mock.callCount(), 1);
  });
}

test('취소하면 미리보기만 표시하고 업로드하지 않는다', async () => {
  const ctx = setup({ approved: false });
  await ctx.paste('server', '/target');
  assert.equal(ctx.confirm.mock.calls[0].arguments[0].message.props.items[0].textPreview, 'hello');
  assert.equal(ctx.enqueueClipboardUploads.mock.callCount(), 0);
});

test('권한 검사 → 덮어쓰기 미리보기 확인 → 선택한 대상에 업로드 순서를 지킨다', async () => {
  const ctx = setup({ entries: [{ name: 'hello.txt', path: '/target/hello.txt', isDir: false }] });
  await ctx.paste('server', '/target');
  assert.deepEqual(ctx.events, ['check', 'check', 'confirm', 'enqueue']);
  const options = ctx.confirm.mock.calls[0].arguments[0];
  assert.equal(options.danger, true);
  assert.equal(options.message.props.collisions[0], 'hello.txt');
  assert.equal(options.message.props.remoteDir, '/target');
  assert.equal(ctx.enqueueClipboardUploads.mock.calls[0].arguments[0], 'server');
  assert.equal(ctx.enqueueClipboardUploads.mock.calls[0].arguments[1], '/target');
});

test('동명 폴더와 읽기 전용 파일은 덮어쓰지 않는다', async () => {
  for (const isDir of [true, false]) {
    const ctx = setup({ entries: [{ name: 'hello.txt', path: '/target/hello.txt', isDir }] });
    ctx.ipc.sftpCheckWriteAccess.mock.mockImplementation(async (_id, path) => path === '/target');
    await ctx.paste('server', '/target');
    assert.equal(ctx.confirm.mock.callCount(), 0);
    assert.equal(ctx.enqueueClipboardUploads.mock.callCount(), 0);
    assert.equal(ctx.toastError.mock.callCount(), 1);
  }
});

test('클립보드 이미지는 원본 PNG 바이트와 썸네일을 보존한다', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
  const ctx = setup({ items: [{ name: 'capture.png', size: bytes.length, dataBase64: Buffer.from(bytes).toString('base64'), thumbnail: 'data:image/png;base64,preview' }] });
  await ctx.paste('server', '/images');
  const item = ctx.enqueueClipboardUploads.mock.calls[0].arguments[2][0];
  assert.deepEqual(new Uint8Array(await item.source.file.arrayBuffer()), bytes);
  assert.equal(item.thumbnail, 'data:image/png;base64,preview');
});

test('붙여넣기 이벤트의 파일들은 순서와 이름을 유지해 한 번에 확인한다', async () => {
  const ctx = setup();
  await ctx.paste('server', '/target', [new File(['hello'], 'one.txt'), new File([new Uint8Array([0, 255])], 'two.bin')]);
  assert.equal(ctx.ipc.readClipboardUploads.mock.callCount(), 0);
  const items = ctx.confirm.mock.calls[0].arguments[0].message.props.items;
  assert.equal(items[0].textPreview, 'hello');
  assert.equal(items[1].textPreview, undefined);
  assert.equal(ctx.confirm.mock.callCount(), 1);
});

test('중복 이름이나 경로 문자가 포함된 파일은 업로드하지 않는다', async () => {
  for (const names of [['a.txt', 'a.txt'], ['../escape.txt']]) {
    const ctx = setup();
    await ctx.paste('server', '/target', names.map((name) => new File(['x'], name)));
    assert.equal(ctx.enqueueClipboardUploads.mock.callCount(), 0);
    assert.equal(ctx.toastError.mock.callCount(), 1);
  }
});

test('확인 대기 중 붙여넣기를 반복해도 중복 업로드하지 않는다', async () => {
  const ctx = setup();
  await Promise.all([ctx.paste('server', '/target'), ctx.paste('server', '/target')]);
  assert.equal(ctx.confirm.mock.callCount(), 1);
  assert.equal(ctx.enqueueClipboardUploads.mock.callCount(), 1);
});

test('로컬 파일이 없으면 기존 원격 파일 복사를 유지한다', async () => {
  const ctx = setup({ items: [] });
  ctx.fileTree.clipboard = { connectionId: 'server' };
  await ctx.paste('server', '/target');
  assert.equal(ctx.fileTree.pasteInto.mock.callCount(), 1);
  assert.equal(ctx.enqueueClipboardUploads.mock.callCount(), 0);
});
