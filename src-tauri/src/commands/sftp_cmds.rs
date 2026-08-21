use crate::error::{AppError, AppResult};
use crate::ssh::{sftp, transfer, FileEntry, FileStat, ProbeResult, SshConnectionPool, TransferCancelState};
use base64::Engine;
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
pub async fn sftp_copy_path(
    session_id: String,
    from: String,
    to: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    sftp::copy_path(&session, &from, &to).await
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
pub async fn sftp_exists(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<bool> {
    let session = pool.get(&session_id)?;
    sftp::exists(&session, &path).await
}

#[tauri::command]
pub async fn sftp_check_write_access(
    session_id: String,
    path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<bool> {
    let session = pool.get(&session_id)?;
    sftp::check_write_access(&session, &path).await
}

/// 드래그 앤 드롭 업로드(청크) — 대용량 파일을 조각내어 여러 번 호출
#[tauri::command]
pub async fn sftp_upload_data_chunk(
    session_id: String,
    remote_path: String,
    data_b64: String,
    transfer_id: String,
    offset: u64,
    total: u64,
    is_last: bool,
    app: AppHandle,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| AppError::Other(format!("업로드 데이터 디코딩 실패: {}", e)))?;
    let session = pool.get(&session_id)?;
    transfer::upload_data_chunk(
        &app,
        &session,
        &data,
        &remote_path,
        &transfer_id,
        offset,
        total,
        is_last,
    )
    .await
}

/// 취소된 청크 업로드가 남긴 원격 부분 파일 정리
#[tauri::command]
pub async fn sftp_abort_upload_data(
    session_id: String,
    remote_path: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    transfer::abort_upload_data_chunk(&session, &remote_path).await
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
    cancels: State<'_, TransferCancelState>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    let flag = cancels.register(&transfer_id);
    let result = transfer::upload(&app, &session, &local_path, &remote_path, &transfer_id, &flag).await;
    cancels.clear(&transfer_id);
    result
}

#[tauri::command]
pub async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    app: AppHandle,
    pool: State<'_, SshConnectionPool>,
    cancels: State<'_, TransferCancelState>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    let flag = cancels.register(&transfer_id);
    let result =
        transfer::download_file(&app, &session, &remote_path, &local_path, &transfer_id, &flag).await;
    cancels.clear(&transfer_id);
    result
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
    cancels: State<'_, TransferCancelState>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    let flag = cancels.register(&transfer_id);
    let result = transfer::download_dir(
        &app,
        &session,
        &remote_path,
        &local_path,
        &format,
        &transfer_id,
        &flag,
    )
    .await;
    cancels.clear(&transfer_id);
    result
}

/// 진행 중인 전송 취소 요청 (다음 루프 확인 시점에 반영)
#[tauri::command]
pub fn transfer_cancel(transfer_id: String, cancels: State<'_, TransferCancelState>) {
    cancels.cancel(&transfer_id);
}
