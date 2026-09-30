import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTerminalImeFallback, needsTerminalImeFallback } from '../src/utils/terminalIme.ts';

function setup(t) {
  const textarea = new EventTarget();
  textarea.value = '';
  const output = [];
  let preview = '';
  const ime = createTerminalImeFallback(textarea, textarea, (data) => output.push(data), (text) => { preview = text; });
  t.after(() => ime.dispose());
  const key = (key = 'Unidentified', keyCode = 229, extra = {}) => ime.handleKey({
    type: 'keydown', key, keyCode, isComposing: false, ...extra,
  });
  const input = (value, extra = {}) => {
    textarea.value = value;
    const event = new Event('input');
    Object.assign(event, { isComposing: false, inputType: 'insertText', ...extra });
    textarea.dispatchEvent(event);
  };
  return { textarea, output, ime, key, input, preview: () => preview };
}

test('macOS WebKit에만 적용하고 Linux 및 macOS Chromium은 기존 IME를 사용한다', () => {
  assert.equal(needsTerminalImeFallback('MacIntel', 'AppleWebKit/605.1.15 Safari/605.1.15'), true);
  assert.equal(needsTerminalImeFallback('MacIntel', 'AppleWebKit/537.36 Chrome/130 Safari/537.36'), false);
  assert.equal(needsTerminalImeFallback('Linux x86_64', 'AppleWebKit/537.36 Chrome/130 Safari/537.36'), false);
  assert.equal(needsTerminalImeFallback('Linux x86_64', 'Firefox/130'), false);
  assert.equal(needsTerminalImeFallback('Linux x86_64', 'AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'), false);
});

test('ㅎ → 하 → 한 교체를 보관한 뒤 Enter 전에 완성된 한글만 전송한다', (t) => {
  const s = setup(t);
  for (const value of ['ㅎ', '하', '한']) {
    assert.equal(s.key(), false);
    s.input(value);
    assert.equal(s.preview(), value);
    assert.deepEqual(s.output, []);
  }
  assert.equal(s.key('Enter', 13), true);
  assert.deepEqual(s.output, ['한']);
  assert.equal(s.preview(), '');
  assert.equal(s.textarea.value, '');
});

test('받침이 다음 음절로 이동하는 연속 입력은 중간 자음을 전송하지 않는다', (t) => {
  const s = setup(t);
  for (const value of ['ㄱ', '구', '국', '구거', '구걸']) {
    s.key();
    s.input(value);
  }
  assert.deepEqual(s.output, ['구']);
  s.key(' ', 32);
  assert.equal(s.output.join(''), '구걸');
});

test('조합 중 삭제, 숫자/기호 및 다음 입력 세션을 처리한다', (t) => {
  const s = setup(t);
  s.textarea.value = 'previous input';
  s.key();
  s.input('previous inputㅎ');
  s.input('previous input');
  assert.equal(s.preview(), '');
  assert.deepEqual(s.output, []);
  s.input('previous input한1.');
  assert.equal(s.output.join(''), '한1.');
  s.key('Enter', 13);
  s.key();
  s.input('ㄱ');
  s.input('가');
  s.ime.flush();
  assert.equal(s.output.join(''), '한1.가');
});

test('표준 composition 이벤트와 일반 영문 입력은 xterm으로 넘긴다', (t) => {
  const s = setup(t);
  let forwarded = 0;
  s.textarea.addEventListener('input', () => forwarded++);
  assert.equal(s.key('a', 65), true);
  s.input('a');
  s.key();
  s.textarea.dispatchEvent(new Event('compositionstart'));
  assert.equal(s.key('Unidentified', 229, { isComposing: true }), true);
  s.input('한', { isComposing: true, data: '한' });
  s.textarea.dispatchEvent(new Event('compositionend'));
  s.input('한', { data: '한' });
  assert.equal(forwarded, 3);
  assert.deepEqual(s.output, []);
});

test('fallback 입력 중복 방지 및 blur/paste 확정, dispose 리스너 해제', (t) => {
  const s = setup(t);
  let forwarded = 0;
  s.textarea.addEventListener('input', () => forwarded++);
  for (const boundary of ['blur', 'paste']) {
    s.key();
    s.input('한');
    assert.equal(s.key('Unidentified', 229, { type: 'keypress' }), false);
    s.textarea.dispatchEvent(new Event(boundary));
  }
  assert.deepEqual(s.output, ['한', '한']);
  assert.equal(forwarded, 0);
  s.ime.dispose();
  s.input('a');
  assert.equal(forwarded, 1);
});

test('첫 keyCode 229보다 먼저 도착한 한글 input도 가나다라의 첫 글자를 보존한다', (t) => {
  const s = setup(t);
  // WebKit의 input을 먼저 받고 다음 키부터 229로 전달되는 경로.
  s.input('ㄱ', { data: 'ㄱ' });
  for (const value of ['가', '간', '가나', '가낟', '가나다', '가나달', '가나다라']) {
    s.key();
    s.input(value);
  }
  s.key('Enter', 13);
  assert.equal(s.output.join(''), '가나다라');
});

test('첫 입력이 textarea의 기존 선택 영역을 교체해도 첫 글자를 자르지 않는다', (t) => {
  const s = setup(t);
  s.textarea.value = 'x';
  s.textarea.selectionStart = 0;
  s.textarea.selectionEnd = 1;
  s.key();
  const before = new Event('beforeinput');
  Object.assign(before, { inputType: 'insertText', data: 'ㄱ', isComposing: false });
  s.textarea.dispatchEvent(before);
  for (const value of ['ㄱ', '가', '간', '가나', '가낟', '가나다', '가나달', '가나다라']) {
    s.input(value);
    s.key();
  }
  s.key('Enter', 13);
  assert.equal(s.output.join(''), '가나다라');
});

test('조합 글자의 삭제/삽입 이벤트 쌍은 이미 전송한 첫 글자를 지우지 않는다', (t) => {
  const s = setup(t);
  s.key();
  for (const value of ['ㄱ', '가', '가ㄴ', '가', '가나', '가나ㄷ', '가나', '가나다', '가나다ㄹ', '가나다', '가나다라']) {
    s.input(value);
  }
  s.key('Enter', 13);
  assert.equal(s.output.join(''), '가나다라');
});


test('beforeinput부터 시작한 조합은 기존 텍스트를 재전송하지 않는다', (t) => {
  const s = setup(t);
  s.textarea.value = 'old';
  s.textarea.selectionStart = 3;
  const before = new Event('beforeinput');
  Object.assign(before, { inputType: 'insertText', data: 'ㄱ', isComposing: false });
  s.textarea.dispatchEvent(before);
  s.input('oldㄱ', { data: 'ㄱ' });
  for (const value of ['old가', 'old간', 'old가나', 'old가낟', 'old가나다', 'old가나달', 'old가나다라']) {
    s.key();
    s.input(value);
  }
  s.key('Enter', 13);
  assert.equal(s.output.join(''), '가나다라');
});
