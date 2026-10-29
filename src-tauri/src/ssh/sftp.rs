use crate::error::{AppError, AppResult};
use crate::ssh::connection::{run_command, shell_quote};
use crate::ssh::shell_fs;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size: u64,
    pub mtime: Option<u64>,
}

pub async fn list_dir(session: &SshSession, path: &str) -> AppResult<Vec<FileEntry>> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        let tool = *session.stat_tool.lock().await;
        let mut result = shell_fs::list_dir(session, tool, path).await?;
        sort_entries(&mut result);
        return Ok(result);
    };

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

    sort_entries(&mut result);
    Ok(result)
}

/// 폴더 우선, 이름 대소문자 무시 정렬
fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

fn decode_text(content: Vec<u8>) -> AppResult<String> {
    String::from_utf8(content)
        .map_err(|_| AppError::Other("바이너리 파일은 편집할 수 없습니다".to_string()))
}

pub async fn read_file(session: &SshSession, path: &str) -> AppResult<String> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        let tool = *session.stat_tool.lock().await;
        let size = shell_fs::stat(session, tool, path).await?.size;
        if size > MAX_FILE_SIZE {
            return Err(AppError::FileTooLarge { size });
        }
        return decode_text(shell_fs::read_bytes(session, path).await?);
    };

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
    decode_text(content)
}

pub async fn stat(session: &SshSession, path: &str) -> AppResult<FileStat> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        let tool = *session.stat_tool.lock().await;
        return shell_fs::stat(session, tool, path).await;
    };

    let m = sftp.metadata(path).await?;
    Ok(FileStat {
        size: m.size.unwrap_or(0),
        mtime: m.mtime.map(|t| t as u64),
    })
}

pub async fn write_file(session: &SshSession, path: &str, content: &str) -> AppResult<FileStat> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        shell_fs::write_bytes(session, path, content.as_bytes(), false).await?;
        let tool = *session.stat_tool.lock().await;
        return shell_fs::stat(session, tool, path).await;
    };

    let mut file = sftp.create(path).await?;
    file.write_all(content.as_bytes()).await?;
    file.flush().await?;
    drop(file);

    let m = sftp.metadata(path).await?;
    Ok(FileStat {
        size: m.size.unwrap_or(0),
        mtime: m.mtime.map(|t| t as u64),
    })
}

pub async fn create_file(session: &SshSession, path: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        return shell_fs::create_file(session, path).await;
    };

    let mut file = sftp.create(path).await?;
    file.flush().await?;
    Ok(())
}

pub async fn delete_path(session: &SshSession, path: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        return shell_fs::delete_path(session, path).await;
    };

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
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        return shell_fs::rename_path(session, from, to).await;
    };

    sftp.rename(from, to).await?;
    Ok(())
}

/// 경로 복사(파일/디렉토리 모두, 재귀). 원격 셸의 `cp -a` 사용 —
/// SFTP 만으로는 디렉토리 재귀 복사를 클라이언트가 직접 순회해야 해 대용량에서 느림.
pub async fn copy_path(session: &SshSession, from: &str, to: &str) -> AppResult<()> {
    let (out, code) = run_command(
        session,
        &format!("cp -a {} {}", shell_quote(from), shell_quote(to)),
    )
    .await?;
    if code != 0 {
        let msg = String::from_utf8_lossy(&out);
        return Err(AppError::Other(format!("복사 실패: {}", msg.trim())));
    }
    Ok(())
}

/// 경로 존재 여부 (업로드/이동 전 이름 충돌 사전 점검용)
pub async fn exists(session: &SshSession, path: &str) -> AppResult<bool> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        return shell_fs::exists(session, path).await;
    };

    Ok(sftp.metadata(path).await.is_ok())
}

/// 실효 쓰기 권한 확인. 디렉토리는 항목 접근을 위한 실행 권한도 필요하다.
pub async fn check_write_access(session: &SshSession, dir: &str) -> AppResult<bool> {
    let q = shell_quote(dir);
    let (_, code) = run_command(session, &format!("test -w {q} && {{ ! test -d {q} || test -x {q}; }}")).await?;
    Ok(code == 0)
}

pub async fn create_dir(session: &SshSession, path: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let Some(sftp) = sftp_guard.as_ref() else {
        drop(sftp_guard);
        return shell_fs::create_dir(session, path).await;
    };

    sftp.create_dir(path).await?;
    Ok(())
}
