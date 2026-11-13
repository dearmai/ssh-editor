import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, Star } from 'lucide-react';
import {
  fileAssocOpenDefaults,
  fileAssocSet,
  fileAssocStatus,
  type FileAssocStatus,
} from '../../ipc/commands';
import { ALL_FILE_ASSOC_EXTS, FILE_ASSOC_CAUTION, FILE_ASSOC_GROUPS } from '../../utils/fileAssociations';
import { log } from '../../stores/logStore';
import styles from './Dialog.module.css';

/**
 * 환경설정 > 파일 연결 (Windows 전용)
 *  - 체크: 해당 확장자의 '연결 프로그램' 목록에 SSH Editor 등록 / 해제 (HKCU, 즉시 반영)
 *  - 상태: 현재 기본 앱 표시, SSH Editor가 기본 앱이면 ★
 *  - 기본 앱 지정: Windows 정책상 앱이 직접 바꿀 수 없어 Windows 설정 화면을 연다
 */
export default function FileAssocPanel() {
  const [status, setStatus] = useState<Record<string, FileAssocStatus>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const report = await fileAssocStatus(ALL_FILE_ASSOC_EXTS);
      setStatus(Object.fromEntries(report.items.map((i) => [i.ext, i])));
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Windows 설정 화면에서 돌아오면 기본 앱 변경을 반영
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const apply = async (exts: string[], enabled: boolean) => {
    if (exts.length === 0) return;
    setBusy(true);
    try {
      await fileAssocSet(exts, enabled);
      log.info(`파일 연결 ${enabled ? '등록' : '해제'}: ${exts.map((e) => '.' + e).join(', ')}`);
    } catch (e) {
      setError(String(e));
      log.error(`파일 연결 변경 실패: ${String(e)}`);
    } finally {
      await reload();
      setBusy(false);
    }
  };

  const registeredCount = useMemo(
    () => Object.values(status).filter((s) => s.registered).length,
    [status]
  );

  const openDefaults = async () => {
    try {
      await fileAssocOpenDefaults();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      <div className={styles.sectionTitle}>파일 연결</div>
      <div className={styles.hint}>
        설치 시에는 어떤 확장자도 자동으로 연결하지 않습니다. 체크한 확장자는 탐색기의
        <b> 연결 프로그램</b> 목록에 SSH Editor가 추가됩니다 (현재 사용자에게만, 즉시 반영).
        <br />
        더블클릭으로 열리게 하려면 <b>Windows 기본 앱 설정</b>에서 SSH Editor를 선택하세요. Windows
        정책상 앱이 기본 앱을 직접 바꿀 수 없습니다. <Star size={10} className={styles.assocStarInline} /> 는
        현재 SSH Editor가 기본 앱인 확장자입니다.
      </div>

      <div className={styles.assocToolbar}>
        <button type="button" className={styles.submitBtn} onClick={openDefaults}>
          <ExternalLink size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
          Windows 기본 앱 설정 열기
        </button>
        <button type="button" className={styles.cancelBtn} onClick={() => void reload()} disabled={busy}>
          <RefreshCw size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
          새로고침
        </button>
        <span className={styles.assocCount}>
          {loading ? '확인 중…' : `${registeredCount} / ${ALL_FILE_ASSOC_EXTS.length}개 연결됨`}
        </span>
        <button
          type="button"
          className={styles.cancelBtn}
          disabled={busy || registeredCount === 0}
          onClick={() =>
            void apply(
              Object.values(status)
                .filter((s) => s.registered)
                .map((s) => s.ext),
              false
            )
          }
        >
          모두 해제
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {FILE_ASSOC_GROUPS.map((g) => {
        const on = g.exts.filter((e) => status[e]?.registered);
        const all = on.length === g.exts.length;
        return (
          <div key={g.name} className={styles.assocGroup}>
            <label className={styles.assocGroupHead}>
              <input
                type="checkbox"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = on.length > 0 && !all;
                }}
                disabled={busy || loading}
                onChange={() =>
                  void apply(all ? g.exts : g.exts.filter((e) => !status[e]?.registered), !all)
                }
              />
              <span>{g.name}</span>
              <span className={styles.assocGroupCount}>
                {on.length}/{g.exts.length}
              </span>
            </label>
            <div className={styles.assocGrid}>
              {g.exts.map((ext) => {
                const st = status[ext];
                const caution = FILE_ASSOC_CAUTION[ext];
                const title = [
                  st?.isDefault
                    ? '기본 앱: SSH Editor'
                    : `기본 앱: ${st?.defaultApp ?? '없음'}`,
                  caution,
                ]
                  .filter(Boolean)
                  .join('\n');
                return (
                  <label
                    key={ext}
                    className={`${styles.assocItem} ${st?.registered ? styles.assocItemOn : ''}`}
                    title={title}
                  >
                    <input
                      type="checkbox"
                      checked={!!st?.registered}
                      disabled={busy || loading}
                      onChange={() => void apply([ext], !st?.registered)}
                    />
                    <span className={styles.assocExt}>.{ext}</span>
                    {caution && <AlertTriangle size={11} className={styles.assocWarn} />}
                    {st?.isDefault ? (
                      <Star size={11} className={styles.assocStar} />
                    ) : (
                      <span className={styles.assocApp}>{st?.defaultApp ?? ''}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
