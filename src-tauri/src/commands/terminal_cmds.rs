use crate::error::AppResult;
use crate::ssh::{terminal, SshConnectionPool, TerminalPool};
use tauri::{AppHandle, State};

/// CLI가 읽을 이미지를 저장할 전용 디렉토리. 기존 PTY에는 명령을 보내지 않는다.
#[tauri::command]
pub async fn terminal_prepare_upload(
    connection_id: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<String> {
    let session = pool.get(&connection_id)?;
    let path = format!("/tmp/ssh-editor-{}", uuid::Uuid::new_v4());
    let (_, status) = crate::ssh::run_command(
        &session,
        &format!("umask 077 && mkdir -- {}", crate::ssh::shell_quote(&path)),
    ).await?;
    if status != 0 {
        return Err(crate::error::AppError::Other("이미지 업로드 디렉토리를 만들지 못했습니다".into()));
    }
    Ok(path)
}

#[tauri::command]
pub async fn terminal_create(
    connection_id: String,
    cols: u32,
    rows: u32,
    app: AppHandle,
    pool: State<'_, SshConnectionPool>,
    terminal_pool: State<'_, TerminalPool>,
) -> AppResult<String> {
    terminal::create_terminal(app, &pool, &terminal_pool, &connection_id, cols, rows).await
}

#[tauri::command]
pub fn terminal_write(
    terminal_id: String,
    data: String,
    terminal_pool: State<'_, TerminalPool>,
) -> AppResult<()> {
    terminal::terminal_write(&terminal_pool, &terminal_id, &data)
}

#[tauri::command]
pub fn terminal_close(
    terminal_id: String,
    terminal_pool: State<'_, TerminalPool>,
) -> AppResult<()> {
    terminal::terminal_close(&terminal_pool, &terminal_id)
}

#[tauri::command]
pub async fn terminal_resize(
    terminal_id: String,
    cols: u32,
    rows: u32,
    pool: State<'_, SshConnectionPool>,
    terminal_pool: State<'_, TerminalPool>,
) -> AppResult<()> {
    terminal::terminal_resize(&pool, &terminal_pool, &terminal_id, cols, rows).await
}
