import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { readBytes } from '../../../ipc/commands';
import { useEditorStore } from '../../../stores/editorStore';
import { formatBytes } from '../../../utils/formatBytes';
import styles from '../LargeFileViewer/LargeFileViewer.module.css';
import hexStyles from './HexViewer.module.css';

/** 한 화면 = 16KB (1024줄). 파일 크기와 관계없이 이만큼만 읽는다 */
const PAGE = 16 * 1024;
const ROW = 16;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** 오프셋·16바이트 hex·ASCII 를 한 줄씩 만든다 */
function render(bytes: Uint8Array, base: number, width: number): string {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += ROW) {
    const row = bytes.subarray(i, i + ROW);
    let hex = '';
    let ascii = '';
    for (let j = 0; j < ROW; j++) {
      if (j === 8) hex += ' ';
      if (j < row.length) {
        hex += hex2(row[j]) + ' ';
        ascii += row[j] >= 0x20 && row[j] < 0x7f ? String.fromCharCode(row[j]) : '.';
      } else {
        hex += '   ';
      }
    }
    lines.push(`${(base + i).toString(16).padStart(width, '0')}  ${hex} |${ascii}|`);
  }
  return lines.join('\n');
}

/** "0x1f00", "1f00h", "7936" 형식의 위치 입력 해석 */
function parseOffset(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const hex = s.startsWith('0x') ? s.slice(2) : s.endsWith('h') ? s.slice(0, -1) : null;
  const n = hex !== null ? parseInt(hex, 16) : Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 바이너리 파일 Hex 보기 (로컬/원격 공통, 16KB 구간씩 읽기) */
export default function HexViewer({ tabId }: { tabId: string }) {
  const tab = useEditorStore((s) => s.tabsById[tabId]);
  const [page, setPage] = useState<{ offset: number; size: number; bytes: Uint8Array } | null>(null);
  const [error, setError] = useState('');
  const [goto, setGoto] = useState('');
  const [slider, setSlider] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (offset: number) => {
    if (!tab) return;
    const aligned = Math.max(0, Math.floor(offset / ROW) * ROW);
    try {
      const c = await readBytes(tab.connectionId, tab.remotePath, aligned, PAGE);
      setPage({ offset: c.offset, size: c.size, bytes: decode(c.data) });
      setError('');
      if (contentRef.current) contentRef.current.scrollTop = 0;
    } catch (e) {
      setError(String(e));
    }
  }, [tab?.connectionId, tab?.remotePath]);

  useEffect(() => { void load(0); }, [load]);

  const size = page?.size ?? 0;
  const width = Math.max(8, size.toString(16).length);
  const text = useMemo(() => (page ? render(page.bytes, page.offset, width) : ''), [page, width]);

  if (!tab) return null;

  const offset = page?.offset ?? 0;
  const atStart = offset === 0;
  const atEnd = !page || offset + page.bytes.length >= size;
  const lastPage = Math.max(0, Math.floor((size - 1) / PAGE) * PAGE);
  const submitGoto = (e: FormEvent) => {
    e.preventDefault();
    const n = parseOffset(goto);
    if (n === null) { setError('위치는 10진수 또는 0x로 시작하는 16진수로 입력하세요'); return; }
    void load(Math.min(n, Math.max(0, size - 1)));
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <span className={styles.badge}>Hex 보기</span>
        <button type="button" title="처음" disabled={atStart} onClick={() => void load(0)}><ChevronFirst size={14} /></button>
        <button type="button" title="이전 구간" disabled={atStart} onClick={() => void load(offset - PAGE)}><ChevronLeft size={14} /></button>
        <button type="button" title="다음 구간" disabled={atEnd} onClick={() => void load(offset + PAGE)}><ChevronRight size={14} /></button>
        <button type="button" title="끝" disabled={atEnd} onClick={() => void load(lastPage)}><ChevronLast size={14} /></button>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={1000}
          value={slider ?? (size ? (offset / size) * 1000 : 0)}
          aria-label="파일 위치"
          onChange={(e) => setSlider(Number(e.target.value))}
          onPointerUp={() => { if (slider != null) { void load((size * slider) / 1000); setSlider(null); } }}
          onKeyUp={() => { if (slider != null) { void load((size * slider) / 1000); setSlider(null); } }}
        />
        <span className={styles.pos}>
          {page ? `0x${offset.toString(16)} – 0x${(offset + page.bytes.length).toString(16)} / ${formatBytes(size)}` : '읽는 중…'}
        </span>
        <form onSubmit={submitGoto} className={styles.search}>
          <input value={goto} onChange={(e) => setGoto(e.target.value)} placeholder="위치 (예: 0x1f00, 7936)" aria-label="이동할 위치" />
          <button type="submit" disabled={!goto.trim()}>이동</button>
        </form>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.content} ref={contentRef}>
        <pre className={hexStyles.hex}>{page ? text || '(빈 파일)' : '내용을 불러오는 중...'}</pre>
      </div>
    </div>
  );
}
