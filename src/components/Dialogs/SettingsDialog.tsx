import * as Dialog from '@radix-ui/react-dialog';
import { Indent, Palette, Plus, RotateCcw, Type, X } from 'lucide-react';
import {
  applyUiFont,
  DEFAULT_MONO_FONT,
  DEFAULT_UI_FONT,
  useSettingsStore,
  type ThemeMode,
} from '../../stores/settingsStore';
import { useMemo, useState, useEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { DEFAULT_INDENT, TAB_SIZES, type IndentRule } from '../../utils/indent';
import { DARK_THEMES, LIGHT_THEMES, type ColorTheme } from '../../themes';
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

type SettingsTab = 'appearance' | 'font' | 'indent';

const TABS: { id: SettingsTab; label: string; Icon: typeof Type }[] = [
  { id: 'appearance', label: '테마', Icon: Palette },
  { id: 'font', label: '폰트', Icon: Type },
  { id: 'indent', label: '들여쓰기', Icon: Indent },
];

interface Props {
  open: boolean;
  onClose: () => void;
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
                </div>

                <div className={styles.preview} style={{ fontFamily: s.editorFontFamily, fontSize: s.editorFontSize }}>
                  const greeting = "안녕하세요";  // 미리보기 0Oo1lI
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

            <div className={styles.buttons}>
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
