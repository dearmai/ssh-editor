import { writeText } from '@tauri-apps/plugin-clipboard-manager';

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

/** OSC 52 payload(base64)를 UTF-8 문자열로 디코드 */
export function decodeOsc52Base64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
