import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { localLineIndex, localReadLines, localSearch, type LineIndex, type SearchHit } from '../../../ipc/commands';
import { useEditorStore } from '../../../stores/editorStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { toastError } from '../../../stores/toastStore';
import { formatBytes } from '../../../utils/formatBytes';
import styles from './LargeFileViewer.module.css';

/** 한 번에 읽는 줄 묶음 */
const BLOCK = 200;
/** 메모리에 두는 최대 블록 수 (약 1만 줄) — 넘으면 오래된 블록부터 버린다 */
const MAX_BLOCKS = 60;
/** 브라우저 요소 높이 한계 대비 — 넘으면 스크롤 위치를 비율로 줄에 대응시킨다 */
const MAX_PX = 8_000_000;
/** "이 위치부터 편집" 으로 여는 줄 수 */
const SEGMENT_LINES = 5000;

type Index = Omit<LineIndex, 'every'> & { every: number };

/**
 * 로컬 대용량 텍스트 보기 — 희소 줄 색인 + 연속 스크롤.
 * 화면 근처 줄 블록만 읽어 두므로 파일 크기와 관계없이 메모리는 일정하다.
 */
export default function LargeFileViewer({ tabId }: { tabId: string }) {
  const tab = useEditorStore((s) => s.tabsById[tabId]);
  const path = tab?.remotePath ?? '';
  const revision = useEditorStore((s) => s.fileRevisions[path] ?? 0);
  const fontSize = useSettingsStore((s) => s.editorFontSize);
  const lh = Math.round(fontSize * 1.5);

  const [index, setIndex] = useState<Index | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const [contentH, setContentH] = useState(400);
  const [following, setFollowing] = useState(false);
  const [gotoLine, setGotoLine] = useState('');
  const [query, setQuery] = useState('');
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<number, string[]>());
  const inflight = useRef(new Set<number>());
  const indexRef = useRef<Index | null>(null);
  indexRef.current = index;

  // ── 줄 색인 ─────────────────────────────────────
  const rebuild = useCallback(async () => {
    try {
      const idx = await localLineIndex(path);
      cache.current.clear();
      setIndex(idx);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }, [path]);

  /** 파일이 늘었으면 늘어난 부분만 색인, 줄었거나 내용이 바뀌었으면 다시 만든다 → 바뀌었는지 */
  const refresh = useCallback(async (): Promise<boolean> => {
    const cur = indexRef.current;
    if (!cur) return false;
    const r = await localLineIndex(path, { offset: cur.size, newlines: cur.newlines });
    if (r.size === cur.size && r.mtime === cur.mtime) return false;
    if (r.size < cur.size || (r.size === cur.size && r.mtime !== cur.mtime)) {
      await rebuild();
      return true;
    }
    // 덧붙여진 경우: 마지막 줄이 이어졌을 수 있으므로 끝쪽 블록은 다시 읽는다
    const lastBlock = Math.floor(Math.max(0, cur.total - 1) / BLOCK);
    for (const b of [...cache.current.keys()]) if (b >= lastBlock) cache.current.delete(b);
    setIndex({ ...r, offsets: cur.offsets.concat(r.offsets) });
    return true;
  }, [path, rebuild]);

  useEffect(() => { void rebuild(); }, [rebuild]);
  // 구간 편집 저장 후 다시 색인
  const firstRevision = useRef(revision);
  useEffect(() => {
    if (revision !== firstRevision.current) void rebuild();
  }, [revision, rebuild]);
  // 창으로 돌아오면 바뀌었는지 확인
  useEffect(() => {
    const onFocus = () => void refresh().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // ── 화면 크기 ───────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      setContentH(overlayRef.current?.clientHeight ?? el.clientHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (overlayRef.current) ro.observe(overlayRef.current);
    measure();
    return () => ro.disconnect();
  }, []);

  // ── 좌표 계산 ───────────────────────────────────
  const total = index?.total ?? 0;
  const visible = Math.ceil(contentH / lh) + 1;
  const natural = total * lh + Math.max(0, viewH - contentH);
  const exact = natural <= MAX_PX;
  const height = exact ? natural : MAX_PX;
  const range = Math.max(1, height - viewH);
  const maxFirst = Math.max(0, total - Math.max(1, Math.floor(contentH / lh)));
  const firstLine = exact
    ? Math.min(Math.floor(scrollTop / lh), Math.max(0, total - 1))
    : Math.min(maxFirst, Math.round((scrollTop / range) * maxFirst));
  const pxOffset = exact ? scrollTop - firstLine * lh : 0;
  const lastLine = Math.min(total, firstLine + visible + 1);
  const lineTop = (n: number) => (exact ? n * lh : maxFirst ? (n / maxFirst) * range : 0);

  const scrollToLine = (n: number) => {
    const el = scrollRef.current;
    if (el) el.scrollTop = lineTop(Math.max(0, Math.min(n, total - 1)));
  };

  // ── 블록 읽기 ───────────────────────────────────
  const fetchBlock = useCallback(async (b: number) => {
    const idx = indexRef.current;
    if (!idx || inflight.current.has(b) || cache.current.has(b)) return;
    inflight.current.add(b);
    try {
      const startLine = b * BLOCK;
      let anchor = idx.offsets[Math.floor(startLine / idx.every)] ?? 0;
      let skip = startLine % idx.every;
      const lines: string[] = [];
      while (lines.length < BLOCK) {
        const r = await localReadLines(path, anchor, skip, BLOCK - lines.length);
        lines.push(...r.lines);
        if (r.eof || r.lines.length === 0) break;
        anchor = r.nextOffset;
        skip = 0;
      }
      if (indexRef.current !== idx) return; // 그사이 색인이 바뀜
      cache.current.set(b, lines);
      while (cache.current.size > MAX_BLOCKS) {
        cache.current.delete(cache.current.keys().next().value!);
      }
      setTick((t) => t + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      inflight.current.delete(b);
      // 이전 색인의 요청이 끝난 뒤에도 현재 화면의 누락 블록을 다시 요청한다.
      if (indexRef.current !== idx) setTick((t) => t + 1);
    }
  }, [path]);

  const firstBlock = Math.floor(firstLine / BLOCK);
  const lastBlock = Math.floor(Math.max(firstLine, lastLine - 1) / BLOCK);
  useEffect(() => {
    if (!index || total === 0) return;
    const maxBlock = Math.floor((total - 1) / BLOCK);
    for (let b = Math.max(0, firstBlock - 1); b <= Math.min(maxBlock, lastBlock + 1); b++) void fetchBlock(b);
  }, [index, total, firstBlock, lastBlock, fetchBlock, tick]);

  // ── tail ───────────────────────────────────────
  useEffect(() => {
    if (!following) return;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await refresh();
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      } catch (e) {
        setError(String(e));
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(timer);
  }, [following, refresh]);

  if (!tab) return null;

  const lineText = (n: number): string | undefined => cache.current.get(Math.floor(n / BLOCK))?.[n % BLOCK];
  const gutter = `${Math.max(4, String(total).length) + 1}ch`;

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setSearching(true);
    setError('');
    try {
      const r = await localSearch(path, query, ignoreCase);
      setHits(r.hits);
      setTruncated(r.truncated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSearching(false);
    }
  };

  const submitGoto = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(gotoLine.replace(/,/g, ''));
    if (!Number.isInteger(n) || n < 1) { setError('이동할 줄 번호를 입력하세요'); return; }
    setFollowing(false);
    scrollToLine(n - 1);
  };

  const editHere = async () => {
    if (!index) return;
    const anchor = index.offsets[Math.floor(firstLine / index.every)] ?? 0;
    try {
      await useEditorStore.getState().openSegment(
        { path, name: tab.fileName, size: index.size, isDir: false },
        { anchor, skip: firstLine % index.every, startLine: firstLine, count: SEGMENT_LINES },
      );
    } catch (err) {
      toastError(`구간 편집 열기 실패: ${String(err)}`);
    }
  };

  const rows = [];
  for (let n = firstLine; n < lastLine; n++) {
    const text = lineText(n);
    rows.push(
      <div key={n} className={styles.row} style={{ height: lh, lineHeight: `${lh}px` }}>
        <span className={styles.ln} style={{ width: gutter }}>{n + 1}</span>
        <span className={text === undefined ? styles.pending : styles.txt}>{text ?? '…'}</span>
      </div>,
    );
  }

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <span className={styles.badge}>보기 모드</span>
        <span className={styles.pos}>
          {index
            ? `${(firstLine + 1).toLocaleString()}–${lastLine.toLocaleString()}줄 / ${total.toLocaleString()}줄 · ${formatBytes(index.size)}`
            : '줄 색인 만드는 중…'}
        </span>
        <form onSubmit={submitGoto} className={styles.inline}>
          <input value={gotoLine} onChange={(e) => setGotoLine(e.target.value)} placeholder="줄 번호" aria-label="이동할 줄" style={{ width: 90 }} />
          <button type="submit" disabled={!index || !gotoLine.trim()}>이동</button>
        </form>
        <button type="button" disabled={!index || total === 0} onClick={() => void editHere()} title={`보이는 첫 줄부터 최대 ${SEGMENT_LINES.toLocaleString()}줄(8MB)을 편집기로 열고, 저장하면 그 구간만 원본에 바꿔 끼웁니다`}>
          <Pencil size={13} /> 이 위치부터 편집
        </button>
        <button type="button" className={following ? styles.on : ''} disabled={!index} onClick={() => setFollowing((v) => !v)}>
          {following ? 'tail 중지' : 'tail -f'}
        </button>
        <form onSubmit={search} className={styles.search}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="파일 전체에서 검색" aria-label="검색어" />
          <label title="대소문자 무시">
            <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />Aa 무시
          </label>
          <button type="submit" disabled={searching || !query}>{searching ? '검색 중…' : '검색'}</button>
        </form>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {hits && (
        <div className={styles.results}>
          <div className={styles.resultsHead}>
            검색 결과 {hits.length}줄{truncated ? ' (최대 개수에서 중단)' : ''}
            <button type="button" onClick={() => setHits(null)}>닫기</button>
          </div>
          {hits.length === 0 && <div className={styles.muted}>일치하는 줄이 없습니다.</div>}
          {hits.map((h) => (
            <button
              type="button"
              key={`${h.line}:${h.offset}`}
              className={styles.hit}
              onClick={() => { setFollowing(false); scrollToLine(h.line - 3); }}
            >
              <span className={styles.lineNo}>{h.line}</span>
              <span className={styles.hitText}>{h.text}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className={styles.scroller}
        ref={scrollRef}
        tabIndex={0}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: Math.max(height, viewH), position: 'relative' }}>
          <div ref={overlayRef} className={styles.overlay} style={{ height: viewH }}>
            {!index ? (
              <div className={styles.muted}>줄 색인을 만드는 중입니다… (큰 파일은 몇 초 걸릴 수 있습니다)</div>
            ) : total === 0 ? (
              <div className={styles.muted}>(빈 파일)</div>
            ) : (
              <div className={styles.lines} style={{ transform: `translateY(${-pxOffset}px)` }}>{rows}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
