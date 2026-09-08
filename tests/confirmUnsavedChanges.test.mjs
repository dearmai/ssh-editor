import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { confirmUnsavedChanges } from '../src/utils/confirmUnsavedChanges.ts';

function setup(choice = '취소') {
  let dirty = 2;
  const options = {
    title: '앱 종료',
    countDirty: () => dirty,
    saveDirtyTabs: mock.fn(async () => { dirty = 0; return 0; }),
    message: mock.fn(async () => choice),
  };
  return { options, setDirty: (count) => { dirty = count; } };
}

test('변경사항이 없으면 확인이나 저장 없이 종료한다', async () => {
  const { options, setDirty } = setup();
  setDirty(0);
  assert.equal(await confirmUnsavedChanges(options), true);
  assert.equal(options.message.mock.callCount(), 0);
  assert.equal(options.saveDirtyTabs.mock.callCount(), 0);
});

for (const choice of ['취소', 'Cancel', '']) {
  test(`${JSON.stringify(choice)} 응답은 저장하거나 종료하지 않는다`, async () => {
    const { options } = setup(choice);
    assert.equal(await confirmUnsavedChanges(options), false);
    assert.equal(options.saveDirtyTabs.mock.callCount(), 0);
  });
}

test('저장 안 함을 선택하면 파일을 쓰지 않고 종료한다', async () => {
  const { options } = setup('저장 안 함');
  assert.equal(await confirmUnsavedChanges(options), true);
  assert.equal(options.saveDirtyTabs.mock.callCount(), 0);
});

test('저장 선택을 기다린 다음 모든 파일의 저장이 완료돼야 종료한다', async () => {
  const { options, setDirty } = setup();
  let choose;
  let finishSave;
  let settled = false;
  options.message = mock.fn(() => new Promise((resolve) => { choose = resolve; }));
  options.saveDirtyTabs = mock.fn(() => new Promise((resolve) => { finishSave = resolve; }));
  const result = confirmUnsavedChanges(options).then((value) => { settled = true; return value; });
  assert.equal(options.saveDirtyTabs.mock.callCount(), 0);
  choose('저장');
  await Promise.resolve();
  assert.equal(options.saveDirtyTabs.mock.callCount(), 1);
  assert.equal(settled, false);
  setDirty(0);
  finishSave(0);
  assert.equal(await result, true);
});

test('저장 실패나 외부 변경 충돌로 미저장 파일이 남으면 종료를 중단한다', async () => {
  const { options } = setup('저장');
  options.saveDirtyTabs = mock.fn(async () => 1);
  assert.equal(await confirmUnsavedChanges(options), false);
  assert.equal(options.message.mock.callCount(), 2);
  assert.equal(options.message.mock.calls[1].arguments[1].kind, 'error');
});

test('저장 처리 후 새로운 미저장 변경이 생겨도 종료를 중단한다', async () => {
  const { options } = setup('저장');
  options.saveDirtyTabs = mock.fn(async () => 0);
  assert.equal(await confirmUnsavedChanges(options), false);
});

test('저장 중 예외는 호출자에게 전달하여 종료 승인을 막는다', async () => {
  const { options } = setup('저장');
  options.saveDirtyTabs = mock.fn(async () => { throw new Error('연결 끊김'); });
  await assert.rejects(confirmUnsavedChanges(options), /연결 끊김/);
});
