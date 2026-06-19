use crate::error::AppResult;
use crate::ssh::{sftp, transfer, FileEntry, FileStat, ProbeResult, SshConnectionPool};
use tauri::{AppHandle, State};

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
) -> AppResult<FileStat> {
    let session = pool.get(&session_id)?;
    sftp::write_file(&session, &path, &content).await
}

#[tauri::command]
pub async fn sftp_stat(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<FileStat> {
    let session = pool.get(&session_id)?;
    sftp::stat(&session, &path).await
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

#[tauri::command]
pub async fn sftp_probe(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<ProbeResult> {
    let session = pool.get(&session_id)?;
    transfer::probe(&session, &path).await
}

#[tauri::command]
pub async fn sftp_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    app: AppHandle,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    transfer::upload(&app, &session, &local_path, &remote_path, &transfer_id).await
}

#[tauri::command]
pub async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    app: AppHandle,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    transfer::download_file(&app, &session, &remote_path, &local_path, &transfer_id).await
}

#[tauri::command]
pub async fn sftp_download_dir(
    session_id: String,
    remote_path: String,
    local_path: String,
    format: String,
    transfer_id: String,
    app: AppHandle,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    transfer::download_dir(&app, &session, &remote_path, &local_path, &format, &transfer_id).await
}
