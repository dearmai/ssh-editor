import { useEffect, useState } from 'react';
import { Leaf } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';

/** eco로 메모리에서 해제된 탭이 다시 보일 때 — 파일에서 새로 읽는다 */
export default function UnloadedPane({ tabId }: { tabId: string }) {
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError('');
    useEditorStore.getState().reloadUnloaded(tabId).catch((e) => !cancelled && setError(String(e)));
    return () => { cancelled = true; };
  }, [tabId, attempt]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: 12 }}>
      <Leaf size={20} />
      {error ? (
        <>
          <div style={{ color: 'var(--error, #f48771)', maxWidth: 480, textAlign: 'center', overflowWrap: 'anywhere' }}>다시 읽기 실패: {error}</div>
          <button type="button" onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
        </>
      ) : (
        <div>메모리에서 해제된 탭을 다시 읽는 중…</div>
      )}
    </div>
  );
}
