import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveInputPath, completionQuery, matchingEntries } from '../src/utils/pathCompletion.ts';

test('작업 폴더 외부의 절대/상대/홈 경로를 정규화한다', () => {
  for (const [input, expected] of [
    ['/etc/nginx/nginx.conf', '/etc/nginx/nginx.conf'],
    ['../../other/file.json', '/other/file.json'],
    ['../slack-manifest.json', '/app/slack-manifest.json'],
    ['~/.ssh/config', '/home/user/.ssh/config'],
    ['../../../etc/hosts', '/etc/hosts'],
    ['./hello world/#config?.json', '/app/docs/hello world/#config?.json'],
  ]) assert.equal(resolveInputPath(input, '/app/docs', '/home/user'), expected);
});

test('파일 입력은 부모 디렉토리와 자동완성 접두사로 나눈다', () => {
  assert.deepEqual(completionQuery('/etc/nginx/ng', '/app', '/home/me'), { directory: '/etc/nginx', prefix: 'ng' });
  assert.deepEqual(completionQuery('../sla', '/app/docs', '/home/me'), { directory: '/app', prefix: 'sla' });
  assert.deepEqual(completionQuery('~/.ssh/co', '/app', '/home/me'), { directory: '/home/me/.ssh', prefix: 'co' });
});

test('슬래시/상위 폴더/홈 입력은 디렉토리 내용 전체를 제안한다', () => {
  for (const [input, directory] of [['/etc/', '/etc'], ['/', '/'], ['..', '/'], ['~', '/home/me'], ['', '/app']]) {
    assert.deepEqual(completionQuery(input, '/app', '/home/me'), { directory, prefix: '' });
  }
});

test('로컬 Windows 드라이브와 역슬래시 경로를 처리한다', () => {
  assert.equal(resolveInputPath('..\\other\\file.txt', 'C:\\work\\project', 'C:/Users/me'), 'C:/work/other/file.txt');
  assert.equal(resolveInputPath('D:\\outside\\file.txt', 'C:/work', 'C:/Users/me'), 'D:/outside/file.txt');
  assert.deepEqual(completionQuery('C:/Win', 'C:/work', 'C:/Users/me'), { directory: 'C:/', prefix: 'Win' });
  assert.equal(resolveInputPath('/etc/file', 'C:/work', 'C:/Users/me'), 'C:/etc/file');
});

test('숨김 파일도 완성하고 폴더를 먼저 표시하며 원본 목록은 유지한다', () => {
  const entries = [{ name: '.env', isDir: false }, { name: 'config.json', isDir: false }, { name: 'config', isDir: true }, { name: 'Config', isDir: false }];
  assert.deepEqual(matchingEntries(entries, 'con').map((e) => e.name), ['config', 'config.json']);
  assert.deepEqual(matchingEntries(entries, '.').map((e) => e.name), ['.env']);
  assert.equal(entries[0].name, '.env');
});

test('홈을 모를 때 ~/와 제어 문자는 오류로 처리한다', () => {
  assert.throws(() => resolveInputPath('~/a', '/app', ''), /홈/);
  assert.throws(() => resolveInputPath('~other/a', '/app', '/home/me'), /절대 경로/);
  assert.throws(() => resolveInputPath('/tmp/a\nfile', '/app', '/home/me'), /제어 문자/);
});
