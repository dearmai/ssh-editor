use crate::error::{AppError, AppResult};
use crate::ssh::SshConnectionPool;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use dashmap::DashMap;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedSender};

/// PTY 채널 태스크로 보내는 명령. 채널 자체는 태스크가 소유하므로 명령으로 전달한다.
pub enum PtyCommand {
    /// stdin 바이트 전송
    Data(Vec<u8>),
    /// 창 크기 변경 (window-change 요청)
    Resize { cols: u32, rows: u32 },
}

/// PTY 채널로 명령을 보내는 핸들. 세션 id는 `TerminalPool.sessions`의 키가 대신한다.
pub struct TerminalSession {
    pub cmd_tx: UnboundedSender<PtyCommand>,
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

    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<PtyCommand>();
    let tid = terminal_id.clone();
    let app_clone = app.clone();

    // 단일 태스크에서 stdin/stdout 모두 처리
    tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(cmd) = cmd_rx.recv() => {
                    match cmd {
                        PtyCommand::Data(data) => {
                            if channel.data(data.as_slice()).await.is_err() {
                                break;
                            }
                        }
                        PtyCommand::Resize { cols, rows } => {
                            // 픽셀 크기는 0(미지정) — 원격은 문자 단위 cols/rows를 사용
                            if channel.window_change(cols, rows, 0, 0).await.is_err() {
                                break;
                            }
                        }
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

    terminal_pool
        .sessions
        .insert(terminal_id.clone(), TerminalSession { cmd_tx });

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
        .cmd_tx
        .send(PtyCommand::Data(data))
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
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let session = terminal_pool
        .sessions
        .get(terminal_id)
        .ok_or_else(|| AppError::TerminalNotFound { id: terminal_id.to_string() })?;
    session
        .cmd_tx
        .send(PtyCommand::Resize { cols, rows })
        .map_err(|e| AppError::Other(format!("리사이즈 전송 실패: {}", e)))?;
    Ok(())
}
