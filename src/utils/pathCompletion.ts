import type { FileEntry } from '../types';

export function resolveInputPath(input: string, base: string, home: string): string {
  let value = input.replace(/\\/g, '/');
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('경로에 제어 문자를 사용할 수 없습니다.');
  if (value === '~' || value.startsWith('~/')) {
    if (!home) throw new Error('홈 디렉토리를 확인할 수 없습니다. 절대 경로를 입력하세요.');
    value = home + value.slice(1);
  } else if (value.startsWith('~')) {
    throw new Error('다른 사용자의 ~ 경로 대신 절대 경로를 입력하세요.');
  }
  const normalizedBase = base.replace(/\\/g, '/');
  const baseDrive = normalizedBase.match(/^[A-Za-z]:/)?.[0] ?? '';
  if (value.startsWith('/') && baseDrive) value = baseDrive + value;
  if (!value.startsWith('/') && !/^[A-Za-z]:\//.test(value)) value = `${normalizedBase}/${value}`;
  const drive = value.match(/^[A-Za-z]:/)?.[0] ?? '';
  const parts: string[] = [];
  for (const part of value.slice(drive.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${drive}/${parts.join('/')}`;
}

export function completionQuery(input: string, base: string, home: string) {
  const path = resolveInputPath(input, base, home);
  if (!input || /[\\/]$/.test(input) || input === '~' || input === '.' || input === '..') {
    return { directory: path, prefix: '' };
  }
  const slash = path.lastIndexOf('/');
  const directory = path.slice(0, slash) || '/';
  return { directory: /^[A-Za-z]:$/.test(directory) ? `${directory}/` : directory, prefix: path.slice(slash + 1) };
}

export function matchingEntries(entries: FileEntry[], prefix: string): FileEntry[] {
  return entries.filter((entry) => entry.name.startsWith(prefix))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}
