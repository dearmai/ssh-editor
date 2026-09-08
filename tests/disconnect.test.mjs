import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test, mock } from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';
import { confirmUnsavedChanges } from '../src/utils/confirmUnsavedChanges.ts';

// 실제 연결 스토어를 실행하되 네이티브 IPC와 주변 UI 스토어만 대체한다.
const source = ts.transpileModule(
  readFileSync(new URL('../src/stores/connectionStore.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;

function setup(choice = '취소', remaining = 0) {
  const editor = {
    tabsById: {
      a: { connectionId: 'server-a', isDirty: true },
      b: { connectionId: 'server-b', isDirty: true },
    },
    saveDirtyTabs: mock.fn(async (id) => {
      if (remaining === 0) {
        for (const tab of Object.values(editor.tabsById)) {
          if (tab.connectionId === id) tab.isDirty = false;
        }
      }
      return remaining;
    }),
    closeConnectionTabs: mock.fn((id) => {
      for (const [key, tab] of Object.entries(editor.tabsById)) {
        if (tab.connectionId === id) delete editor.tabsById[key];
      }
    }),
  };
  const message = mock.fn(async () => choice);
  const sshDisconnect = mock.fn(async () => {});
  const closeConnectionSessions = mock.fn(async () => {});
  const clearConnection = mock.fn();
  const dependencies = {
    zustand: { create },
    '@tauri-apps/plugin-dialog': { message },
    '../utils/confirmUnsavedChanges': { confirmUnsavedChanges },
    '../ipc/commands': { sshDisconnect },
    './editorStore': { useEditorStore: { getState: () => editor } },
    './terminalStore': { useTerminalStore: { getState: () => ({ closeConnectionSessions }) } },
    './fileTreeStore': { useFileTreeStore: { getState: () => ({ clearConnection }) } },
    './logStore': { log: { info() {}, warn() {}, error() {} } },
  };
  const exports = {};
  runInNewContext(source, {
    exports,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  const store = exports.useConnectionStore;
  store.setState({
    activeConnections: ['server-a', 'server-b'].map((sessionId) => ({
      sessionId, profile: { name: sessionId, hostname: sessionId },
    })),
    selectedSessionId: 'server-a',
  });
  return { store, editor, message, sshDisconnect, closeConnectionSessions, clearConnection };
}

function assertKept({ store, editor, sshDisconnect, closeConnectionSessions, clearConnection }) {
  assert.equal(store.getState().activeConnections.length, 2);
  assert.equal(store.getState().selectedSessionId, 'server-a');
  assert.equal(editor.closeConnectionTabs.mock.callCount(), 0);
  assert.equal(sshDisconnect.mock.callCount(), 0);
  assert.equal(closeConnectionSessions.mock.callCount(), 0);
  assert.equal(clearConnection.mock.callCount(), 0);
}

test('취소하면 연결, 파일, 터미널, 탐색기를 유지하며 저장하지 않는다', async () => {
  const ctx = setup();
  assert.equal(await ctx.store.getState().disconnect('server-a'), false);
  assertKept(ctx);
  assert.equal(ctx.editor.saveDirtyTabs.mock.callCount(), 0);
});

test('저장은 선택한 서버에만 적용하고 다른 서버의 미저장 파일은 유지한다', async () => {
  const ctx = setup('저장');
  assert.equal(await ctx.store.getState().disconnect('server-a'), true);
  assert.match(ctx.message.mock.calls[0].arguments[0], /파일 1개/);
  assert.equal(ctx.editor.saveDirtyTabs.mock.calls[0].arguments[0], 'server-a');
  assert.equal(ctx.sshDisconnect.mock.calls[0].arguments[0], 'server-a');
  assert.equal(ctx.editor.tabsById.b.isDirty, true);
  assert.equal(ctx.editor.tabsById.a, undefined);
  assert.equal(ctx.store.getState().activeConnections[0].sessionId, 'server-b');
});

test('저장 안 함은 해당 서버만 저장 없이 해제한다', async () => {
  const ctx = setup('저장 안 함');
  assert.equal(await ctx.store.getState().disconnect('server-a'), true);
  assert.equal(ctx.editor.saveDirtyTabs.mock.callCount(), 0);
  assert.equal(ctx.editor.tabsById.b.isDirty, true);
});

test('저장 실패나 충돌이 남으면 연결과 모든 UI 상태를 유지한다', async () => {
  const ctx = setup('저장', 1);
  assert.equal(await ctx.store.getState().disconnect('server-a'), false);
  assertKept(ctx);
});

test('다른 서버에만 미저장 파일이 있으면 확인 없이 선택한 서버를 해제한다', async () => {
  const ctx = setup();
  ctx.editor.tabsById.a.isDirty = false;
  assert.equal(await ctx.store.getState().disconnect('server-a'), true);
  assert.equal(ctx.message.mock.callCount(), 0);
  assert.equal(ctx.editor.tabsById.b.isDirty, true);
});

test('연결 해제를 연속 요청해도 확인창과 해제 처리는 한 번만 실행한다', async () => {
  const ctx = setup('저장 안 함');
  const first = ctx.store.getState().disconnect('server-a');
  assert.equal(await ctx.store.getState().disconnect('server-a'), false);
  assert.equal(await first, true);
  assert.equal(ctx.message.mock.callCount(), 1);
  assert.equal(ctx.sshDisconnect.mock.callCount(), 1);
});

test('재접속 실패 후 세션 종료에서도 취소하면 파일과 복구 상태를 유지한다', async () => {
  const ctx = setup();
  ctx.store.setState({ reconnect: { sessionId: 'server-a', profileName: 'A', phase: 'failed' } });
  await ctx.store.getState().resolveReconnect('close');
  assertKept(ctx);
  assert.equal(ctx.store.getState().reconnect.sessionId, 'server-a');
});
