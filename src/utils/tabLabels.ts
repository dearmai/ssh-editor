import type { EditorTab } from '../types';

export interface TabLabel {
  /** 표시할 파일명 */
  fileName: string;
  /** 같은 파일명이 여럿일 때 구분용 상위 경로 (최소 길이). 유일하면 undefined */
  hint?: string;
}

/** 경로를 세그먼트 배열로 (앞뒤 빈 요소 제거) */
function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * 열린 탭들의 표시 라벨을 계산한다.
 * 파일명이 같은 탭들끼리는 서로 달라질 때까지 상위 경로를 최소한으로 포함시킨다.
 * 예) /opt/tomcat1/bin/setenv.sh, /opt/tomcat2/bin/setenv.sh
 *     → hint "tomcat1/bin", "tomcat2/bin"
 */
export function computeTabLabels(
  tabs: Pick<EditorTab, 'id' | 'remotePath' | 'fileName'>[]
): Record<string, TabLabel> {
  const result: Record<string, TabLabel> = {};

  // 파일명으로 그룹화
  const groups = new Map<string, typeof tabs>();
  for (const t of tabs) {
    const arr = groups.get(t.fileName);
    if (arr) arr.push(t);
    else groups.set(t.fileName, [t]);
  }

  for (const [fileName, group] of groups) {
    if (group.length === 1) {
      result[group[0].id] = { fileName };
      continue;
    }

    // 같은 파일명이 둘 이상 → 상위 경로로 구분
    const parentsById = new Map(
      group.map((t) => [t.id, segments(t.remotePath).slice(0, -1)] as const)
    );

    for (const t of group) {
      const parents = parentsById.get(t.id)!;
      let hint = parents.length ? parents.join('/') : undefined;
      for (let depth = 1; depth <= parents.length; depth++) {
        const suffix = parents.slice(parents.length - depth).join('/');
        const collides = group.some((o) => {
          if (o.id === t.id) return false;
          const op = parentsById.get(o.id)!;
          return op.slice(op.length - depth).join('/') === suffix;
        });
        if (!collides) {
          hint = suffix;
          break;
        }
      }
      result[t.id] = { fileName, hint: hint || undefined };
    }
  }

  return result;
}
