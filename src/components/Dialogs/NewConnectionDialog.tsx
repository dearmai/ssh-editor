import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useFileTreeStore } from '../../stores/fileTreeStore';
import type { ConnectionProfile, SshConfigHost } from '../../types';
import styles from './Dialog.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NewConnectionDialog({ open, onClose }: Props) {
  const { addProfile, connect, sshConfigHosts, loadAll } = useConnectionStore();
  const { setRootPath, loadDir } = useFileTreeStore();

  const [form, setForm] = useState({
    name: '',
    hostname: '',
    port: '22',
    username: '',
    authType: 'agent' as 'password' | 'publicKey' | 'agent',
    password: '',
    identityFile: '',
    saveProfile: true,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    if (open && sshConfigHosts.length === 0) {
      loadAll();
    }
  }, [open]);

  const handleImport = (host: SshConfigHost) => {
    setForm((prev) => ({
      ...prev,
      name: prev.name || host.alias,
      hostname: host.hostname,
      port: String(host.port ?? 22),
      username: host.user ?? prev.username,
      authType: host.identityFile ? 'publicKey' : 'agent',
      identityFile: host.identityFile ?? prev.identityFile,
    }));
    setShowImport(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.hostname.trim()) {
      setError('호스트를 입력하세요.');
      return;
    }

    setLoading(true);
    setError('');

    const profile: ConnectionProfile = {
      id: crypto.randomUUID(),
      name: form.name || `${form.username}@${form.hostname}`,
      hostname: form.hostname.trim(),
      port: parseInt(form.port) || 22,
      username: form.username.trim(),
      authType: form.authType,
      password: form.authType === 'password' ? form.password : undefined,
      identityFile: form.authType === 'publicKey' ? form.identityFile.trim() : undefined,
    };

    try {
      if (form.saveProfile) {
        await addProfile(profile);
      }
      const sessionId = await connect(profile);
      const rootPath = `/home/${profile.username || 'root'}`;
      setRootPath(sessionId, rootPath);
      await loadDir(sessionId, rootPath);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const set = (field: keyof typeof form, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>새 SSH 연결</Dialog.Title>
            <Dialog.Close className={styles.closeBtn}>
              <X size={16} />
            </Dialog.Close>
          </div>

          {/* .ssh/config 가져오기 */}
          {sshConfigHosts.length > 0 && (
            <div className={styles.importSection}>
              <button
                type="button"
                className={styles.importToggle}
                onClick={() => setShowImport((v) => !v)}
              >
                <Download size={13} />
                .ssh/config에서 가져오기
                <ChevronDown
                  size={13}
                  style={{ transform: showImport ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                />
              </button>
              {showImport && (
                <div className={styles.importList}>
                  {sshConfigHosts.map((host) => (
                    <button
                      key={host.alias}
                      type="button"
                      className={styles.importItem}
                      onClick={() => handleImport(host)}
                    >
                      <span className={styles.importName}>{host.alias}</span>
                      <span className={styles.importMeta}>
                        {host.user ? `${host.user}@` : ''}{host.hostname}
                        {host.port && host.port !== 22 ? `:${host.port}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>연결 이름 (선택)</label>
              <input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="예: 개발 서버"
              />
            </div>

            <div className={styles.row}>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label}>호스트 *</label>
                <input
                  value={form.hostname}
                  onChange={(e) => set('hostname', e.target.value)}
                  placeholder="192.168.1.100"
                  required
                />
              </div>
              <div className={styles.field} style={{ width: 80 }}>
                <label className={styles.label}>포트</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => set('port', e.target.value)}
                  min={1}
                  max={65535}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>사용자명</label>
              <input
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                placeholder="ubuntu"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>인증 방식</label>
              <div className={styles.radioGroup}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="authType"
                    value="agent"
                    checked={form.authType === 'agent'}
                    onChange={() => set('authType', 'agent')}
                  />
                  SSH 키 (기본)
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="authType"
                    value="publicKey"
                    checked={form.authType === 'publicKey'}
                    onChange={() => set('authType', 'publicKey')}
                  />
                  키 파일 지정
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="authType"
                    value="password"
                    checked={form.authType === 'password'}
                    onChange={() => set('authType', 'password')}
                  />
                  비밀번호
                </label>
              </div>
            </div>

            {form.authType === 'password' && (
              <div className={styles.field}>
                <label className={styles.label}>비밀번호</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}

            {form.authType === 'publicKey' && (
              <div className={styles.field}>
                <label className={styles.label}>키 파일 경로</label>
                <input
                  value={form.identityFile}
                  onChange={(e) => set('identityFile', e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
              </div>
            )}

            <label className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={form.saveProfile}
                onChange={(e) => set('saveProfile', e.target.checked)}
              />
              서버 목록에 저장
            </label>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.buttons}>
              <Dialog.Close className={styles.cancelBtn}>취소</Dialog.Close>
              <button type="submit" className={styles.submitBtn} disabled={loading}>
                {loading ? '연결 중...' : '연결'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
