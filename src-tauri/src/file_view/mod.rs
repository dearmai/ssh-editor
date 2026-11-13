//! 대용량·바이너리 파일 보기 — 파일 전체를 메모리에 올리지 않고 구간만 읽는다.
//!
//! - 텍스트 보기(로컬): `local_read_text` 로 줄 경계에 맞춘 구간, `local_search` 로 흘려 읽으며 검색
//! - Hex 보기(로컬/원격): `local_read_bytes` / `sftp_read_bytes` 로 바이트 구간

use crate::error::{AppError, AppResult};
use crate::ssh::{run_command, sftp, shell_quote, ProbeResult, SshConnectionPool};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::State;

mod lines;
pub use lines::*;

/// 편집기로 전체를 읽을 수 있는 최대 크기 (설정값 상한)
pub const MAX_OPEN_LIMIT: u64 = 512 * 1024 * 1024;
const DEFAULT_OPEN_LIMIT: u64 = 16 * 1024 * 1024;
/// 한 번에 읽는 구간 상한 (텍스트·바이트 공통)
const MAX_CHUNK: u64 = 4 * 1024 * 1024;
/// 텍스트 구간을 줄 경계에 맞출 때 앞뒤로 살펴보는 범위
const ALIGN_SCAN: usize = 64 * 1024;
const SEARCH_MAX_HITS: usize = 200;
const SEARCH_PREVIEW: usize = 240;

pub fn clamp_limit(limit: Option<u64>) -> u64 {
    limit.unwrap_or(DEFAULT_OPEN_LIMIT).clamp(1024, MAX_OPEN_LIMIT)
}

fn open_regular(path: &str) -> AppResult<(File, u64)> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(AppError::Other("일반 파일이 아닙니다".into()));
    }
    Ok((File::open(path)?, meta.len()))
}

fn read_at(file: &mut File, offset: u64, len: u64) -> AppResult<Vec<u8>> {
    file.seek(SeekFrom::Start(offset))?;
    let mut buf = Vec::with_capacity(len as usize);
    file.take(len).read_to_end(&mut buf)?;
    Ok(buf)
}

/// 앞부분 8KB로 바이너리 여부 판별 (원격 sftp_probe 와 같은 기준: NUL 포함)
#[tauri::command]
pub fn local_probe(path: String) -> AppResult<ProbeResult> {
    let (mut file, size) = open_regular(&path)?;
    let head = read_at(&mut file, 0, 8192)?;
    let is_binary = (head.contains(&0) && !crate::text_encoding::has_utf16_bom(&head)) || crate::local_crypto::is_sealed(&head);
    Ok(ProbeResult { size, is_binary })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChunk {
    pub text: String,
    /// 실제로 읽은 구간 [start, end) — 줄 경계에 맞춰 요청과 다를 수 있다
    pub start: u64,
    pub end: u64,
    pub size: u64,
}

/// `[offset, offset+len)` 구간을 읽어 앞뒤를 줄 경계(없으면 UTF-8 문자 경계)에 맞춘다
fn align_text(buf: &[u8], offset: u64, size: u64) -> (usize, usize) {
    let mut from = 0;
    if offset > 0 {
        // 앞쪽: 잘린 줄은 버리고 다음 줄부터
        match buf.iter().take(ALIGN_SCAN).position(|&b| b == b'\n') {
            Some(i) => from = i + 1,
            None => from = buf.iter().take(4).position(|&b| b & 0xC0 != 0x80).unwrap_or(0),
        }
    }
    let mut to = buf.len();
    if offset + (buf.len() as u64) < size {
        // 뒤쪽: 마지막 줄바꿈까지 (줄이 너무 길면 UTF-8 문자 경계까지)
        let tail_from = buf.len().saturating_sub(ALIGN_SCAN).max(from);
        match buf[tail_from..].iter().rposition(|&b| b == b'\n') {
            Some(i) => to = tail_from + i + 1,
            None => {
                let mut t = buf.len();
                for back in 1..=4.min(buf.len() - from) {
                    let b = buf[buf.len() - back];
                    if b & 0xC0 == 0xC0 {
                        // 다바이트 문자의 시작 바이트 — 필요한 길이가 모자라면 그 앞에서 자른다
                        let need = if b >= 0xF0 { 4 } else if b >= 0xE0 { 3 } else { 2 };
                        if back < need {
                            t = buf.len() - back;
                        }
                        break;
                    }
                    if b & 0x80 == 0 {
                        break;
                    }
                }
                to = t;
            }
        }
    }
    (from, to.max(from))
}

#[tauri::command]
pub async fn local_read_text(path: String, offset: u64, len: u64) -> AppResult<TextChunk> {
    blocking(move || {
        let (mut file, size) = open_regular(&path)?;
        let offset = offset.min(size);
        let buf = read_at(&mut file, offset, len.clamp(1, MAX_CHUNK))?;
        let (from, to) = align_text(&buf, offset, size);
        Ok(TextChunk {
            text: String::from_utf8_lossy(&buf[from..to]).into_owned(),
            start: offset + from as u64,
            end: offset + to as u64,
            size,
        })
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BytesChunk {
    /// base64 인코딩된 바이트
    pub data: String,
    pub offset: u64,
    pub size: u64,
}

#[tauri::command]
pub async fn local_read_bytes(path: String, offset: u64, len: u64) -> AppResult<BytesChunk> {
    blocking(move || {
        let (mut file, size) = open_regular(&path)?;
        let offset = offset.min(size);
        let buf = read_at(&mut file, offset, len.clamp(1, MAX_CHUNK))?;
        Ok(BytesChunk { data: STANDARD.encode(buf), offset, size })
    })
    .await
}

/// 원격 파일의 바이트 구간 (SFTP 미지원 서버도 동작하도록 셸 명령 사용)
#[tauri::command]
pub async fn sftp_read_bytes(
    session_id: String,
    path: String,
    offset: u64,
    len: u64,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<BytesChunk> {
    let session = pool.get(&session_id)?;
    let size = sftp::stat(&session, &path).await?.size;
    let offset = offset.min(size);
    let len = len.clamp(1, MAX_CHUNK);
    let cmd = format!("tail -c +{} -- {} | head -c {}", offset + 1, shell_quote(&path), len);
    let (bytes, _) = run_command(&session, &cmd).await?;
    Ok(BytesChunk { data: STANDARD.encode(bytes), offset, size })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// 1부터 시작하는 줄 번호
    pub line: u64,
    /// 그 줄이 시작하는 바이트 위치 (보기 화면 이동용)
    pub offset: u64,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// 최대 개수에 도달해 중단했는지
    pub truncated: bool,
}

/// 1MB 단위로 흘려 읽으며 검색한다 (줄이 아무리 길어도 메모리는 고정)
fn search_file(path: &str, query: &str, ignore_case: bool) -> AppResult<SearchResult> {
    if query.is_empty() {
        return Ok(SearchResult { hits: vec![], truncated: false });
    }
    let re = regex::bytes::RegexBuilder::new(&regex::escape(query))
        .case_insensitive(ignore_case)
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let (mut file, _) = open_regular(path)?;
    let overlap = query.len().saturating_sub(1);
    let mut chunk = vec![0u8; 1 << 20];
    let mut window: Vec<u8> = Vec::new();
    let mut base: u64 = 0; // window[0] 의 파일 위치
    let mut line: u64 = 1; // window[0] 이 속한 줄 번호
    let mut line_start: u64 = 0; // window[0] 이 속한 줄의 시작 위치
    let mut last_hit_line = 0;
    let mut hits = Vec::new();
    loop {
        let n = file.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        window.extend_from_slice(&chunk[..n]);
        let mut cursor = 0usize; // 줄 번호를 센 위치
        for m in re.find_iter(&window) {
            for (i, &b) in window[cursor..m.start()].iter().enumerate() {
                if b == b'\n' {
                    line += 1;
                    line_start = base + (cursor + i) as u64 + 1;
                }
            }
            cursor = m.start();
            if line == last_hit_line {
                continue; // 한 줄에 하나만
            }
            last_hit_line = line;
            let ls = line_start.saturating_sub(base) as usize;
            let from = ls.max(m.start().saturating_sub(SEARCH_PREVIEW / 2));
            let to = window[m.start()..]
                .iter()
                .take(SEARCH_PREVIEW)
                .position(|&b| b == b'\n')
                .map_or((m.start() + SEARCH_PREVIEW).min(window.len()), |i| m.start() + i);
            hits.push(SearchHit {
                line,
                offset: line_start,
                text: String::from_utf8_lossy(&window[from..to]).trim_end_matches('\r').to_string(),
            });
            if hits.len() >= SEARCH_MAX_HITS {
                return Ok(SearchResult { hits, truncated: true });
            }
        }
        // 다음 구간과 겹치게 끝부분만 남긴다 (경계에 걸친 일치 대비)
        let keep_from = window.len().saturating_sub(overlap);
        for (i, &b) in window[cursor..keep_from.max(cursor)].iter().enumerate() {
            if b == b'\n' {
                line += 1;
                line_start = base + (cursor + i) as u64 + 1;
            }
        }
        let keep_from = keep_from.max(cursor);
        base += keep_from as u64;
        window.drain(..keep_from);
    }
    Ok(SearchResult { hits, truncated: false })
}

#[tauri::command]
pub async fn local_search(path: String, query: String, ignore_case: bool) -> AppResult<SearchResult> {
    blocking(move || search_file(&path, &query, ignore_case)).await
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(content: &[u8]) -> String {
        let p = std::env::temp_dir().join(format!("ssh-editor-view-{}", uuid::Uuid::new_v4()));
        std::fs::write(&p, content).unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn text_chunks_align_to_lines() {
        let content = "첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n";
        let path = temp(content.as_bytes());
        let rt = tokio::runtime::Runtime::new().unwrap();
        // 중간(둘째 줄 안)부터 읽으면 셋째 줄부터 시작해야 함
        let c = rt.block_on(local_read_text(path.clone(), 14, 20)).unwrap();
        assert!(c.text.starts_with("셋째"), "{:?}", c.text);
        assert!(c.text.ends_with('\n'));
        assert_eq!(&content.as_bytes()[c.start as usize..c.end as usize], c.text.as_bytes());
        // 처음부터 끝까지
        let all = rt.block_on(local_read_text(path.clone(), 0, 1 << 20)).unwrap();
        assert_eq!(all.text, content);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn utf8_boundary_without_newline() {
        let content = "가나다라마바사".repeat(10); // 줄바꿈 없음, 3바이트 문자
        let (from, to) = align_text(&content.as_bytes()[..10], 0, content.len() as u64);
        assert_eq!((from, to), (0, 9)); // 10번째 바이트는 잘린 문자 → 제외
    }

    #[test]
    fn search_counts_lines_across_chunks() {
        let mut content = String::new();
        for i in 1..=50_000 {
            content.push_str(&format!("line {i} {}\n", if i % 10_000 == 0 { "NEEDLE" } else { "hay" }));
        }
        let path = temp(content.as_bytes());
        let r = search_file(&path, "needle", true).unwrap();
        assert_eq!(r.hits.iter().map(|h| h.line).collect::<Vec<_>>(), vec![10_000, 20_000, 30_000, 40_000, 50_000]);
        for h in &r.hits {
            assert!(content[h.offset as usize..].starts_with(&format!("line {} NEEDLE", h.line)));
        }
        assert!(search_file(&path, "needle", false).unwrap().hits.is_empty());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn probe_and_bytes() {
        let path = temp(&[0x7f, b'E', b'L', b'F', 0, 1, 2]);
        assert!(local_probe(path.clone()).unwrap().is_binary);
        let rt = tokio::runtime::Runtime::new().unwrap();
        let c = rt.block_on(local_read_bytes(path.clone(), 4, 100)).unwrap();
        assert_eq!(STANDARD.decode(c.data).unwrap(), vec![0, 1, 2]);
        assert_eq!((c.offset, c.size), (4, 7));
        std::fs::remove_file(path).unwrap();
    }
}
