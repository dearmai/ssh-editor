import { useLayoutEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { useTextStatsStore } from '../../stores/textStatsStore';
import type { TextStats } from '../../utils/textStats';
import { fitStatsItems } from '../../utils/textStats';
import styles from './TextStatsStatus.module.css';

const describe = (s: TextStats, bytes: number | null = s.bytes) => `${s.characters.toLocaleString()}자 · ${bytes == null ? '—' : bytes.toLocaleString()} bytes · ${s.words.toLocaleString()}단어`;

export default function TextStatsStatus() {
  const groupId = useEditorStore((s) => s.activeGroupId);
  const tab = useEditorStore((s) => {
    const id = s.groupsById[s.activeGroupId]?.activeTabId;
    return id ? s.tabsById[id] : undefined;
  });
  const stats = useTextStatsStore((s) => s.groups[groupId]);
  const root = useRef<HTMLDivElement>(null);
  const probes = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const valid = !!tab && stats?.tabId === tab.id && !tab.viewMode && !tab.unloaded && !tab.previewMode;
  const items = valid ? [
    ...(stats.selection ? [`선택 ${describe(stats.selection, stats.byteCounts?.selection)}`] : []),
    `${stats.lineNumber.toLocaleString()}행 ${describe(stats.line, stats.byteCounts?.line)}`,
    `${tab.segment ? '구간' : '파일'} ${describe(stats.file, stats.byteCounts?.file)}`,
  ] : [];
  const text = items.join(' / ');

  useLayoutEffect(() => {
    const el = root.current;
    const measure = probes.current;
    if (!el || !measure) return;
    const fit = () => {
      // 선택 통계는 공간이 부족해도 가장 먼저 유지한다.
      setCount(fitStatsItems(el.clientWidth, [...measure.children].map((child) => child.getBoundingClientRect().width), !!stats?.selection));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(el); observer.observe(measure);
    fit();
    return () => observer.disconnect();
  }, [text, stats?.selection]);

  return <div ref={root} className={styles.root} title={`${text}\n글자: 유니코드 코드 포인트(공백·줄바꿈 포함), 바이트: 현재 인코딩 기준(파일은 BOM 포함), 단어: 공백 기준. —는 계산 중이거나 변환할 수 없는 문자가 있음을 뜻합니다.`}>
    <div ref={probes} className={styles.probes} aria-hidden="true">{items.map((item, i) => <span className={styles.item} key={i}>{item}</span>)}</div>
    {items.slice(0, count).map((item, i) => <span className={styles.item} key={i}>{item}</span>)}
  </div>;
}
