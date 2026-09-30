import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../src/stores/editorStore.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;

function setup(ipc = {}) {
  const dependencies = {
    zustand: { create },
    '../ipc/commands': {
      sftpProbe: async () => ({ size: 10, isBinary: false }),
      sftpReadFile: async (_, path) => `content ${path}`,
      sftpStat: async () => ({ mtime: 1, size: 10 }),
      sftpWriteFile: async () => ({ mtime: 2, size: 20 }),
      ...ipc,
    },
    '../utils/languageDetect': { detectLanguage: () => 'plaintext' },
    './logStore': { log: { info() {}, warn() {}, error() {} } },
    './fileTreeStore': {},
    './transferStore': {},
  };
  const exports = {};
  runInNewContext(source, { exports, require: (id) => dependencies[id] });
  const store = exports.useEditorStore;
  const open = (name, connection = 'local') => store.getState().openFile(connection, {
    name, path: `/${name}`, size: 10, isDir: false,
  });
  const ids = (group = store.getState().activeGroupId) => Array.from(store.getState().groupsById[group].tabIds);
  return { store, open, ids };
}

for (const connection of ['local', 'remote']) {
  test(`${connection}: 미편집 탭은 교체하고 콘텐츠를 정리한다`, async () => {
    const { store, open, ids } = setup();
    await open('a', connection);
    await open('b', connection);
    assert.deepEqual(ids(), [`${connection}:/b`]);
    assert.deepEqual(Object.keys(store.getState().tabsById), ids());
    assert.equal(store.getState().tabsById[`${connection}:/b`].isPreview, true);
  });
}

test('편집 후 저장하거나 내용을 되돌려도 탭은 유지한다', async () => {
  const { store, open, ids } = setup();
  await open('a');
  store.getState().updateContent('local:/a', 'edited');
  store.getState().updateContent('local:/a', 'content /a');
  await store.getState().saveTab('local:/a');
  await open('b');
  await open('c');
  assert.deepEqual(ids(), ['local:/a', 'local:/c']);
  assert.equal(store.getState().tabsById['local:/a'].isDirty, false);
});

test('내용이 같은 이벤트는 임시 탭을 유지 상태로 바꾸지 않는다', async () => {
  const { store, open, ids } = setup();
  await open('a');
  store.getState().updateContent('local:/a', 'content /a');
  await open('b');
  assert.deepEqual(ids(), ['local:/b']);
});

test('명시적으로 유지한 탭과 기존 탭 재선택은 임시 탭 교체를 방해하지 않는다', async () => {
  const { store, open, ids } = setup();
  await open('a');
  store.getState().keepTab('local:/a');
  await open('b');
  await open('a');
  await open('c');
  assert.deepEqual(ids(), ['local:/a', 'local:/c']);
});

test('새 파일 읽기 실패 시 기존 임시 탭을 보존한다', async () => {
  const { store, open, ids } = setup({ sftpReadFile: async (_, path) => {
    if (path === '/b') throw Error('read failed');
    return 'a';
  } });
  await open('a');
  await assert.rejects(open('b'));
  assert.deepEqual(ids(), ['local:/a']);
  assert.equal(store.getState().tabsById['local:/a'].content, 'a');
});

test('분할한 탭을 유지하고 그룹별로 임시 탭을 교체한다', async () => {
  const { store, open, ids } = setup();
  await open('a');
  store.getState().splitActive('horizontal');
  const second = store.getState().activeGroupId;
  await open('b');
  store.getState().setActiveGroup('g1');
  await open('c');
  await open('d');
  assert.deepEqual(ids('g1'), ['local:/a', 'local:/d']);
  assert.deepEqual(ids(second), ['local:/a', 'local:/b']);
});

test('대용량 보기 탭도 임시 탭으로 교체한다', async () => {
  const { store, open, ids } = setup({ sftpProbe: async () => ({ size: 2 * 1024 * 1024, isBinary: false }) });
  await open('a');
  await open('large', 'remote');
  await store.getState().resolveOpen('open');
  assert.deepEqual(ids(), ['remote:/large']);
  assert.equal(store.getState().tabsById['remote:/large'].viewMode, true);
  await open('b');
  assert.deepEqual(ids(), ['local:/b']);
});
