use crate::error::AppResult;
use crate::ssh::{sftp, FileEntry, SshConnectionPool};
use tauri::State;

#[tauri::command]
pub async fn sftp_list_dir(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<Vec<FileEntry>> {
    let session = pool.get(&session_id)?;
    sftp::list_dir(&session, &path).await
}

#[tauri::command]
pub async fn sftp_read_file(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<String> {
    let session = pool.get(&session_id)?;
    sftp::read_file(&session, &path).await
}

#[tauri::command]
pub async fn sftp_write_file(
    session_id: String,
    path: String,
    content: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    sftp::write_file(&session, &path, &content).await
}

#[tauri::command]
pub async fn sftp_create_file(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    sftp::create_file(&session, &path).await
}

#[tauri::command]
pub async fn sftp_delete_path(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    sftp::delete_path(&session, &path).await
}

#[tauri::command]
pub async fn sftp_rename_path(
    session_id: String,
    from: String,
    to: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    sftp::rename_path(&session, &from, &to).await
}

#[tauri::command]
pub async fn sftp_create_dir(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    sftp::create_dir(&session, &path).await
}
