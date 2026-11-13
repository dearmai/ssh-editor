import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textStats, TextStatsIndex, fitStatsItems } from '../src/utils/textStats.ts';

test('한글·이모지·줄바꿈을 글자·UTF-8 바이트·공백 기준 단어로 센다', () => {
  const text = '한글 😀\r\nhello\tworld';
  assert.deepEqual(textStats(text), { characters: [...text].length, bytes: new TextEncoder().encode(text).length, words: 4 });
  assert.deepEqual(textStats('  \r\n\t'), { characters: 5, bytes: 5, words: 0 });
  assert.deepEqual(textStats(''), { characters: 0, bytes: 0, words: 0 });
});

test('줄 삽입·삭제·여러 줄 변경 후 통계가 전체 재계산과 같다', () => {
  const index = new TextStatsIndex(['한글 테스트', 'hello world', '😀']);
  index.replace(0, 2, ['바뀐 줄', '새 줄', 'english']);
  assert.deepEqual(index.total('\r\n'), textStats('바뀐 줄\r\n새 줄\r\nenglish\r\n😀'));
  index.replace(1, 3, ['끝']);
  assert.deepEqual(index.total('\n'), textStats('바뀐 줄\n끝'));
  index.replace(0, 2, ['']);
  assert.deepEqual(index.total('\n'), textStats(''));
});

test('상태바 폭이 줄면 파일·현재 행을 생략하고 선택 통계를 유지한다', () => {
  assert.equal(fitStatsItems(600, [180, 200, 220], true), 3);
  assert.equal(fitStatsItems(400, [180, 200, 220], true), 2);
  assert.equal(fitStatsItems(200, [180, 200, 220], true), 1);
  assert.equal(fitStatsItems(100, [180, 200, 220], true), 1);
  assert.equal(fitStatsItems(100, [180, 200], false), 0);
});
