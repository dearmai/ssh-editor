import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';
import styles from './Dialog.module.css';

export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const label = visible ? '비밀번호 숨기기' : '비밀번호 보기';
  return (
    <div className={styles.passwordInput}>
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className={styles.passwordToggle}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
