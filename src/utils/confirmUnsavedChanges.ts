interface CloseGuardOptions {
  title: string;
  countDirty: () => number;
  saveDirtyTabs: () => Promise<number>;
  message: (
    text: string,
    options: {
      title: string;
      kind: 'warning' | 'error';
      buttons: { yes: string; no: string; cancel: string } | { ok: string };
    }
  ) => Promise<string>;
}

/** 저장 여부를 먼저 확인하고, 저장을 선택했다면 모든 변경사항이 저장돼야 닫는다. */
export async function confirmUnsavedChanges({
  title, countDirty, saveDirtyTabs, message,
}: CloseGuardOptions): Promise<boolean> {
  const count = countDirty();
  if (count === 0) return true;

  const choice = await message(
    `저장하지 않은 파일 ${count}개가 있습니다. 변경사항을 저장할까요?`,
    {
      title,
      kind: 'warning',
      buttons: { yes: '저장', no: '저장 안 함', cancel: '취소' },
    }
  );
  if (choice === '저장 안 함') return true;
  if (choice !== '저장') return false;

  const remaining = await saveDirtyTabs();
  if (remaining === 0 && countDirty() === 0) return true;

  await message('저장하지 못한 변경사항이 있어 작업을 중단했습니다. 파일의 저장 상태와 충돌을 확인해 주세요.', {
    title,
    kind: 'error',
    buttons: { ok: '확인' },
  });
  return false;
}
