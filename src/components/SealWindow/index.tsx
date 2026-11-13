import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CheckCircle2, Lock, Unlock, XCircle } from 'lucide-react';
import { localCryptoBatch, localCryptoPlan, type CryptoMode } from '../../ipc/commands';
import { applyUiFont, effectiveTheme, useSettingsStore } from '../../stores/settingsStore';
import { log } from '../../stores/logStore';
import { applyColorTheme, getTheme } from '../../themes';
import PasswordInput from '../Dialogs/PasswordInput';
import styles from './SealWindow.module.css';

type Plan = { mode: CryptoMode; files: string[]; skipped: number };
type Result = { path: string; output: string | null; error: string | null };

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const close = () => void getCurrentWindow().close();

/**
 * 탐색기 우클릭 "보관/해제"로 실행됐을 때의 단독 창.
 * 에디터 화면 없이 대상 확인 → 비밀번호 → 결과만 보여 주고 닫힌다.
 */
export default function SealWindow({ paths }: { paths: string[] }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const extension = useSettingsStore((s) => s.localCryptoExtension.trim());

  // 에디터와 같은 테마·폰트 적용
  useEffect(() => {
    const s = useSettingsStore.getState();
    const resolved = effectiveTheme(s);
    applyColorTheme(getTheme(resolved === 'dark' ? s.darkTheme : s.lightTheme, resolved));
    applyUiFont(s);
  }, []);

  useEffect(() => {
    if (!useSettingsStore.getState().localCryptoEnabled) {
      setError('환경설정 > 기능에서 "로컬에서 암복호화 기능 사용하기"를 켜야 합니다.');
      return;
    }
    localCryptoPlan(paths)
      .then((p) => (p.files.length ? setPlan(p) : setError(
        p.mode === 'encrypt' ? '보관할 파일이 없습니다.' : '보관된 파일이 없습니다.',
      )))
      .catch((e) => setError(String(e)));
  }, [paths]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !running) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running]);

  const encrypt = plan?.mode === 'encrypt';
  const label = encrypt ? '보관' : '보관 해제';
  const mismatch = encrypt && confirm !== '' && confirm !== password;
  const canRun = !!plan && !!password && (!encrypt || confirm === password) && !running;

  const run = async () => {
    if (!plan || !canRun) return;
    setRunning(true);
    try {
      const res = await localCryptoBatch(plan.files, password, extension, plan.mode);
      for (const r of res) {
        if (r.error) log.error(`로컬 파일 ${label} 실패: ${r.path} — ${r.error}`);
        else log.info(`로컬 파일 ${label}: ${r.path}${r.output !== r.path ? ` → ${r.output}` : ''}`);
      }
      setResults(res);
      // 모두 성공하면 잠시 결과를 보여 준 뒤 자동으로 닫는다
      if (res.every((r) => !r.error)) setTimeout(close, 1500);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const dotExt = extension && (extension.startsWith('.') ? extension : `.${extension}`);
  const hint = !plan ? '' : dotExt
    ? encrypt ? `원본을 파일명${dotExt} 로 대체합니다.` : `파일명 끝의 ${dotExt} 를 제거합니다.`
    : '원본 파일을 제자리에서 교체합니다.';

  return (
    <div className={styles.window}>
      <div className={styles.header}>
        {encrypt ? <Lock size={16} /> : <Unlock size={16} />}
        <span>{plan ? `${label} — 파일 ${plan.files.length}개` : '보관/해제'}</span>
      </div>

      <div className={styles.body}>
        {error && <div className={styles.error}>{error}</div>}
        {!plan && !error && <div className={styles.muted}>대상을 확인하는 중…</div>}

        {plan && (
          <ul className={styles.files}>
            {plan.files.map((f) => {
              const r = results?.find((x) => x.path === f);
              return (
                <li key={f} title={r?.error ?? f}>
                  {r && (r.error ? <XCircle size={13} className={styles.fail} /> : <CheckCircle2 size={13} className={styles.ok} />)}
                  <span className={styles.name}>{baseName(r?.output ?? f)}</span>
                  {r?.error && <span className={styles.reason}>{r.error}</span>}
                </li>
              );
            })}
          </ul>
        )}

        {plan && !results && (
          <>
            <div className={styles.muted}>
              {hint}
              {plan.skipped > 0 && ` ${encrypt ? '이미 보관된' : '보관되지 않은'} 파일 ${plan.skipped}개는 제외합니다.`}
            </div>
            <form className={styles.form} onSubmit={(e) => { e.preventDefault(); void run(); }}>
              <PasswordInput
                value={password}
                placeholder="비밀번호"
                autoFocus
                autoComplete="off"
                disabled={running}
                onChange={(e) => setPassword(e.target.value)}
              />
              {encrypt && (
                <PasswordInput
                  value={confirm}
                  placeholder="비밀번호 확인"
                  autoComplete="off"
                  disabled={running}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
              {mismatch && <div className={styles.error}>비밀번호가 일치하지 않습니다.</div>}
              {encrypt && <div className={styles.muted}>비밀번호를 잊으면 복구할 수 없습니다.</div>}
              <button type="submit" hidden />
            </form>
          </>
        )}
      </div>

      <div className={styles.buttons}>
        {plan && !results ? (
          <>
            <button className={styles.cancel} onClick={close} disabled={running}>취소</button>
            <button className={styles.primary} onClick={() => void run()} disabled={!canRun}>
              {running ? '처리 중…' : label}
            </button>
          </>
        ) : (
          <button className={styles.primary} onClick={close}>닫기</button>
        )}
      </div>
    </div>
  );
}
