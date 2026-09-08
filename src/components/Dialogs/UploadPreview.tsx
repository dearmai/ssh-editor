import { useState } from 'react';
import type { UploadItem } from '../../types/uploads';
import { fileIconFor } from '../../utils/fileIcon';
import styles from './UploadPreview.module.css';

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  const unit = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 3);
  return `${(size / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

function ItemPreview({ item, overwrite }: { item: UploadItem; overwrite: boolean }) {
  const [failed, setFailed] = useState(false);
  const { Icon, color } = fileIconFor(item.name);
  const extension = item.name.includes('.') ? item.name.split('.').pop()?.toUpperCase() : '확장자 없음';
  if (item.thumbnail && !failed) {
    return <div className={styles.imageItem}>
      <img className={styles.thumbnail} src={item.thumbnail} alt={`${item.name} 미리보기`} onError={() => setFailed(true)} />
      <div className={styles.imageCaption}>
        <span className={styles.imageName} title={item.name}>{item.name}</span>
        <span className={styles.imageSize}>{formatSize(item.size)}</span>
      </div>
      {overwrite && <span className={styles.warning}>기존 파일을 덮어씁니다</span>}
    </div>;
  }
  return <div className={styles.item}>
    <Icon size={30} color={color} className={styles.icon} aria-hidden />
    <div className={styles.details}>
      <strong className={styles.name}>{item.name}</strong>
      <span className={styles.meta}>{extension} · {formatSize(item.size)} ({item.size.toLocaleString()} 바이트)</span>
      {overwrite && <span className={styles.warning}>기존 파일을 덮어씁니다</span>}
      {item.textPreview !== undefined && <pre className={styles.text}>{item.textPreview || '(빈 파일)'}</pre>}
      {item.textPreview !== undefined && item.size > 8192 && <span className={styles.meta}>파일 앞부분 미리보기</span>}
      {(!item.thumbnail || failed) && item.textPreview === undefined && <span className={styles.meta}>미리보기를 지원하지 않는 형식입니다</span>}
    </div>
  </div>;
}

export default function UploadPreview({ items, remoteDir, collisions }: {
  items: UploadItem[]; remoteDir: string; collisions: string[];
}) {
  const hasImages = items.some((item) => !!item.thumbnail);
  return <div className={styles.preview}>
    {!hasImages && <p><strong>{items.length}개 파일</strong>을 업로드할까요?</p>}
    <div className={hasImages ? styles.imageDestination : styles.destination} title={remoteDir}>
      {hasImages ? `${items.length}개 · ${remoteDir}` : <>업로드 위치 <strong>{remoteDir}</strong></>}
    </div>
    <div className={`${styles.list} ${hasImages ? styles.imageList : ''}`}>{items.map((item) => <ItemPreview key={item.name} item={item} overwrite={collisions.includes(item.name)} />)}</div>
  </div>;
}
