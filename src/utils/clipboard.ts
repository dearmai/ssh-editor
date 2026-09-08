import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * 로컬(호스트) 클립보드에 텍스트 쓰기.
 * Tauri 클립보드 플러그인 우선, 실패 시 웹 API로 폴백.
 */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await writeText(text);
    return;
  } catch {
    // 플러그인 사용 불가 시 폴백
  }

  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 마지막 폴백: 임시 textarea + execCommand
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * 로컬(호스트) 클립보드에서 텍스트 읽기.
 * Tauri 플러그인 우선, 실패 시 웹 API 폴백. 둘 다 실패하면 빈 문자열.
 */
export async function readClipboard(): Promise<string> {
  try {
    return (await readText()) ?? '';
  } catch {
    // 플러그인 사용 불가 시 폴백
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

/**
 * OSC 52 payload(base64)를 UTF-8 문자열로 디코드.
 * 원격 앱이 개행·URL-safe 문자·패딩 누락된 base64를 보내는 경우가 흔해
 * atob 이전에 정규화한다(그대로 넣으면 InvalidCharacterError).
 */
export function decodeOsc52Base64(b64: string): string {
  const normalized = b64
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  // 패딩 보정: 4의 배수로 맞춤. 나머지 1글자는 유효한 base64가 될 수 없어 버린다.
  let body = normalized.replace(/=+$/, '');
  if (body.length % 4 === 1) body = body.slice(0, -1);
  const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
