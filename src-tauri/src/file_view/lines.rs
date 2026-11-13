//! 대용량 로컬 텍스트: 희소 줄 색인 · 줄 단위 읽기 · 구간 편집(읽기/끼워 저장)
//!
//! 줄 색인은 EVERY(1,000)줄마다 줄 시작 바이트 위치만 기록한다 — 1천만 줄이어도 약 80KB.
//! 임의의 줄 n 은 `offsets[n / EVERY]` 에서 `n % EVERY` 줄을 건너뛰어 읽는다.

use super::{blocking, open_regular};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

pub const EVERY: u64 = 1000;
/// 한 줄 표시 상한 — 넘으면 잘라서 보여 준다
const MAX_LINE_BYTES: usize = 16 * 1024;
/// 줄 읽기 1회 응답 상한
const MAX_READ_BYTES: usize = 2 * 1024 * 1024;
/// 구간 편집 상한
pub const MAX_SEGMENT_BYTES: u64 = 16 * 1024 * 1024;

fn mtime_ms(meta: &std::fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineIndex {
    pub size: u64,
    pub mtime: Option<u64>,
    /// [0, size) 안의 줄바꿈 개수
    pub newlines: u64,
    /// 전체 줄 수 (마지막 줄에 줄바꿈이 없어도 한 줄로 센다)
    pub total: u64,
    pub every: u64,
    /// 새로 찾은 색인 지점 — 줄 k*EVERY 의 시작 위치 (처음부터 만들면 줄 0 의 0 포함)
    pub offsets: Vec<u64>,
}

/// 줄 색인 생성. from=(이전 크기, 이전 줄바꿈 수)면 늘어난 부분만 이어서 센다 (tail 용)
fn build_index(path: &str, from: Option<(u64, u64)>) -> AppResult<LineIndex> {
    let (mut file, size) = open_regular(path)?;
    let meta = file.metadata()?;
    let (mut pos, mut newlines) = match from {
        Some((off, nl)) if off <= size => (off, nl),
        _ => (0, 0),
    };
    let mut offsets = if pos == 0 { vec![0] } else { vec![] };
    file.seek(SeekFrom::Start(pos))?;
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        for i in memchr::memchr_iter(b'\n', &buf[..n]) {
            newlines += 1;
            if newlines % EVERY == 0 {
                offsets.push(pos + i as u64 + 1);
            }
        }
        pos += n as u64;
    }
    let ends_with_newline = if size == 0 {
        true
    } else {
        file.seek(SeekFrom::Start(size - 1))?;
        let mut last = [0u8; 1];
        file.read_exact(&mut last)?;
        last[0] == b'\n'
    };
    Ok(LineIndex {
        size,
        mtime: mtime_ms(&meta),
        newlines,
        total: newlines + u64::from(!ends_with_newline),
        every: EVERY,
        offsets,
    })
}

#[tauri::command]
pub async fn local_line_index(path: String, from_offset: Option<u64>, from_newlines: Option<u64>) -> AppResult<LineIndex> {
    blocking(move || build_index(&path, from_offset.zip(from_newlines))).await
}

/// 줄 하나를 건너뛴다 (줄이 아무리 길어도 버퍼만큼만 사용) → 소비한 바이트 수
fn skip_line(r: &mut impl BufRead) -> std::io::Result<u64> {
    let mut used = 0u64;
    loop {
        let buf = r.fill_buf()?;
        if buf.is_empty() {
            return Ok(used);
        }
        match memchr::memchr(b'\n', buf) {
            Some(i) => {
                r.consume(i + 1);
                return Ok(used + i as u64 + 1);
            }
            None => {
                let n = buf.len();
                r.consume(n);
                used += n as u64;
            }
        }
    }
}

/// 줄 하나를 최대 `cap` 바이트까지만 담아 읽는다 → (내용, 소비한 바이트, 잘렸는지)
fn read_line_capped(r: &mut impl BufRead, cap: usize) -> std::io::Result<(Vec<u8>, u64, bool)> {
    let mut out = Vec::new();
    let mut used = 0u64;
    let mut cut = false;
    loop {
        let buf = r.fill_buf()?;
        if buf.is_empty() {
            return Ok((out, used, cut));
        }
        let (take, done) = match memchr::memchr(b'\n', buf) {
            Some(i) => (i + 1, true),
            None => (buf.len(), false),
        };
        let room = cap.saturating_sub(out.len());
        if take > room {
            cut = true;
        }
        out.extend_from_slice(&buf[..take.min(room)]);
        r.consume(take);
        used += take as u64;
        if done {
            return Ok((out, used, cut));
        }
    }
}

fn reader_at(path: &str, anchor: u64) -> AppResult<(BufReader<File>, u64)> {
    let (mut file, size) = open_regular(path)?;
    file.seek(SeekFrom::Start(anchor.min(size)))?;
    Ok((BufReader::with_capacity(256 * 1024, file), size))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lines {
    /// 줄바꿈을 뗀 줄 내용 (너무 긴 줄은 잘림 표시)
    pub lines: Vec<String>,
    /// 다음 줄의 시작 위치 — 응답 상한으로 덜 읽었을 때 여기서 이어 읽는다
    pub next_offset: u64,
    pub eof: bool,
}

/// anchor(색인 지점)에서 skip 줄을 건너뛴 뒤 최대 count 줄을 읽는다
fn read_lines(path: &str, anchor: u64, skip: u64, count: u64) -> AppResult<Lines> {
    let (mut r, size) = reader_at(path, anchor)?;
    let mut pos = anchor.min(size);
    for _ in 0..skip {
        let n = skip_line(&mut r)?;
        if n == 0 {
            break;
        }
        pos += n;
    }
    let mut lines = Vec::new();
    let mut bytes = 0usize;
    while (lines.len() as u64) < count && bytes < MAX_READ_BYTES {
        let (raw, used, cut) = read_line_capped(&mut r, MAX_LINE_BYTES)?;
        if used == 0 {
            break;
        }
        pos += used;
        bytes += raw.len();
        let mut s = String::from_utf8_lossy(&raw).into_owned();
        if s.ends_with('\n') {
            s.pop();
            if s.ends_with('\r') {
                s.pop();
            }
        }
        if cut {
            s.push_str(" … (줄이 너무 길어 일부만 표시)");
        }
        lines.push(s);
    }
    Ok(Lines { lines, next_offset: pos, eof: pos >= size })
}

#[tauri::command]
pub async fn local_read_lines(path: String, anchor: u64, skip: u64, count: u64) -> AppResult<Lines> {
    blocking(move || read_lines(&path, anchor, skip, count.min(5000))).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub text: String,
    /// 원본에서의 바이트 구간 [start, end)
    pub start: u64,
    pub end: u64,
    /// 실제로 읽은 줄 수 (크기 상한에 걸리면 요청보다 적다)
    pub lines: u64,
    pub size: u64,
    pub mtime: Option<u64>,
}

/// 편집할 구간을 줄 단위로 읽는다. 원본 그대로 되써야 하므로 UTF-8 이 아니면 거부한다.
fn read_segment(path: &str, anchor: u64, skip: u64, count: u64, max_bytes: u64) -> AppResult<Segment> {
    let meta = std::fs::metadata(path)?;
    let (mut r, size) = reader_at(path, anchor)?;
    let mut start = anchor.min(size);
    for _ in 0..skip {
        let n = skip_line(&mut r)?;
        if n == 0 {
            break;
        }
        start += n;
    }
    let max_bytes = max_bytes.clamp(1024, MAX_SEGMENT_BYTES) as usize;
    let mut raw = Vec::new();
    let mut lines = 0u64;
    while lines < count {
        let before = raw.len();
        // 남은 용량 + 1 까지 읽어 넘쳤는지 판단
        let (chunk, used, cut) = read_line_capped(&mut r, max_bytes - before + 1)?;
        if used == 0 {
            break;
        }
        if cut || before + chunk.len() > max_bytes {
            if lines == 0 {
                return Err(AppError::Other("한 줄이 편집 구간 한도보다 길어 편집할 수 없습니다".into()));
            }
            break;
        }
        raw.extend_from_slice(&chunk);
        lines += 1;
    }
    if raw.contains(&0) {
        return Err(AppError::Other("바이너리 데이터가 섞여 있어 편집할 수 없습니다".into()));
    }
    let end = start + raw.len() as u64;
    let text = String::from_utf8(raw)
        .map_err(|_| AppError::Other("UTF-8 텍스트가 아닌 구간은 편집할 수 없습니다".into()))?;
    Ok(Segment { text, start, end, lines, size, mtime: mtime_ms(&meta) })
}

#[tauri::command]
pub async fn local_read_segment(path: String, anchor: u64, skip: u64, count: u64, max_bytes: u64) -> AppResult<Segment> {
    blocking(move || read_segment(&path, anchor, skip, count, max_bytes)).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentSaved {
    /// 저장 후 이 구간의 새 끝 위치
    pub end: u64,
    pub size: u64,
    pub mtime: Option<u64>,
}

/// 원본의 [start, end) 를 content 로 바꿔 끼운다.
/// 앞부분 복사 → content → 뒷부분 복사를 같은 폴더 임시 파일에 흘려 쓴 뒤 원본과 교체한다
/// (메모리는 구간 크기만큼만 사용). 그사이 원본이 바뀌었으면 거부한다.
fn write_segment(path: &str, start: u64, end: u64, content: &str, expect_size: u64, expect_mtime: Option<u64>) -> AppResult<SegmentSaved> {
    let meta = std::fs::metadata(path)?;
    if meta.len() != expect_size || (expect_mtime.is_some() && mtime_ms(&meta) != expect_mtime) {
        return Err(AppError::Other(
            "편집을 시작한 뒤 파일이 바뀌었습니다. 구간을 다시 열어 편집하세요".into(),
        ));
    }
    if start > end || end > expect_size {
        return Err(AppError::Other("편집 구간이 파일 범위를 벗어났습니다".into()));
    }
    let src_path = Path::new(path);
    let tmp = src_path.with_file_name(format!(
        ".{}.{}.tmp",
        src_path.file_name().unwrap_or_default().to_string_lossy(),
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| -> AppResult<()> {
        let mut src = File::open(path)?;
        let mut out = std::io::BufWriter::with_capacity(1 << 20, File::create(&tmp)?);
        std::io::copy(&mut (&mut src).take(start), &mut out)?;
        out.write_all(content.as_bytes())?;
        src.seek(SeekFrom::Start(end))?;
        std::io::copy(&mut src, &mut out)?;
        let file = out.into_inner().map_err(|e| AppError::Io(e.into_error()))?;
        file.sync_all()?;
        drop(file);
        drop(src);
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
        // 큰 파일을 복사하는 동안 원본이 바뀌었으면 임시 파일로 덮어쓰지 않는다.
        let current = std::fs::metadata(path)?;
        if current.len() != meta.len() || current.modified().ok() != meta.modified().ok() {
            return Err(AppError::Other(
                "저장하는 동안 파일이 바뀌었습니다. 구간을 다시 열어 편집하세요".into(),
            ));
        }
        std::fs::rename(&tmp, path)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    let after = std::fs::metadata(path)?;
    Ok(SegmentSaved { end: start + content.len() as u64, size: after.len(), mtime: mtime_ms(&after) })
}

#[tauri::command]
pub async fn local_write_segment(
    path: String,
    start: u64,
    end: u64,
    content: String,
    expect_size: u64,
    expect_mtime: Option<u64>,
) -> AppResult<SegmentSaved> {
    blocking(move || write_segment(&path, start, end, &content, expect_size, expect_mtime)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(content: &str) -> String {
        let p = std::env::temp_dir().join(format!("ssh-editor-lines-{}", uuid::Uuid::new_v4()));
        std::fs::write(&p, content).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn sample(n: u64) -> String {
        (0..n).map(|i| format!("줄 {i}\n")).collect()
    }

    #[test]
    fn index_and_read_any_line() {
        let content = sample(2_500);
        let path = temp(&content);
        let idx = build_index(&path, None).unwrap();
        assert_eq!((idx.total, idx.offsets.len()), (2_500, 3)); // 줄 0, 1000, 2000
        assert!(content[idx.offsets[2] as usize..].starts_with("줄 2000\n"));
        // 줄 2345 = 색인 2 에서 345줄 건너뛰기
        let r = read_lines(&path, idx.offsets[2], 345, 3).unwrap();
        assert_eq!(r.lines, vec!["줄 2345", "줄 2346", "줄 2347"]);
        let last = read_lines(&path, idx.offsets[2], 499, 10).unwrap();
        assert_eq!((last.lines.len(), last.eof), (1, true));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn incremental_index_matches_full() {
        let path = temp(&sample(1_500));
        let first = build_index(&path, None).unwrap();
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(sample(1_000).as_bytes()).unwrap();
        let more = build_index(&path, Some((first.size, first.newlines))).unwrap();
        let full = build_index(&path, None).unwrap();
        let merged: Vec<u64> = first.offsets.iter().chain(more.offsets.iter()).copied().collect();
        assert_eq!(merged, full.offsets);
        assert_eq!(more.total, full.total);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn no_trailing_newline_and_long_line() {
        let path = temp(&format!("a\n{}\nend", "x".repeat(40_000)));
        let idx = build_index(&path, None).unwrap();
        assert_eq!(idx.total, 3);
        let r = read_lines(&path, 0, 0, 10).unwrap();
        assert_eq!(r.lines.len(), 3);
        assert!(r.lines[1].ends_with("일부만 표시)"));
        assert_eq!(r.lines[2], "end");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn segment_edit_splices_in_place() {
        let content = sample(3_000);
        let path = temp(&content);
        let idx = build_index(&path, None).unwrap();
        // 줄 1000~1004 편집
        let seg = read_segment(&path, idx.offsets[1], 0, 5, 1 << 20).unwrap();
        assert_eq!(seg.text, "줄 1000\n줄 1001\n줄 1002\n줄 1003\n줄 1004\n");
        let edited = "바뀐 줄\n";
        let saved = write_segment(&path, seg.start, seg.end, edited, seg.size, seg.mtime).unwrap();
        let now = std::fs::read_to_string(&path).unwrap();
        let expected = format!("{}{}{}", &content[..seg.start as usize], edited, &content[seg.end as usize..]);
        assert_eq!(now, expected);
        assert_eq!(saved.end, seg.start + edited.len() as u64);
        // 원본이 바뀐 뒤(크기 다름) 저장은 거부
        assert!(write_segment(&path, seg.start, saved.end, "x", seg.size, seg.mtime).is_err());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn segment_rejects_same_size_external_change() {
        let path = temp("first\r\nsecond\r\nthird\r\n");
        let seg = read_segment(&path, 0, 1, 1, 1024).unwrap();
        std::fs::write(&path, "FIRST\r\nsecond\r\nthird\r\n").unwrap();
        // 파일시스템 시각 정밀도와 무관하게 같은 크기의 변경을 재현한다.
        let file = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(
            UNIX_EPOCH + std::time::Duration::from_millis(seg.mtime.unwrap() + 2000),
        )).unwrap();
        assert!(write_segment(&path, seg.start, seg.end, "changed\r\n", seg.size, seg.mtime).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "FIRST\r\nsecond\r\nthird\r\n");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn segment_repeated_save_preserves_surrounding_crlf() {
        let path = temp("앞\r\n중간\r\n뒤\r\n");
        let seg = read_segment(&path, 0, 1, 1, 1024).unwrap();
        let saved = write_segment(&path, seg.start, seg.end, "수정\r\n추가\r\n", seg.size, seg.mtime).unwrap();
        write_segment(&path, seg.start, saved.end, "다시\r\n", saved.size, saved.mtime).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "앞\r\n다시\r\n뒤\r\n");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn segment_respects_byte_limit_and_utf8() {
        let path = temp(&sample(1_000)); // 약 9KB
        let seg = read_segment(&path, 0, 0, 1_000, 1024).unwrap();
        assert!(seg.lines < 1_000 && seg.text.len() <= 1024 && seg.text.ends_with('\n'));
        std::fs::write(&path, [b'a', b'\n', 0xff, 0xfe, b'\n']).unwrap();
        assert!(read_segment(&path, 0, 0, 10, 1024).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
