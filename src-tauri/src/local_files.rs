use crate::error::{AppError, AppResult};
use crate::ssh::{FileEntry, FileStat};
use std::{io::Read, path::Path, sync::Mutex, time::UNIX_EPOCH};

pub struct PendingFiles(pub Mutex<Vec<String>>);

pub fn cli_files(args: impl IntoIterator<Item = String>) -> Vec<String> {
    let args: Vec<_> = args.into_iter().collect();
    if args.first().is_some_and(|a| a == "--profile") {
        return vec![];
    }
    args.into_iter()
        .filter_map(|arg| {
            if arg.starts_with('-') {
                return None;
            }
            let path = if arg.starts_with("file://") {
                tauri::Url::parse(&arg).ok()?.to_file_path().ok()?
            } else {
                std::path::PathBuf::from(arg)
            };
            // SSH targets and platform launch flags are not local files.
            path.is_file()
                .then(|| path.canonicalize().ok())
                .flatten()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        })
        .collect()
}

#[tauri::command]
pub fn take_open_files(state: tauri::State<'_, PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

fn stat(path: &str) -> AppResult<FileStat> {
    let meta = std::fs::metadata(path)?;
    Ok(FileStat {
        size: meta.len(),
        mtime: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64),
    })
}

#[tauri::command]
pub fn local_stat(path: String) -> AppResult<FileStat> {
    stat(&path)
}

#[tauri::command]
pub fn local_read_file(path: String) -> AppResult<String> {
    const LIMIT: u64 = 16 * 1024 * 1024;
    if !std::fs::metadata(&path)?.is_file() {
        return Err(AppError::Other("일반 파일이 아닙니다".into()));
    }
    let file = std::fs::File::open(&path)?;
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > LIMIT {
        return Err(AppError::FileTooLarge {
            size: bytes.len() as u64,
        });
    }
    if bytes.contains(&0) {
        return Err(AppError::Other(
            "바이너리 파일은 텍스트로 열 수 없습니다".into(),
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| AppError::Other("UTF-8 텍스트 파일만 열 수 있습니다".into()))
}

#[tauri::command]
pub fn local_write_file(path: String, content: String) -> AppResult<FileStat> {
    std::fs::write(&path, content)?;
    stat(&path)
}

#[tauri::command]
pub fn local_list_dir(path: String) -> AppResult<Vec<FileEntry>> {
    let mut entries = Vec::new();
    for item in std::fs::read_dir(Path::new(&path))? {
        let item = item?;
        let Ok(meta) = std::fs::metadata(item.path()) else {
            continue;
        };
        if !meta.is_file() && !meta.is_dir() {
            continue;
        }
        entries.push(FileEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: item.path().to_string_lossy().replace('\\', "/"),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
            permissions: None,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_files_and_urls_but_not_ssh_targets_or_directories() {
        let path = std::env::temp_dir().join(format!("ssh editor-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, "안녕하세요").unwrap();
        let url = tauri::Url::from_file_path(&path).unwrap().to_string();
        let result = cli_files(vec![
            path.to_string_lossy().into_owned(),
            url,
            "user@host:/tmp/a".into(),
            "--flag".into(),
        ]);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], result[1]);
        assert!(cli_files(vec!["--profile".into(), "test".into(), result[0].clone()]).is_empty());
        assert_eq!(local_read_file(result[0].clone()).unwrap(), "안녕하세요");
        let updated = local_write_file(result[0].clone(), "수정된 내용".into()).unwrap();
        assert_eq!(updated.size, "수정된 내용".len() as u64);
        assert_eq!(local_read_file(result[0].clone()).unwrap(), "수정된 내용");
        let entries =
            local_list_dir(path.parent().unwrap().to_string_lossy().into_owned()).unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.path == result[0] && !entry.is_dir));
        std::fs::write(&path, [0xff, 0xfe]).unwrap();
        assert!(local_read_file(result[0].clone()).is_err());
        std::fs::write(&path, [0, 1, 2]).unwrap();
        assert!(local_read_file(result[0].clone()).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
