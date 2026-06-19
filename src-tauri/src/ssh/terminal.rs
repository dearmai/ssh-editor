use crate::error::{AppError, AppResult};
use crate::ssh::SshConnectionPool;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use dashmap::DashMap;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedSender};

pub struct TerminalSession {
    pub id: String,
    pub connection_id: String,
    pub stdin_tx: UnboundedSender<Vec<u8>>,
}

pub struct TerminalPool {
    pub sessions: DashMap<String, TerminalSession>,
}

impl TerminalPool {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalDataEvent {
    terminal_id: String,
    data: String,
}

pub async fn create_terminal(
    app: AppHandle,
    pool: &SshConnectionPool,
    terminal_pool: &TerminalPool,
    connection_id: &str,
    cols: u32,
    rows: u32,
) -> AppResult<String> {
    let session = pool.get(connection_id)?;
    let terminal_id = uuid::Uuid::new_v4().to_string();

    let handle = session.handle.lock().await;
    let mut channel = handle.channel_open_session().await?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await?;
    channel.request_shell(false).await?;

    let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let tid = terminal_id.clone();
    let app_clone = app.clone();

    // 단일 태스크에서 stdin/stdout 모두 처리
    tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(data) = stdin_rx.recv() => {
                    if channel.data(data.as_slice()).await.is_err() {
                        break;
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let encoded = BASE64.encode(&data[..]);
                            let _ = app_clone.emit(
                                "terminal-data",
                                TerminalDataEvent {
                                    terminal_id: tid.clone(),
                                    data: encoded,
                                },
                            );
                        }
                        Some(ChannelMsg::ExitStatus { .. }) | None => break,
                        _ => {}
                    }
                }
            }
        }
    });

    terminal_pool.sessions.insert(
        terminal_id.clone(),
        TerminalSession {
            id: terminal_id.clone(),
            connection_id: connection_id.to_string(),
            stdin_tx,
        },
    );

    Ok(terminal_id)
}

pub fn terminal_write(pool: &TerminalPool, terminal_id: &str, data_b64: &str) -> AppResult<()> {
    let session = pool
        .sessions
        .get(terminal_id)
        .ok_or_else(|| AppError::TerminalNotFound { id: terminal_id.to_string() })?;

    let data = BASE64
        .decode(data_b64)
        .map_err(|e| AppError::Other(format!("Base64 디코드 실패: {}", e)))?;
    session
        .stdin_tx
        .send(data)
        .map_err(|e| AppError::Other(format!("stdin 전송 실패: {}", e)))?;
    Ok(())
}

pub fn terminal_close(pool: &TerminalPool, terminal_id: &str) -> AppResult<()> {
    pool.sessions
        .remove(terminal_id)
        .ok_or_else(|| AppError::TerminalNotFound { id: terminal_id.to_string() })?;
    Ok(())
}

pub async fn terminal_resize(
    _ssh_pool: &SshConnectionPool,
    terminal_pool: &TerminalPool,
    terminal_id: &str,
    _cols: u32,
    _rows: u32,
) -> AppResult<()> {
    // TODO: PTY window-change 요청 (채널 참조 보관이 필요함)
    let _ = terminal_pool
        .sessions
        .get(terminal_id)
        .ok_or_else(|| AppError::TerminalNotFound { id: terminal_id.to_string() })?;
    Ok(())
}
