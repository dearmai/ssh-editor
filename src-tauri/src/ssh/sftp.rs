use crate::error::{AppError, AppResult};
use crate::ssh::SshSession;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
    pub permissions: Option<u32>,
}

pub async fn list_dir(session: &SshSession, path: &str) -> AppResult<Vec<FileEntry>> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    let entries = sftp.read_dir(path).await?;
    let mut result: Vec<FileEntry> = entries
        .into_iter()
        .filter(|e| e.file_name() != "." && e.file_name() != "..")
        .map(|e| {
            let attrs = e.metadata();
            let is_dir = attrs.is_dir();
            let name = e.file_name().to_string();
            let full_path = if path.ends_with('/') {
                format!("{}{}", path, name)
            } else {
                format!("{}/{}", path, name)
            };
            FileEntry {
                name,
                path: full_path,
                is_dir,
                size: attrs.size.unwrap_or(0),
                modified: attrs.mtime.map(|t| t as u64),
                permissions: attrs.permissions,
            }
        })
        .collect();

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

pub async fn read_file(session: &SshSession, path: &str) -> AppResult<String> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    // 크기 먼저 확인
    let stat = sftp.metadata(path).await?;
    if let Some(size) = stat.size {
        if size > MAX_FILE_SIZE {
            return Err(AppError::FileTooLarge { size });
        }
    }

    let mut file = sftp.open(path).await?;
    let mut content = Vec::new();
    file.read_to_end(&mut content).await?;

    String::from_utf8(content)
        .map_err(|_| AppError::Other("바이너리 파일은 편집할 수 없습니다".to_string()))
}

pub async fn write_file(session: &SshSession, path: &str, content: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    let mut file = sftp.create(path).await?;
    file.write_all(content.as_bytes()).await?;
    file.flush().await?;
    Ok(())
}

pub async fn create_file(session: &SshSession, path: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    let mut file = sftp.create(path).await?;
    file.flush().await?;
    Ok(())
}

pub async fn delete_path(session: &SshSession, path: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    let stat = sftp.metadata(path).await?;
    if stat.is_dir() {
        sftp.remove_dir(path).await?;
    } else {
        sftp.remove_file(path).await?;
    }
    Ok(())
}

pub async fn rename_path(session: &SshSession, from: &str, to: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    sftp.rename(from, to).await?;
    Ok(())
}

pub async fn create_dir(session: &SshSession, path: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    sftp.create_dir(path).await?;
    Ok(())
}
