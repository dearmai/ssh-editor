export interface TextStats { characters: number; bytes: number; words: number }

/** 글자는 유니코드 코드 포인트, 단어는 공백으로 나눈 덩어리로 센다. */
export function textStats(text: string): TextStats {
  let characters = 0;
  let bytes = 0;
  for (const ch of text) {
    characters++;
    const cp = ch.codePointAt(0)!;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  let words = 0;
  const pattern = /\S+/gu;
  while (pattern.exec(text)) words++;
  return { characters, bytes, words };
}

export function addStats(a: TextStats, b: TextStats, sign = 1): TextStats {
  return { characters: a.characters + sign * b.characters, bytes: a.bytes + sign * b.bytes, words: a.words + sign * b.words };
}

/** 선택 → 현재 행 → 파일 순으로 공간에 맞는 항목만 유지한다. */
export function fitStatsItems(available: number, widths: number[], hasSelection: boolean): number {
  let used = 0;
  let shown = 0;
  for (const width of widths) {
    used += width;
    if (used > available) break;
    shown++;
  }
  return Math.max(hasSelection ? 1 : 0, shown);
}

/** 바뀐 줄만 다시 세어 큰 편집 파일을 커서 이동마다 순회하지 않는다. */
export class TextStatsIndex {
  lines: TextStats[] = [];
  sum: TextStats = { characters: 0, bytes: 0, words: 0 };
  constructor(lines: string[]) { this.replace(0, 0, lines); }
  replace(start: number, count: number, lines: string[]) {
    for (const item of this.lines.slice(start, start + count)) this.sum = addStats(this.sum, item, -1);
    const next = lines.map(textStats);
    // 긴 범위도 함수 인자 수 제한 없이 교체한다.
    this.lines = this.lines.slice(0, start).concat(next, this.lines.slice(start + count));
    for (const item of next) this.sum = addStats(this.sum, item);
  }
  total(eol: string): TextStats {
    const breaks = Math.max(0, this.lines.length - 1);
    return { ...this.sum, characters: this.sum.characters + breaks * eol.length, bytes: this.sum.bytes + breaks * eol.length };
  }
}
