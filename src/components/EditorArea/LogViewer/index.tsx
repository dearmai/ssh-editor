import { useEffect, useRef, useState } from 'react';
import { sftpLogChunk, sftpLogSearch } from '../../../ipc/commands';
import { useEditorStore } from '../../../stores/editorStore';
import styles from './LogViewer.module.css';

const MAX_VISIBLE = 512 * 1024;

export default function LogViewer({ tabId }: { tabId: string }) {
  const tab = useEditorStore((s) => s.tabsById[tabId]);
  const [text, setText] = useState('');
  const [offset, setOffset] = useState<number | undefined>();
  const [size, setSize] = useState(0);
  const [following, setFollowing] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tab) return;
    let cancelled = false;
    sftpLogChunk(tab.connectionId, tab.remotePath)
      .then((chunk) => {
        if (cancelled) return;
        setText(chunk.text);
        setOffset(chunk.offset);
        setSize(chunk.size);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => { cancelled = true; };
  }, [tab?.connectionId, tab?.remotePath]);

  useEffect(() => {
    if (!tab || !following || offset === undefined) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const chunk = await sftpLogChunk(tab.connectionId, tab.remotePath, offset);
        if (cancelled) return;
        if (chunk.size < offset) {
          const fresh = await sftpLogChunk(tab.connectionId, tab.remotePath);
          if (cancelled) return;
          setText(fresh.text);
          setOffset(fresh.offset);
          setSize(fresh.size);
        } else {
          if (chunk.text) setText((old) => (old + chunk.text).slice(-MAX_VISIBLE));
          setOffset(chunk.offset);
          setSize(chunk.size);
        }
        setError('');
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        busy.current = false;
      }
    }, 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [tab?.connectionId, tab?.remotePath, following, offset]);

  useEffect(() => {
    if (following) endRef.current?.scrollIntoView({ block: 'end' });
  }, [text, following]);

  if (!tab) return null;

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try { setMatches(await sftpLogSearch(tab.connectionId, tab.remotePath, query)); }
    catch (e) { setError(String(e)); }
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <span>보기 모드 · 최근 {(text.length / 1024).toFixed(0)} KB / {(size / 1024 / 1024).toFixed(1)} MB</span>
        <button type="button" onClick={() => setFollowing((v) => !v)}>{following ? 'tail 중지' : 'tail -f (1초)'}</button>
        <form onSubmit={search}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="서버에서 검색" aria-label="로그 검색" />
          <button type="submit">검색</button>
        </form>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {matches && <details className={styles.results} open><summary>검색 결과 (최대 100줄)</summary><pre>{matches}</pre></details>}
      <div className={styles.content}><pre>{text || '내용을 불러오는 중...'}</pre><div ref={endRef} /></div>
    </div>
  );
}
