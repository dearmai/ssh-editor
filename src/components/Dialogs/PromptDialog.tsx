import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { usePromptStore } from '../../stores/promptStore';
import styles from './Dialog.module.css';

export default function PromptDialog() {
  const current = usePromptStore((s) => s.current);
  const respond = usePromptStore((s) => s.respond);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const open = current !== null;

  // 새 프롬프트가 뜰 때마다 초기값 반영 + 입력창 전체 선택
  useEffect(() => {
    if (current) {
      setValue(current.defaultValue ?? '');
      // 렌더 후 포커스/선택
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [current]);

  const submit = () => {
    const v = value.trim();
    if (v) respond(v);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && respond(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>{current?.title}</Dialog.Title>
          </div>

          <div className={styles.form}>
            <div className={styles.field}>
              <input
                ref={inputRef}
                value={value}
                placeholder={current?.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    respond(null);
                  }
                }}
                autoFocus
              />
            </div>

            <div className={styles.buttons}>
              <button className={styles.cancelBtn} onClick={() => respond(null)}>
                {current?.cancelLabel ?? '취소'}
              </button>
              <button className={styles.submitBtn} onClick={submit} disabled={!value.trim()}>
                {current?.confirmLabel ?? '확인'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
