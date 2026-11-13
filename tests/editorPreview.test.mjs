import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';
import { confirmUnsavedChanges } from '../src/utils/confirmUnsavedChanges.ts';

const source = ts.transpileModule(
  readFileSync(new URL('../src/stores/editorStore.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;

function setup(ipc = {}, choice = '취소') {
  const dependencies = {
    zustand: { create },
    '@tauri-apps/plugin-dialog': { message: async () => choice },
    '../utils/confirmUnsavedChanges': { confirmUnsavedChanges },
    './toastStore': { toastError() {} },
    './settingsStore': {
      openLimits: () => ({ normal: 1024 * 1024, large: 10 * 1024 * 1024 }),
      useSettingsStore: { getState: () => ({ ecoThresholdMB: 200 }) },
    },
    '../ipc/commands': {
      localProbe: async () => ({ size: 10, isBinary: false }),
      readTextFile: async (_, path) => ({ text: await dependencies['../ipc/commands'].sftpReadFile(_, path), encoding: 'utf-8' }),
      localReadSegment: async () => ({ text: '구간\n', start: 0, end: 7, lines: 1, size: 10, mtime: 1 }),
      localWriteSegment: async () => ({ end: 8, size: 11, mtime: 2 }),
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
  await store.getState().resolveOpen('view');
  assert.deepEqual(ids(), ['remote:/large']);
  assert.equal(store.getState().tabsById['remote:/large'].viewMode, true);
  await open('b');
  assert.deepEqual(ids(), ['local:/b']);
});

test('구간 편집을 열어도 원본 보기 탭을 유지하고 저장 시 재색인 버전을 올린다', async () => {
  const { store, open, ids } = setup({ localProbe: async () => ({ size: 20 * 1024 * 1024, isBinary: false }) });
  await open('large');
  await store.getState().resolveOpen('view');
  await store.getState().openSegment({ name: 'large', path: '/large' }, { anchor: 0, skip: 0, startLine: 0, count: 5 });
  assert.deepEqual(ids(), ['local:/large', 'local:/large#seg']);
  assert.equal(store.getState().tabsById['local:/large'].isPreview, false);
  assert.equal(store.getState().tabsById['local:/large#seg'].baseMtime, undefined);
  store.getState().updateContent('local:/large#seg', '수정\n');
  await store.getState().saveTab('local:/large#seg');
  assert.equal(store.getState().fileRevisions['/large'], 1);
  assert.equal(store.getState().tabsById['local:/large#seg'].isDirty, false);
});

for (const action of ['closeTab', 'closeOtherTabs', 'closeGroup']) {
  test(`${action}: 저장 실패 또는 취소 시 미저장 구간을 보존한다`, async () => {
    for (const choice of ['취소', '저장']) {
      const { store, open } = setup({ localWriteSegment: async () => { throw Error('외부 변경'); } }, choice);
      await open('keep');
      await store.getState().openSegment({ name: 'large', path: '/large' }, { anchor: 0, skip: 0, startLine: 0, count: 5 });
      store.getState().updateContent('local:/large#seg', '미저장');
      const group = store.getState().activeGroupId;
      await store.getState()[action](group, action === 'closeOtherTabs' ? 'local:/keep' : 'local:/large#seg');
      assert.equal(store.getState().tabsById['local:/large#seg'].content, '미저장');
      assert.equal(store.getState().tabsById['local:/large#seg'].isDirty, true);
    }
  });
}

test('인코딩 변환은 선택한 인코딩으로 저장하고 이후 일반 저장에도 유지한다', async () => {
  const writes = [];
  const { store, open } = setup({ sftpWriteFile: async (...args) => { writes.push(args); return { size: 10, mtime: 1 }; } });
  await open('a');
  await store.getState().changeEncoding('local:/a', 'cp949', 'save');
  assert.equal(store.getState().tabsById['local:/a'].encoding, 'cp949');
  store.getState().updateContent('local:/a', '수정');
  await store.getState().saveTab('local:/a');
  assert.deepEqual(writes.map((args) => args[3]), ['cp949', 'cp949']);
});

test('인코딩 변환 실패 시 기존 인코딩과 편집 내용을 보존한다', async () => {
  const { store, open } = setup({ sftpWriteFile: async () => { throw Error('표현할 수 없는 문자'); } });
  await open('a');
  store.getState().updateContent('local:/a', '😀');
  await assert.rejects(store.getState().changeEncoding('local:/a', 'cp949', 'save'));
  assert.equal(store.getState().tabsById['local:/a'].encoding, 'utf-8');
  assert.equal(store.getState().tabsById['local:/a'].content, '😀');
  assert.equal(store.getState().tabsById['local:/a'].isDirty, true);
});

test('읽기 인코딩 변경은 파일을 저장하지 않고 텍스트와 인코딩을 갱신한다', async () => {
  let writes = 0;
  const { store, open } = setup({
    readTextFile: async (_, __, encoding = 'utf-8') => ({ text: encoding === 'cp949' ? '한글' : 'content /a', encoding }),
    sftpWriteFile: async () => { writes++; return { size: 4, mtime: 1 }; },
  });
  await open('a');
  await store.getState().changeEncoding('local:/a', 'cp949', 'read');
  assert.equal(store.getState().tabsById['local:/a'].content, '한글');
  assert.equal(store.getState().tabsById['local:/a'].encoding, 'cp949');
  assert.equal(writes, 0);
});

test('미저장 변경의 재읽기를 취소하면 편집 내용이 유지된다', async () => {
  const { store, open } = setup();
  await open('a');
  store.getState().updateContent('local:/a', '미저장');
  await store.getState().changeEncoding('local:/a', 'cp949', 'read');
  assert.equal(store.getState().tabsById['local:/a'].content, '미저장');
  assert.equal(store.getState().tabsById['local:/a'].encoding, 'utf-8');
});
