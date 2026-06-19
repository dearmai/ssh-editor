use crate::error::AppResult;
use crate::ssh::{terminal, SshConnectionPool, TerminalPool};
use tauri::{AppHandle, State};

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
