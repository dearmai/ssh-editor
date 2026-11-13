import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { COMMON_ENCODINGS, OTHER_ENCODINGS, encodingLabel } from '../../utils/encodings';
import styles from './EncodingStatus.module.css';

export default function EncodingStatus() {
  const tab = useEditorStore((s) => {
    const id = s.groupsById[s.activeGroupId]?.activeTabId;
    return id ? s.tabsById[id] : undefined;
  });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'read' | 'save'>('read');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!tab) return null;
  const unavailable = !!tab.segment || !!tab.unloaded;
  const pick = async (encoding: string) => {
    setBusy(true); setError('');
    try {
      await useEditorStore.getState().changeEncoding(tab.id, encoding, mode);
      setOpen(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const matches = (item: { id: string; label: string }) => `${item.id} ${item.label}`.toLowerCase().includes(query.toLowerCase());
  const common = COMMON_ENCODINGS.filter(matches);
  const other = OTHER_ENCODINGS.filter(matches);
  return <Dialog.Root open={open} onOpenChange={(value) => {
    if (busy) return;
    setOpen(value); setError(''); setQuery(''); setMode('read');
  }}>
    <Dialog.Trigger asChild><button className={styles.trigger} title="파일 인코딩 — 다시 읽기 또는 변환하여 저장">
      {tab.viewMode ? '인코딩 선택' : encodingLabel(tab.encoding)}
    </button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content className={styles.content} aria-describedby="encoding-description">
        <Dialog.Title className={styles.title}>파일 인코딩</Dialog.Title>
        <Dialog.Description id="encoding-description" className={styles.description}>
          현재: {tab.viewMode ? '보기 모드' : encodingLabel(tab.encoding)}
          {tab.encoding === 'cp949' && ' · CP949와 EUC-KR 호환 문자를 지원합니다.'}
        </Dialog.Description>
        {unavailable ? <p className={styles.description}>파일 전체를 편집기로 연 뒤 인코딩을 변경하세요.</p> : <>
          <div className={styles.modes}>
            <button disabled={busy} aria-pressed={mode === 'read'} onClick={() => setMode('read')}>다른 인코딩으로 다시 읽기</button>
            <button disabled={busy || tab.viewMode} aria-pressed={mode === 'save'} onClick={() => setMode('save')}>인코딩 변환 후 저장</button>
          </div>
          <p className={styles.description}>{mode === 'read' ? '파일 바이트는 바꾸지 않고 선택한 인코딩으로 해석합니다.' : '현재 편집 내용을 선택한 인코딩으로 변환하여 파일에 저장합니다.'}</p>
          <input className={styles.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="인코딩 검색" aria-label="인코딩 검색" disabled={busy} />
          <div className={styles.list}>
            {common.length > 0 && <div className={styles.group}>국내에서 자주 쓰는 인코딩</div>}
            {common.map((item) => <button key={item.id} disabled={busy} onClick={() => void pick(item.id)}>{item.label}{tab.encoding === item.id ? ' ✓' : ''}</button>)}
            {other.length > 0 && <><hr /><div className={styles.group}>다른 인코딩</div></>}
            {other.map((item) => <button key={item.id} disabled={busy} onClick={() => void pick(item.id)}>{item.label}{tab.encoding === item.id ? ' ✓' : ''}</button>)}
            {!common.length && !other.length && <p className={styles.description}>일치하는 인코딩이 없습니다.</p>}
          </div>
        </>}
        {busy && <p className={styles.description}>처리 중…</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <Dialog.Close className={styles.close} disabled={busy}>닫기</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
