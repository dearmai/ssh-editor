import { localCryptoBatch, localCryptoPlan, type CryptoMode } from '../ipc/commands';
import { useEditorStore } from '../stores/editorStore';
import { useLocalWorkspaceStore } from '../stores/localWorkspaceStore';
import { log } from '../stores/logStore';
import { promptText } from '../stores/promptStore';
import { useSettingsStore } from '../stores/settingsStore';
import { toastError } from '../stores/toastStore';

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** 대상 파일을 연 탭들 (그룹 id와 함께) */
function openTabsFor(paths: Set<string>) {
  const { groupsById, tabsById } = useEditorStore.getState();
  return Object.values(groupsById).flatMap((g) =>
    g.tabIds
      .filter((id) => tabsById[id]?.connectionId === 'local' && paths.has(tabsById[id].remotePath))
      .map((tabId) => ({ groupId: g.id, tabId, path: tabsById[tabId].remotePath, dirty: tabsById[tabId].isDirty })),
  );
}

/**
 * 로컬 파일·폴더 보관(암호화)/보관 해제(복호화) — 트리 컨텍스트 메뉴·탐색기 메뉴에서 호출.
 * mode 생략 시 자동 판단(대상이 모두 보관된 파일이면 해제, 아니면 보관).
 * 폴더는 하위 파일까지 펼치며, 루트·시스템 폴더·5개 이상은 백엔드에서 차단한다.
 */
export async function runLocalCrypto(paths: string[], requested?: CryptoMode) {
  let mode: CryptoMode;
  let files: string[];
  let skipped: number;
  try {
    ({ mode, files, skipped } = await localCryptoPlan(paths, requested));
  } catch (e) {
    toastError(`보관/해제 불가: ${String(e)}`);
    return;
  }
  const label = mode === 'encrypt' ? '보관' : '보관 해제';
  if (files.length === 0) {
    toastError(mode === 'encrypt' ? '보관할 파일이 없습니다 (이미 보관된 파일은 제외)' : '보관된 파일이 없습니다');
    return;
  }

  const dirty = openTabsFor(new Set(files)).filter((t) => t.dirty);
  if (dirty.length) {
    toastError(`저장하지 않은 변경 사항이 있습니다: ${baseName(dirty[0].path)} — 먼저 저장하세요`);
    return;
  }

  const target = files.length === 1 ? baseName(files[0]) : `파일 ${files.length}개`;
  const extension = useSettingsStore.getState().localCryptoExtension.trim();
  const dotExt = extension && (extension.startsWith('.') ? extension : `.${extension}`);
  const hint = [
    dotExt
      ? mode === 'encrypt'
        ? `파일명 뒤에 ${dotExt} 를 붙인 이름으로 원본을 대체합니다.`
        : `파일명이 ${dotExt} 로 끝나면 확장자를 제거한 이름으로 저장합니다.`
      : '원본 파일을 제자리에서 교체합니다.',
    skipped ? `${mode === 'encrypt' ? '이미 보관된' : '보관되지 않은'} 파일 ${skipped}개는 제외합니다.` : '',
  ].filter(Boolean).join(' ');

  const password = await promptText({ title: `${label} — ${target}`, placeholder: '비밀번호', password: true, hint, confirmLabel: label });
  if (!password) return;
  if (mode === 'encrypt') {
    const again = await promptText({
      title: `비밀번호 확인 — ${target}`,
      placeholder: '비밀번호 다시 입력',
      password: true,
      hint: '비밀번호를 잊으면 복구할 수 없습니다.',
      confirmLabel: label,
    });
    if (again === null) return;
    if (again !== password) {
      toastError('비밀번호가 일치하지 않습니다');
      return;
    }
  }

  let results;
  try {
    results = await localCryptoBatch(files, password, extension, mode);
  } catch (e) {
    toastError(`${label} 실패: ${String(e)}`);
    return;
  }
  const done = results.filter((r) => r.output);
  const failed = results.filter((r) => r.error);

  // 내용이 바뀐 파일의 탭은 닫는다
  const changed = new Set(done.map((r) => r.path));
  for (const t of openTabsFor(changed)) useEditorStore.getState().closeTab(t.groupId, t.tabId);
  useLocalWorkspaceStore.getState().refresh(done.length === 1 ? done[0].output ?? undefined : undefined);

  for (const r of done) log.info(`로컬 파일 ${label}: ${r.path}${r.output !== r.path ? ` → ${r.output}` : ''}`);
  for (const r of failed) log.error(`로컬 파일 ${label} 실패: ${r.path} — ${r.error}`);
  if (failed.length) {
    toastError(
      failed.length === 1
        ? `${label} 실패: ${baseName(failed[0].path)} — ${failed[0].error}`
        : `${label} 실패 ${failed.length}개 / 성공 ${done.length}개 (자세한 내용은 로그 참고)`,
    );
  }
}
