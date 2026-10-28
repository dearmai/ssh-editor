import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test, mock } from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/stores/terminalStore.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function setup(approved = true) {
  const ipc = { terminalClose: mock.fn(async () => {}), terminalCreate: mock.fn(async () => 'new'), terminalWrite: mock.fn(async () => {}) };
  const confirm = mock.fn(async () => approved);
  const toastError = mock.fn();
  const deps = {
    zustand: { create }, '../ipc/commands': ipc,
    './logStore': { log: { info() {}, error() {} } },
    './fileTreeStore': { useFileTreeStore: { getState: () => ({ rootPaths: new Map() }) } },
    './confirmStore': { confirm }, './toastStore': { toastError },
  };
  const exports = {};
  runInNewContext(source, { exports, TextEncoder, btoa, require: (id) => { assert.ok(id in deps, id); return deps[id]; } });
  const store = exports.useTerminalStore;
  store.setState({
    sessions: ['a', 'b'].map((id) => ({ id, connectionId: 'server', title: id })),
    groups: [{ id: 'g', root: { type: 'split', direction: 'horizontal', sizes: [0.5, 0.5], children: [{ type: 'leaf', id: 'a' }, { type: 'leaf', id: 'b' }] } }],
    activeGroupId: 'g', activeSessionId: 'a', isBottomPanelOpen: true,
  });
  return { store, ipc, confirm, toastError };
}

test('터미널 닫기 취소는 세션과 분할을 유지한다', async () => {
  const ctx = setup(false);
  await ctx.store.getState().requestCloseSession('a');
  assert.equal(ctx.confirm.mock.callCount(), 1);
  assert.equal(ctx.ipc.terminalClose.mock.callCount(), 0);
  assert.equal(ctx.store.getState().sessions.length, 2);
});

test('확인 후 지정한 터미널만 닫고 남은 분할에 포커스를 맞춘다', async () => {
  const ctx = setup();
  await ctx.store.getState().requestCloseSession('a');
  assert.equal(ctx.ipc.terminalClose.mock.calls[0].arguments[0], 'a');
  const state = ctx.store.getState();
  assert.equal(state.sessions.length, 1);
  assert.equal(state.activeSessionId, 'b');
  assert.equal(state.groups[0].root.id, 'b');
});

test('원격 exit는 확인이나 닫기 IPC 없이 해당 탭을 제거한다', () => {
  const ctx = setup();
  ctx.store.getState().handleSessionExit('a');
  assert.equal(ctx.confirm.mock.callCount(), 0);
  assert.equal(ctx.ipc.terminalClose.mock.callCount(), 0);
  assert.equal(ctx.store.getState().sessions.length, 1);
  ctx.store.getState().handleSessionExit('b');
  assert.equal(ctx.store.getState().groups.length, 0);
  assert.equal(ctx.store.getState().activeSessionId, null);
  assert.equal(ctx.store.getState().isBottomPanelOpen, false);
});

test('확인 대기 중 exit와 반복 닫기가 와도 중복 종료하지 않는다', async () => {
  const ctx = setup();
  let finish;
  ctx.confirm.mock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const first = ctx.store.getState().requestCloseSession('a');
  await ctx.store.getState().requestCloseSession('a');
  assert.equal(ctx.confirm.mock.callCount(), 1);
  ctx.store.getState().handleSessionExit('a');
  finish(true);
  await first;
  assert.equal(ctx.ipc.terminalClose.mock.callCount(), 0);
  assert.equal(ctx.store.getState().sessions.length, 1);
});

test('백엔드 닫기 실패는 탭을 남기고 오류를 표시한다', async () => {
  const ctx = setup();
  ctx.ipc.terminalClose.mock.mockImplementation(async () => { throw new Error('ipc failed'); });
  await ctx.store.getState().requestCloseSession('a');
  assert.equal(ctx.store.getState().sessions.length, 2);
  assert.equal(ctx.toastError.mock.callCount(), 1);
});

test('생성 응답보다 먼저 종료된 원격 셸은 죽은 탭으로 추가하지 않는다', async () => {
  const ctx = setup();
  ctx.ipc.terminalCreate.mock.mockImplementation(async () => {
    ctx.store.getState().handleSessionExit('new');
    return 'new';
  });
  await assert.rejects(ctx.store.getState().createSession('server'), /종료/);
  assert.equal(ctx.store.getState().sessions.length, 2);
});

test('다른 창의 종료 이벤트는 현재 창의 터미널에 영향을 주지 않는다', () => {
  const ctx = setup();
  ctx.store.getState().handleSessionExit('other-window');
  assert.equal(ctx.store.getState().sessions.length, 2);
  assert.equal(ctx.store.getState().activeSessionId, 'a');
});
