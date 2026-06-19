import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import {
  effectiveTheme,
  folderScopeKey,
  serverScopeKey,
  useSettingsStore,
  type ThemeMode,
} from '../../stores/settingsStore';
import styles from './ThemePicker.module.css';

const MODE_ICON: Record<ThemeMode, typeof Moon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};
const MODE_LABEL: Record<ThemeMode, string> = {
  dark: '다크',
  light: '라이트',
  system: '시스템',
};

interface Props {
  profileId?: string;
  folderPath?: string;
  /** 트리거 버튼 스타일 변형 */
  variant?: 'statusbar' | 'inline';
}

export default function ThemePicker({ profileId, folderPath, variant = 'statusbar' }: Props) {
  const theme = useSettingsStore((s) => s.theme);
  const overrides = useSettingsStore((s) => s.themeOverrides);
  const setGlobal = useSettingsStore((s) => s.set);
  const setOverride = useSettingsStore((s) => s.setThemeOverride);

  const resolved = effectiveTheme({ theme, themeOverrides: overrides }, profileId, folderPath);
  const TriggerIcon = resolved === 'dark' ? Moon : Sun;

  const srvKey = profileId ? serverScopeKey(profileId) : null;
  const dirKey = profileId && folderPath ? folderScopeKey(profileId, folderPath) : null;

  const renderModes = (
    current: ThemeMode | undefined,
    onPick: (m: ThemeMode | null) => void,
    allowInherit: boolean
  ) => (
    <>
      {allowInherit && (
        <DropdownMenu.Item className={styles.item} onSelect={() => onPick(null)}>
          <span className={styles.check}>{current === undefined && <Check size={13} />}</span>
          <span className={styles.mIcon} />
          상속
        </DropdownMenu.Item>
      )}
      {(['system', 'dark', 'light'] as ThemeMode[]).map((m) => {
        const MIcon = MODE_ICON[m];
        return (
          <DropdownMenu.Item key={m} className={styles.item} onSelect={() => onPick(m)}>
            <span className={styles.check}>{current === m && <Check size={13} />}</span>
            <MIcon size={13} className={styles.mIcon} />
            {MODE_LABEL[m]}
          </DropdownMenu.Item>
        );
      })}
    </>
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={variant === 'statusbar' ? styles.statusTrigger : styles.inlineTrigger}
          title="테마 전환"
        >
          <TriggerIcon size={variant === 'statusbar' ? 12 : 14} />
          {variant === 'inline' && <span>테마</span>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.content} sideOffset={4} align="end">
          {dirKey && (
            <>
              <div className={styles.section}>이 폴더</div>
              {renderModes(overrides[dirKey], (m) => setOverride(dirKey, m), true)}
              <DropdownMenu.Separator className={styles.sep} />
            </>
          )}
          {srvKey && (
            <>
              <div className={styles.section}>이 서버</div>
              {renderModes(overrides[srvKey], (m) => setOverride(srvKey, m), true)}
              <DropdownMenu.Separator className={styles.sep} />
            </>
          )}
          <div className={styles.section}>전역</div>
          {renderModes(theme, (m) => setGlobal('theme', m ?? 'system'), false)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
