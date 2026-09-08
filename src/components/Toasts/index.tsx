import { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useToastStore } from '../../stores/toastStore';
import styles from './Toasts.module.css';

function Toast({ id, text }: { id: string; text: string }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(id), 8000);
    return () => clearTimeout(timer);
  }, [id, dismiss]);
  return <div className={styles.toast} role="alert">
    <AlertCircle size={18} aria-hidden />
    <span>{text}</span>
    <button onClick={() => dismiss(id)} aria-label="알림 닫기"><X size={16} /></button>
  </div>;
}

export default function Toasts() {
  const messages = useToastStore((s) => s.messages);
  return <div className={styles.container}>{messages.map((m) => <Toast key={m.id} {...m} />)}</div>;
}
