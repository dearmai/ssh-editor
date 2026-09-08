import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { useIndent } from '../../hooks/useIndent';
import { useEditorStore } from '../../stores/editorStore';
import { useIndentStore } from '../../stores/indentStore';
import { TAB_SIZES } from '../../utils/indent';
import styles from './IndentStatus.module.css';

/**
 * 상태바의 들여쓰기 표시 + 변경 메뉴.
 * 여기서 바꾼 값은 "이 파일 전용" 오버라이드로 localStorage(indentStore)에 저장된다.
 * 확장자별 기본 규칙은 환경설정 > 들여쓰기에서 관리한다.
 */
export default function IndentStatus() {
  const activeTab = useEditorStore((s) => {
    const g = s.groupsById[s.activeGroupId];
    const id = g?.activeTabId;
    return id ? s.tabsById[id] : undefined;
  });
  const setFileIndent = useIndentStore((s) => s.setFileIndent);
  const clearFileIndent = useIndentStore((s) => s.clearFileIndent);

  const { rule, source, fileKey, extKey } = useIndent(
    activeTab?.connectionId,
    activeTab?.remotePath
  );

  if (!activeTab) return null;

  const label = `${rule.insertSpaces ? '공백' : '탭'}: ${rule.tabSize}`;
  const sourceText =
    source === 'file'
      ? '이 파일 전용 설정'
      : source === 'ext'
        ? '확장자 규칙'
        : '기본값';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={styles.statusBtn} title={`들여쓰기 — ${sourceText}`}>
          {source === 'file' && <span className={styles.overrideDot} />}
          {label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.menu} side="top" align="end" sideOffset={4}>
          <div className={styles.menuLabel}>들여쓰기 방식</div>
          {[
            { spaces: true, text: '공백 (Soft Tab)' },
            { spaces: false, text: '탭 문자 (Hard Tab)' },
          ].map((opt) => (
            <DropdownMenu.Item
              key={String(opt.spaces)}
              className={styles.item}
              onSelect={() => setFileIndent(fileKey, { ...rule, insertSpaces: opt.spaces })}
            >
              {opt.text}
              {rule.insertSpaces === opt.spaces && <Check size={13} className={styles.itemCheck} />}
            </DropdownMenu.Item>
          ))}

          <div className={styles.separator} />
          <div className={styles.menuLabel}>크기</div>
          {TAB_SIZES.map((size) => (
            <DropdownMenu.Item
              key={size}
              className={styles.item}
              onSelect={() => setFileIndent(fileKey, { ...rule, tabSize: size })}
            >
              {size}칸
              {rule.tabSize === size && <Check size={13} className={styles.itemCheck} />}
            </DropdownMenu.Item>
          ))}

          <div className={styles.separator} />
          <div className={styles.source}>
            현재 값 출처: {sourceText}
            {source === 'ext' && (
              <>
                {' '}
                (<span className={styles.sourceKey}>.{extKey}</span>)
              </>
            )}
          </div>
          <DropdownMenu.Item
            className={styles.item}
            disabled={source !== 'file'}
            onSelect={() => clearFileIndent(fileKey)}
          >
            이 파일 설정 지우기
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
