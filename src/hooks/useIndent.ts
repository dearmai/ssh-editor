import { useConnectionStore } from '../stores/connectionStore';
import { useIndentStore } from '../stores/indentStore';
import { useSettingsStore } from '../stores/settingsStore';
import { fileIndentKey, indentKeyFor, DEFAULT_INDENT, type IndentRule } from '../utils/indent';

export interface ResolvedIndent {
  rule: IndentRule;
  /** 어디서 온 값인지 — 상태바 표시·초기화 버튼 노출 판단용 */
  source: 'file' | 'ext' | 'default';
  /** indentStore 저장 키 (파일별 오버라이드) */
  fileKey: string;
  /** 확장자 규칙 키 (예: 'ts') */
  extKey: string;
}

/**
 * 파일 하나의 최종 들여쓰기 규칙.
 * 우선순위: 파일별 오버라이드(localStorage) → 확장자 규칙(환경설정) → 전역 기본값.
 */
export function useIndent(connectionId?: string, remotePath?: string): ResolvedIndent {
  const indentDefault = useSettingsStore((s) => s.indentDefault);
  const indentByExt = useSettingsStore((s) => s.indentByExt);
  const byFile = useIndentStore((s) => s.byFile);
  // 세션 id는 재접속마다 바뀌므로 프로필 id로 파일을 식별한다
  const serverKey = useConnectionStore(
    (s) => s.activeConnections.find((c) => c.sessionId === connectionId)?.profile.id
  );

  const path = remotePath ?? '';
  const extKey = indentKeyFor(path);
  const fileKey = fileIndentKey(serverKey ?? connectionId ?? '', path);

  const fileRule = byFile[fileKey];
  if (fileRule) return { rule: fileRule, source: 'file', fileKey, extKey };

  const extRule = indentByExt[extKey];
  if (extRule) return { rule: extRule, source: 'ext', fileKey, extKey };

  return { rule: indentDefault ?? DEFAULT_INDENT, source: 'default', fileKey, extKey };
}
