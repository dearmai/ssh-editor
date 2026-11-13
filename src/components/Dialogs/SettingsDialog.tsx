import * as Dialog from '@radix-ui/react-dialog';
import { FileSymlink, FolderOpen, Indent, Lock, Palette, Plus, RotateCcw, Type, X } from 'lucide-react';
import {
  applyUiFont,
  DEFAULT_MONO_FONT,
  DEFAULT_UI_FONT,
  MAX_OPEN_MB,
  useSettingsStore,
  type Settings,
  type ThemeMode,
} from '../../stores/settingsStore';
import { useMemo, useState, useEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DEFAULT_INDENT, TAB_SIZES, type IndentRule } from '../../utils/indent';
import { DARK_THEMES, LIGHT_THEMES, type ColorTheme } from '../../themes';
import { isFileAssocPlatform } from '../../utils/fileAssociations';
import FileAssocPanel from './FileAssocPanel';
import { explorerMenuSet, explorerMenuStatus } from '../../ipc/commands';
import styles from './Dialog.module.css';

const THEME_OPTS: { mode: ThemeMode; label: string; Icon: typeof Moon }[] = [
  { mode: 'system', label: '시스템', Icon: Monitor },
  { mode: 'dark', label: '다크', Icon: Moon },
  { mode: 'light', label: '라이트', Icon: Sun },
];

function ThemeChoices({
  list,
  value,
  onPick,
}: {
  list: ColorTheme[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className={styles.themeGrid}>
      {list.map((t) => {
        const swatches = [
          t.vars['--bg-primary'],
          t.vars['--accent'],
          t.terminal.green ?? t.vars['--text-primary'],
          t.terminal.yellow ?? t.vars['--text-secondary'],
          t.terminal.magenta ?? t.vars['--accent'],
        ];
        return (
          <button
            key={t.id}
            type="button"
            className={`${styles.themeChip} ${value === t.id ? styles.themeChipActive : ''}`}
            onClick={() => onPick(t.id)}
            title={t.name}
          >
            <span
              className={styles.swatches}
              style={{ background: t.vars['--bg-primary'], borderColor: t.vars['--border'] }}
            >
              {swatches.map((c, i) => (
                <span key={i} className={styles.swatch} style={{ background: c }} />
              ))}
            </span>
            <span className={styles.themeName}>{t.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 확장자 한 칸 — 방식(탭/공백) 토글 + 크기 선택 + 삭제 */
function IndentCell({
  label,
  rule,
  onChange,
  onRemove,
}: {
  label: string;
  rule: IndentRule;
  onChange: (r: IndentRule) => void;
  onRemove?: () => void;
}) {
  return (
    <div className={styles.indentCell}>
      <span className={styles.indentExt} title={label}>
        {label}
      </span>
      <div className={styles.indentToggle}>
        <button
          type="button"
          className={`${styles.indentToggleBtn} ${rule.insertSpaces ? styles.indentToggleOn : ''}`}
          onClick={() => onChange({ ...rule, insertSpaces: true })}
          title="공백 (Soft Tab)"
        >
          공백
        </button>
        <button
          type="button"
          className={`${styles.indentToggleBtn} ${!rule.insertSpaces ? styles.indentToggleOn : ''}`}
          onClick={() => onChange({ ...rule, insertSpaces: false })}
          title="탭 문자 (Hard Tab)"
        >
          탭
        </button>
      </div>
      <select
        className={styles.indentSize}
        value={rule.tabSize}
        onChange={(e) => onChange({ ...rule, tabSize: Number(e.target.value) })}
        title="들여쓰기 크기"
      >
        {TAB_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}칸
          </option>
        ))}
      </select>
      {onRemove && (
        <button type="button" className={styles.indentRemove} onClick={onRemove} title="규칙 삭제">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

type SettingsTab = 'appearance' | 'font' | 'indent' | 'fileOpen' | 'features' | 'fileAssoc';

const TABS: { id: SettingsTab; label: string; Icon: typeof Type }[] = [
  { id: 'appearance', label: '테마', Icon: Palette },
  { id: 'font', label: '폰트', Icon: Type },
  { id: 'indent', label: '들여쓰기', Icon: Indent },
  { id: 'fileOpen', label: '파일 열기', Icon: FolderOpen },
  { id: 'features', label: '기능', Icon: Lock },
  // 파일 연결 관리는 Windows 전용
  ...(isFileAssocPlatform()
    ? [{ id: 'fileAssoc' as const, label: '파일 연결', Icon: FileSymlink }]
    : []),
];

interface Props {
  open: boolean;
  onClose: () => void;
}

type LimitKey = 'localNormalMB' | 'localLargeMB' | 'remoteNormalMB' | 'remoteLargeMB' | 'ecoThresholdMB';

/** 용량(MB) 입력 — 입력 중엔 그대로 두고, 벗어날 때 범위를 맞춘다 */
function MbInput({ k, label }: { k: LimitKey; label: string }) {
  const value = useSettingsStore((s) => s[k]);
  const set = useSettingsStore((s) => s.set);
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    const max = k === 'ecoThresholdMB' ? 4096 : MAX_OPEN_MB;
    // eco 기준은 0(자동 해제 끔)도 허용
    const ok = Number.isFinite(n) && (n > 0 || (k === 'ecoThresholdMB' && n === 0));
    const v = ok ? Math.min(max, Math.round(n * 10) / 10) : value;
    set(k as keyof Settings, v as never);
    setText(String(v));
  };
  return (
    <div className={styles.field} style={{ width: 150 }}>
      <label className={styles.label}>{label}</label>
      <input
        type="number"
        min={0.1}
        max={MAX_OPEN_MB}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </div>
  );
}

/** 환경설정 > 파일 열기: 로컬/원격 일반·대용량 한도 */
function FileOpenLimits() {
  const s = useSettingsStore();
  const rows: { title: string; normal: LimitKey; large: LimitKey }[] = [
    { title: '로컬 파일', normal: 'localNormalMB', large: 'localLargeMB' },
    { title: '원격 파일 (SSH)', normal: 'remoteNormalMB', large: 'remoteLargeMB' },
  ];
  return (
    <>
      <div className={styles.hint}>
        <b>일반 파일 한도</b> 이하는 바로 편집기로 엽니다. <b>대용량 파일 한도</b> 이하는 확인 후 편집기로
        전체를 읽거나 보기 모드로 일부만 읽을 수 있고, 그보다 크면 보기 모드로만 엽니다.
        보기 모드는 파일 전체를 메모리에 올리지 않습니다. 바이너리 파일은 크기와 관계없이 Hex 보기를 묻습니다.
      </div>
      {rows.map((r) => (
        <div key={r.title}>
          <div className={styles.sectionTitle}>{r.title}</div>
          <div className={styles.row}>
            <MbInput k={r.normal} label="일반 파일 한도 (MB)" />
            <MbInput k={r.large} label="대용량 파일 한도 (MB)" />
          </div>
          {s[r.normal] > s[r.large] && (
            <div className={styles.error}>일반 파일 한도가 대용량 파일 한도보다 큽니다. 대용량 한도가 함께 적용됩니다.</div>
          )}
        </div>
      ))}
      <div className={styles.hint}>최대 {MAX_OPEN_MB}MB까지 지정할 수 있습니다.</div>

      <div className={styles.sectionTitle}>eco (메모리 절약)</div>
      <div className={styles.row}>
        <MbInput k="ecoThresholdMB" label="자동 해제 기준 (MB)" />
      </div>
      <div className={styles.hint}>
        열린 탭 내용의 합계가 이 값을 넘으면, 화면에 보이지 않고 저장할 변경이 없는 탭부터 오래 안 본 순서로
        메모리에서 해제합니다(탭에 eco 아이콘 표시). 탭을 다시 선택하면 파일에서 새로 읽으며, 이때 실행 취소 기록은
        사라집니다. 0이면 자동 해제를 끕니다. 탭 바의 eco 버튼으로 언제든 바로 해제할 수 있습니다.
      </div>
    </>
  );
}

/** Windows 탐색기 우클릭 메뉴(보관/보관 해제) 토글 — 상태는 레지스트리 기준 */
function ExplorerMenuToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    explorerMenuStatus().then(setOn).catch((e) => setError(String(e)));
  }, []);
  const toggle = async (enabled: boolean) => {
    setError('');
    try {
      await explorerMenuSet(enabled);
      setOn(await explorerMenuStatus());
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <>
      <label className={styles.assocGroupHead}>
        <input
          type="checkbox"
          checked={!!on}
          disabled={on === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>Windows 탐색기 우클릭 메뉴에 "보관/해제" 표시</span>
      </label>
      <div className={styles.hint}>
        Windows 11에서는 "더 많은 옵션 표시"(Shift+F10) 메뉴에 나타납니다.
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </>
  );
}

export default function SettingsDialog({ open, onClose }: Props) {
  const s = useSettingsStore();
  const [tab, setTab] = useState<SettingsTab>('appearance');
  const [newExt, setNewExt] = useState('');

  // 확장자 규칙은 이름순으로 고정 정렬 (수정할 때마다 순서가 튀지 않게)
  const extEntries = useMemo(
    () => Object.entries(s.indentByExt).sort(([a], [b]) => a.localeCompare(b)),
    [s.indentByExt]
  );

  const addExt = () => {
    const key = newExt.trim().toLowerCase().replace(/^[.*]+/, '');
    if (!key) return;
    s.setIndentRule(key, s.indentByExt[key] ?? s.indentDefault ?? DEFAULT_INDENT);
    setNewExt('');
  };

  // 변경 시 즉시 UI 폰트 반영
  useEffect(() => {
    applyUiFont({ uiFontFamily: s.uiFontFamily, uiFontSize: s.uiFontSize });
  }, [s.uiFontFamily, s.uiFontSize]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={`${styles.content} ${styles.settingsContent}`}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>환경설정</Dialog.Title>
            <Dialog.Close className={styles.closeBtn}>
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className={styles.tabBar}>
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className={`${styles.tabBtn} ${tab === id ? styles.tabActive : ''}`}
                onClick={() => setTab(id)}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          <div className={styles.form}>
            {tab === 'appearance' && (
              <>
                {/* 전역 테마 */}
                <div className={styles.sectionTitle}>전역 테마</div>
                <div className={styles.segGroup}>
                  {THEME_OPTS.map(({ mode, label, Icon }) => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.segBtn} ${s.theme === mode ? styles.segActive : ''}`}
                      onClick={() => s.set('theme', mode)}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.hint}>
                  서버·폴더별 테마(다크/라이트)는 하단 상태바의 테마 아이콘에서 설정할 수 있습니다.
                </div>

                {/* 색상 테마 */}
                <div className={styles.sectionTitle}>다크 테마</div>
                <ThemeChoices
                  list={DARK_THEMES}
                  value={s.darkTheme}
                  onPick={(id) => s.set('darkTheme', id)}
                />

                <div className={styles.sectionTitle}>라이트 테마</div>
                <ThemeChoices
                  list={LIGHT_THEMES}
                  value={s.lightTheme}
                  onPick={(id) => s.set('lightTheme', id)}
                />

                {/* 터미널 색상 테마 (에디터와 별개) */}
                <div className={styles.sectionTitle}>터미널 다크 테마</div>
                <ThemeChoices
                  list={DARK_THEMES}
                  value={s.terminalDarkTheme}
                  onPick={(id) => s.set('terminalDarkTheme', id)}
                />

                <div className={styles.sectionTitle}>터미널 라이트 테마</div>
                <ThemeChoices
                  list={LIGHT_THEMES}
                  value={s.terminalLightTheme}
                  onPick={(id) => s.set('terminalLightTheme', id)}
                />
              </>
            )}

            {tab === 'font' && (
              <>
                {/* 기본 UI 폰트 */}
                <div className={styles.sectionTitle}>기본 폰트 (UI)</div>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label className={styles.label}>폰트 패밀리 (sans-serif)</label>
                    <input
                      value={s.uiFontFamily}
                      onChange={(e) => s.set('uiFontFamily', e.target.value)}
                      placeholder={DEFAULT_UI_FONT}
                      style={{ fontFamily: s.uiFontFamily }}
                    />
                  </div>
                  <div className={styles.field} style={{ width: 90 }}>
                    <label className={styles.label}>크기 (px)</label>
                    <input
                      type="number"
                      min={9}
                      max={28}
                      value={s.uiFontSize}
                      onChange={(e) => s.set('uiFontSize', Number(e.target.value) || 13)}
                    />
                  </div>
                </div>

                {/* 에디터 폰트 */}
                <div className={styles.sectionTitle}>에디터 폰트 (monospace)</div>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label className={styles.label}>폰트 패밀리 (monospace)</label>
                    <input
                      value={s.editorFontFamily}
                      onChange={(e) => s.set('editorFontFamily', e.target.value)}
                      placeholder={DEFAULT_MONO_FONT}
                      style={{ fontFamily: s.editorFontFamily }}
                    />
                  </div>
                  <div className={styles.field} style={{ width: 90 }}>
                    <label className={styles.label}>크기 (px)</label>
                    <input
                      type="number"
                      min={9}
                      max={28}
                      value={s.editorFontSize}
                      onChange={(e) => s.set('editorFontSize', Number(e.target.value) || 14)}
                    />
                  </div>
                  <div className={styles.field} style={{ width: 90 }}>
                    <label className={styles.label}>줄 높이 (배수)</label>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      step={0.1}
                      value={s.editorLineHeight}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        s.set('editorLineHeight', v ? Math.min(3, Math.max(1, v)) : 1.5);
                      }}
                    />
                  </div>
                </div>

                <div
                  className={styles.preview}
                  style={{ fontFamily: s.editorFontFamily, fontSize: s.editorFontSize, lineHeight: s.editorLineHeight }}
                >
                  const greeting = "안녕하세요";  // 미리보기 0Oo1lI
                  <br />
                  return greeting;
                </div>

                {/* 터미널 폰트 (에디터와 별개) */}
                <div className={styles.sectionTitle}>터미널 폰트 (monospace)</div>
                <div className={styles.row}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label className={styles.label}>폰트 패밀리 (monospace)</label>
                    <input
                      value={s.terminalFontFamily}
                      onChange={(e) => s.set('terminalFontFamily', e.target.value)}
                      placeholder={DEFAULT_MONO_FONT}
                      style={{ fontFamily: s.terminalFontFamily }}
                    />
                  </div>
                  <div className={styles.field} style={{ width: 90 }}>
                    <label className={styles.label}>크기 (px)</label>
                    <input
                      type="number"
                      min={9}
                      max={28}
                      value={s.terminalFontSize}
                      onChange={(e) => s.set('terminalFontSize', Number(e.target.value) || 14)}
                    />
                  </div>
                </div>

                <div className={styles.preview} style={{ fontFamily: s.terminalFontFamily, fontSize: s.terminalFontSize }}>
                  user@host:~$ echo "안녕하세요"  0Oo1lI
                </div>
              </>
            )}

            {tab === 'indent' && (
              <>
              <div className={styles.sectionTitle}>기본 들여쓰기</div>
              <div className={styles.hint}>
                아래 확장자 목록에 없는 파일에 적용됩니다.
              </div>
              <div className={styles.indentGrid}>
                <IndentCell
                  label="(기본값)"
                  rule={s.indentDefault ?? DEFAULT_INDENT}
                  onChange={(r) => s.set('indentDefault', r)}
                />
              </div>

              <div className={styles.sectionTitle}>확장자별 들여쓰기</div>
              <div className={styles.hint}>
                파일 하나만 다르게 쓰려면 편집 창 하단 상태바의 들여쓰기 버튼을 사용하세요
                (해당 파일에만 저장됩니다).
              </div>
              <div className={styles.indentAdd}>
                <input
                  value={newExt}
                  onChange={(e) => setNewExt(e.target.value)}
                  placeholder="확장자 (예: ts, py, Makefile)"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addExt();
                    }
                  }}
                />
                <button type="button" className={styles.submitBtn} onClick={addExt}>
                  <Plus size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
                  추가
                </button>
              </div>
              <div className={styles.indentGrid}>
                {extEntries.map(([ext, rule]) => (
                  <IndentCell
                    key={ext}
                    label={ext}
                    rule={rule}
                    onChange={(r) => s.setIndentRule(ext, r)}
                    onRemove={() => s.setIndentRule(ext, null)}
                  />
                ))}
              </div>
              </>
            )}

            {tab === 'features' && (
              <>
                <div className={styles.sectionTitle}>로컬 파일 암복호화</div>
                <label className={styles.assocGroupHead}>
                  <input
                    type="checkbox"
                    checked={s.localCryptoEnabled}
                    onChange={(e) => {
                      s.set('localCryptoEnabled', e.target.checked);
                      // 기능을 끄면 탐색기 메뉴도 함께 제거
                      if (!e.target.checked && isFileAssocPlatform()) void explorerMenuSet(false).catch(() => {});
                    }}
                  />
                  <span>로컬에서 암복호화 기능 사용하기</span>
                </label>
                <div className={styles.hint}>
                  로컬 파일 트리에서 파일·폴더를 우클릭 → "보관/해제"로 처리합니다. 대상이 모두 보관된
                  파일이면 해제(복호화), 아니면 보관(암호화)합니다
                  (Ctrl/Cmd+클릭으로 여러 개 선택 · 한 번에 4개까지 · 루트·시스템 폴더 불가)
                  (ChaCha20, 비밀번호 기반). 파일 헤더에는 식별용 매직 값만 기록하고
                  알고리즘 정보는 기록하지 않습니다.
                </div>
                {s.localCryptoEnabled && (
                  <div className={styles.field}>
                    <label className={styles.label}>보관 파일 확장자</label>
                    <input
                      value={s.localCryptoExtension}
                      onChange={(e) => s.set('localCryptoExtension', e.target.value)}
                      placeholder="비워 두면 확장자 변경 없음"
                      style={{ width: 200 }}
                    />
                    <div className={styles.hint}>
                      보관 시 파일명 뒤에 붙이고(예: a.txt → a.txt.data), 보관 해제 시 제거합니다.
                      비워 두면 원본 파일을 제자리에서 교체합니다.
                    </div>
                  </div>
                )}
                {s.localCryptoEnabled && isFileAssocPlatform() && <ExplorerMenuToggle />}
              </>
            )}

            {tab === 'fileOpen' && <FileOpenLimits />}

            {tab === 'fileAssoc' && <FileAssocPanel />}

            <div className={styles.buttons}>
              {/* 파일 연결은 레지스트리에 즉시 반영되므로 '기본값' 초기화 대상이 아님 */}
              {tab !== 'fileAssoc' && (
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => {
                  s.reset();
                  applyUiFont({ uiFontFamily: DEFAULT_UI_FONT, uiFontSize: 13 });
                }}
              >
                <RotateCcw size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
                기본값
              </button>
              )}
              <button type="button" className={styles.submitBtn} onClick={onClose}>
                완료
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
