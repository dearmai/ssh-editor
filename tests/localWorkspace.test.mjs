import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test, mock } from 'node:test';
import { create } from 'zustand';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../src/stores/localWorkspaceStore.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;
function setup() {
  const openFile = mock.fn(async () => {});
  const listDir = mock.fn(async () => []);
  const setting = mock.fn();
  const deps = {
    zustand: { create },
    '../ipc/commands': { localListDir: listDir },
    './editorStore': { useEditorStore: { getState: () => ({ openFile }) } },
    './settingsStore': { useSettingsStore: { getState: () => ({ set: setting }) } },
  };
  const exports = {};
  runInNewContext(source, { exports, require: (id) => deps[id] });
  return { store: exports.useLocalWorkspaceStore, openFile, listDir, setting };
}
for (const [path, parent, name] of [
  ['/home/user/프로젝트/hello world.ts', '/home/user/프로젝트', 'hello world.ts'],
  ['/test.txt', '/', 'test.txt'],
  ['C:\\work\\test.txt', 'C:/work', 'test.txt'],
  ['C:\\test.txt', 'C:/', 'test.txt'],
]) {
  test(`파일 연결은 상위 폴더와 파일을 함께 연다: ${path}`, async () => {
    const { store, openFile, setting } = setup();
    await store.getState().openFile(path);
    assert.equal(store.getState().root, parent);
    assert.equal(store.getState().selectedPath, path.replaceAll('\\', '/'));
    assert.equal(store.getState().active, true);
    assert.equal(openFile.mock.calls[0].arguments[0], 'local');
    assert.equal(openFile.mock.calls[0].arguments[1].name, name);
    assert.equal(setting.mock.calls[0].arguments[0], 'sidebarVisible');
    assert.equal(setting.mock.calls[0].arguments[1], true);
  });
}
test('파일 열기 실패 시 기존 작업 폴더를 유지한다', async () => {
  const { store, openFile } = setup();
  await store.getState().openDirectory('/existing');
  openFile.mock.mockImplementation(async () => { throw Error('읽기 실패'); });
  await assert.rejects(store.getState().openFile('/other/file.bin'));
  assert.equal(store.getState().root, '/existing');
  assert.equal(store.getState().selectedPath, null);
});
