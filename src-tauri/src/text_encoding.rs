//! 텍스트 인코딩 판별·엄격한 변환. 표현할 수 없는 문자는 저장 전에 거부한다.
use crate::error::{AppError, AppResult};
use crate::ssh::{sftp, FileStat, SshConnectionPool};
use encoding_rs::{Encoding, EUC_KR, UTF_8};
use serde::Serialize;
use std::io::{Read, Write};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    text: String,
    encoding: String,
}

fn codec(name: &str) -> AppResult<&'static Encoding> {
    Ok(match name {
        "utf-8" | "utf-8-bom" => UTF_8,
        "cp949" => EUC_KR,
        _ => Encoding::for_label(name.as_bytes()).filter(|enc| !matches!(enc.name(), "replacement" | "UTF-16LE" | "UTF-16BE"))
            .ok_or_else(|| AppError::Other("지원하지 않는 인코딩입니다".into()))?,
    })
}

fn utf16(bytes: &[u8], little: bool) -> AppResult<String> {
    if bytes.len() % 2 != 0 { return Err(AppError::Other("UTF-16 바이트 수가 올바르지 않습니다".into())); }
    let words: Vec<u16> = bytes.chunks_exact(2).map(|b| {
        if little { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) }
    }).collect();
    String::from_utf16(&words).map_err(|_| AppError::Other("올바른 UTF-16 텍스트가 아닙니다".into()))
}

pub fn decode(bytes: &[u8], requested: Option<&str>) -> AppResult<TextFile> {
    if crate::local_crypto::is_sealed(bytes) { return Err(AppError::Other("보관된 파일은 먼저 보관 해제하세요".into())); }
    let name = requested.unwrap_or_else(|| {
        if bytes.starts_with(&[0xff, 0xfe]) { "utf-16le" }
        else if bytes.starts_with(&[0xfe, 0xff]) { "utf-16be" }
        else if bytes.starts_with(&[0xef, 0xbb, 0xbf]) { "utf-8-bom" }
        else if std::str::from_utf8(bytes).is_ok() { "utf-8" }
        else { "cp949" }
    });
    let text = match name {
        "ascii" | "iso-8859-1" => {
            if name == "ascii" && bytes.iter().any(|b| *b > 0x7f) {
                return Err(AppError::Other("ASCII로 읽을 수 없는 바이트가 있습니다".into()));
            }
            bytes.iter().map(|b| char::from(*b)).collect()
        }
        "utf-16le" => utf16(bytes.strip_prefix(&[0xff, 0xfe]).unwrap_or(bytes), true)?,
        "utf-16be" => utf16(bytes.strip_prefix(&[0xfe, 0xff]).unwrap_or(bytes), false)?,
        _ => {
            let codec = codec(name)?;
            let data = if name.starts_with("utf-8") { bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes) } else { bytes };
            codec.decode_without_bom_handling_and_without_replacement(data)
                .ok_or_else(|| AppError::Other("선택한 인코딩으로 읽을 수 없습니다. 다른 인코딩을 선택하세요".into()))?.into_owned()
        }
    };
    if text.contains('\0') { return Err(AppError::Other("바이너리 데이터가 섞여 있어 텍스트로 열 수 없습니다".into())); }
    Ok(TextFile { text, encoding: name.into() })
}

pub fn encode(text: &str, name: &str) -> AppResult<Vec<u8>> {
    if matches!(name, "ascii" | "iso-8859-1") {
        let max = if name == "ascii" { 0x7f } else { 0xff };
        return text.chars().map(|ch| {
            if ch as u32 <= max { Ok(ch as u8) }
            else { Err(AppError::Other("선택한 인코딩으로 표현할 수 없는 문자가 있습니다. 원본은 변경하지 않았습니다".into())) }
        }).collect();
    }
    if matches!(name, "utf-16le" | "utf-16be") {
        let little = name == "utf-16le";
        let mut bytes = if little { vec![0xff, 0xfe] } else { vec![0xfe, 0xff] };
        for word in text.encode_utf16() {
            bytes.extend_from_slice(&if little { word.to_le_bytes() } else { word.to_be_bytes() });
        }
        return Ok(bytes);
    }
    let (bytes, _, errors) = codec(name)?.encode(text);
    if errors { return Err(AppError::Other("선택한 인코딩으로 표현할 수 없는 문자가 있습니다. 원본은 변경하지 않았습니다".into())); }
    let mut result = if name == "utf-8-bom" { vec![0xef, 0xbb, 0xbf] } else { vec![] };
    result.extend_from_slice(&bytes);
    Ok(result)
}

/// UTF-16 BOM은 NUL이 있어도 텍스트로 열 수 있다.
pub fn has_utf16_bom(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff])
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(work).await.map_err(|e| AppError::Other(format!("인코딩 처리 실패: {e}")))?
}

#[tauri::command]
pub async fn text_read_file(session_id: String, path: String, limit: u64, encoding: Option<String>, pool: tauri::State<'_, SshConnectionPool>) -> AppResult<TextFile> {
    let limit = crate::file_view::clamp_limit(Some(limit));
    if session_id == "local" {
        return blocking(move || {
            let file = std::fs::File::open(&path)?;
            if !file.metadata()?.is_file() { return Err(AppError::Other("일반 파일이 아닙니다".into())); }
            let mut bytes = Vec::new();
            file.take(limit + 1).read_to_end(&mut bytes)?;
            if bytes.len() as u64 > limit { return Err(AppError::FileTooLarge { size: bytes.len() as u64 }); }
            decode(&bytes, encoding.as_deref())
        }).await;
    }
    let session = pool.get(&session_id)?;
    let bytes = sftp::read_bytes_limited(&session, &path, limit).await?;
    blocking(move || decode(&bytes, encoding.as_deref())).await
}

#[tauri::command]
pub async fn text_write_file(session_id: String, path: String, content: String, encoding: String, pool: tauri::State<'_, SshConnectionPool>) -> AppResult<FileStat> {
    // 변환 실패 시 로컬·원격 모두 파일을 열거나 자르기 전에 중단한다.
    let bytes = blocking(move || encode(&content, &encoding)).await?;
    if session_id != "local" {
        let session = pool.get(&session_id)?;
        return sftp::write_bytes(&session, &path, &bytes).await;
    }
    blocking(move || write_local(&path, &bytes)).await
}

fn write_local(path: &str, bytes: &[u8]) -> AppResult<FileStat> {
    let target = std::path::Path::new(path);
    let meta = match std::fs::metadata(target) {
        Ok(meta) => Some(meta),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    if meta.as_ref().is_some_and(|m| !m.is_file()) { return Err(AppError::Other("일반 파일이 아닙니다".into())); }
    let tmp = target.with_file_name(format!(".ssh-editor-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> AppResult<FileStat> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if let Some(meta) = &meta {
            std::fs::set_permissions(&tmp, meta.permissions())?;
            let current = std::fs::metadata(target)?;
            if current.len() != meta.len() || current.modified().ok() != meta.modified().ok() {
                return Err(AppError::Other("저장하는 동안 파일이 바뀌었습니다".into()));
            }
        } else if target.exists() {
            return Err(AppError::Other("저장하는 동안 같은 경로에 파일이 생겼습니다".into()));
        }
        std::fs::rename(&tmp, target)?;
        crate::local_files::local_stat(path.to_string())
    })();
    if result.is_err() { let _ = std::fs::remove_file(tmp); }
    result
}

#[tauri::command]
pub async fn text_encoded_lengths(texts: Vec<String>, encoding: String) -> AppResult<Vec<usize>> {
    blocking(move || {
        let bom = match encoding.as_str() { "utf-8-bom" => 3, "utf-16le" | "utf-16be" => 2, _ => 0 };
        texts.iter().map(|text| encode(text, &encoding).map(|b| b.len() - bom)).collect()
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn korean_and_bom_round_trips() {
        for name in ["utf-8", "utf-8-bom", "cp949", "utf-16le", "utf-16be"] {
            let bytes = encode("한글 확장 똠\r\nabc", name).unwrap();
            let file = decode(&bytes, None).unwrap();
            assert_eq!(file.text, "한글 확장 똠\r\nabc");
            assert_eq!(file.encoding, name);
        }
    }
    #[test]
    fn rejects_lossy_conversion_and_malformed_data() {
        assert!(encode("한글 😀", "cp949").is_err());
        assert!(decode(&[0xff], Some("utf-8")).is_err());
        assert!(decode(&[0xff, 0xfe, 0x00], None).is_err());
        assert!(decode(&[0xff, 0xfe, 0x00, 0xd8], None).is_err());
        assert!(decode(b"a\0b", None).is_err());
        assert!(encode("한글", "ascii").is_err());
        assert!(decode(&[0x80], Some("ascii")).is_err());
        assert_eq!(encode("é", "iso-8859-1").unwrap(), vec![0xe9]);
    }
    #[test]
    fn every_listed_encoding_is_supported() {
        let source = include_str!("../../src/utils/encodings.ts");
        let ids = regex::Regex::new("id: '([^']+)'").unwrap();
        for capture in ids.captures_iter(source) {
            let name = &capture[1];
            let bytes = encode("hello\r\nworld", name).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(decode(&bytes, Some(name)).unwrap().text, "hello\r\nworld", "{name}");
        }
    }
    #[test]
    fn local_conversion_replaces_file_and_creates_backups() {
        let path = std::env::temp_dir().join(format!("ssh-editor-encoding-{}", uuid::Uuid::new_v4()));
        let path = path.to_string_lossy().into_owned();
        let cp949 = encode("한글\r\n", "cp949").unwrap();
        write_local(&path, &cp949).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), cp949);
        let utf16 = encode("한글\r\n", "utf-16le").unwrap();
        let stat = write_local(&path, &utf16).unwrap();
        assert_eq!(stat.size, utf16.len() as u64);
        assert_eq!(decode(&std::fs::read(&path).unwrap(), None).unwrap().encoding, "utf-16le");
        std::fs::remove_file(path).unwrap();
    }
}
