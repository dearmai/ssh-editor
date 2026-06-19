import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X } from 'lucide-react';
import {
  applyUiFont,
  DEFAULT_MONO_FONT,
  DEFAULT_UI_FONT,
  useSettingsStore,
  type ThemeMode,
} from '../../stores/settingsStore';
import { useEffect } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
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

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: Props) {
  const s = useSettingsStore();

  // 변경 시 즉시 UI 폰트 반영
  useEffect(() => {
    applyUiFont({ uiFontFamily: s.uiFontFamily, uiFontSize: s.uiFontSize });
  }, [s.uiFontFamily, s.uiFontSize]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>환경설정</Dialog.Title>
            <Dialog.Close className={styles.closeBtn}>
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className={styles.form}>
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
            <div className={styles.sectionTitle}>에디터 / 터미널 폰트 (monospace)</div>
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
