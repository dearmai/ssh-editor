use crate::error::{AppError, AppResult};
use crate::ssh::connection::{run_command, shell_quote};
use crate::ssh::SshSession;
use dashmap::DashMap;
use russh::ChannelMsg;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const CHUNK: usize = 64 * 1024;
const EMIT_INTERVAL_MS: u128 = 80;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub size: u64,
    pub is_binary: bool,
}

/// 전송 취소 플래그 레지스트리 (transferId → 취소 여부).
/// 각 전송 시작 시 `register`로 플래그를 받아 루프마다 확인하고,
/// 종료(성공/실패/취소) 시 `clear`로 정리한다.
pub struct TransferCancelState(DashMap<String, Arc<AtomicBool>>);

impl TransferCancelState {
    pub fn new() -> Self {
        Self(DashMap::new())
    }

    pub fn register(&self, id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.0.insert(id.to_string(), flag.clone());
        flag
    }

    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.0.get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    pub fn clear(&self, id: &str) {
        self.0.remove(id);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    id: String,
    transferred: u64,
    total: u64,
    status: String, // "active" | "done" | "canceled" | "error"
    error: Option<String>,
    speed: f64, // 바이트/초
}

fn emit_progress(
    app: &AppHandle,
    id: &str,
    transferred: u64,
    total: u64,
    status: &str,
    error: Option<String>,
    speed: f64,
) {
    let _ = app.emit(
        "transfer-progress",
        TransferProgress {
            id: id.to_string(),
            transferred,
            total,
            status: status.to_string(),
            error,
            speed,
        },
    );
}

/// 경과 시간 대비 전송량으로 순간 속도(바이트/초) 계산
fn calc_speed(bytes_since_last: u64, elapsed: std::time::Duration) -> f64 {
    let secs = elapsed.as_secs_f64();
    if secs > 0.0 {
        bytes_since_last as f64 / secs
    } else {
        0.0
    }
}

/// (parent, name) 분리
fn split_path(p: &str) -> (&str, &str) {
    match p.rfind('/') {
        Some(0) => ("/", &p[1..]),
        Some(i) => (&p[..i], &p[i + 1..]),
        None => (".", p),
    }
}

/// 파일 크기 + 바이너리 여부 (앞 8KB에 NUL 포함 여부로 판정)
pub async fn probe(session: &SshSession, path: &str) -> AppResult<ProbeResult> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    let meta = sftp.metadata(path).await?;
    let size = meta.size.unwrap_or(0);

    let mut file = sftp.open(path).await?;
    let mut buf = vec![0u8; 8192];
    let n = file.read(&mut buf).await.unwrap_or(0);
    let is_binary = buf[..n].contains(&0);

    Ok(ProbeResult { size, is_binary })
}

/// 로컬 → 원격 업로드
pub async fn upload(
    app: &AppHandle,
    session: &SshSession,
    local_path: &str,
    remote_path: &str,
    id: &str,
    cancel: &Arc<AtomicBool>,
) -> AppResult<()> {
    let total = tokio::fs::metadata(local_path).await?.len();
    let mut local = tokio::fs::File::open(local_path).await?;

    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;
    let mut remote = sftp.create(remote_path).await?;

    let mut buf = vec![0u8; CHUNK];
    let mut transferred = 0u64;
    let mut last_bytes = 0u64;
    let mut last = Instant::now();
    emit_progress(app, id, 0, total, "active", None, 0.0);

    loop {
        if cancel.load(Ordering::Relaxed) {
            remote.flush().await?;
            let _ = sftp.remove_file(remote_path).await;
            emit_progress(app, id, transferred, total, "canceled", None, 0.0);
            return Ok(());
        }
        let n = local.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        remote.write_all(&buf[..n]).await?;
        transferred += n as u64;
        if last.elapsed().as_millis() >= EMIT_INTERVAL_MS {
            let speed = calc_speed(transferred - last_bytes, last.elapsed());
            emit_progress(app, id, transferred, total, "active", None, speed);
            last = Instant::now();
            last_bytes = transferred;
        }
    }
    remote.flush().await?;
    emit_progress(app, id, transferred, total, "done", None, 0.0);
    Ok(())
}

/// 메모리 데이터 → 원격 업로드 (청크 단위).
/// 웹뷰 드롭 파일은 프론트에서 조각내어 여러 번 호출한다 — 파일 전체를
/// base64 문자열로 한 번에 만들면 대용량에서 RangeError(Out of memory) 발생.
/// offset==0 이면 새로 생성(TRUNCATE), 이후에는 APPEND 로 이어 쓴다.
pub async fn upload_data_chunk(
    app: &AppHandle,
    session: &SshSession,
    data: &[u8],
    remote_path: &str,
    id: &str,
    offset: u64,
    total: u64,
    is_last: bool,
) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    let flags = if offset == 0 {
        OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
    } else {
        OpenFlags::CREATE | OpenFlags::APPEND | OpenFlags::WRITE
    };
    let started = Instant::now();
    let mut remote = sftp.open_with_flags(remote_path, flags).await?;
    remote.write_all(data).await?;
    remote.flush().await?;

    let transferred = offset + data.len() as u64;
    let speed = calc_speed(data.len() as u64, started.elapsed());
    emit_progress(
        app,
        id,
        transferred,
        total,
        if is_last { "done" } else { "active" },
        None,
        speed,
    );
    Ok(())
}

/// 진행 중인 청크 업로드 취소 시 프론트가 호출 — 원격에 남은 부분 파일 정리
pub async fn abort_upload_data_chunk(session: &SshSession, remote_path: &str) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;
    let _ = sftp.remove_file(remote_path).await;
    Ok(())
}

/// 원격 파일 → 로컬 다운로드
pub async fn download_file(
    app: &AppHandle,
    session: &SshSession,
    remote_path: &str,
    local_path: &str,
    id: &str,
    cancel: &Arc<AtomicBool>,
) -> AppResult<()> {
    let sftp_guard = session.sftp.lock().await;
    let sftp = sftp_guard
        .as_ref()
        .ok_or_else(|| AppError::Other("SFTP 세션이 없습니다".to_string()))?;

    let total = sftp.metadata(remote_path).await?.size.unwrap_or(0);
    let mut remote = sftp.open(remote_path).await?;
    let mut local = tokio::fs::File::create(local_path).await?;

    let mut buf = vec![0u8; CHUNK];
    let mut transferred = 0u64;
    let mut last_bytes = 0u64;
    let mut last = Instant::now();
    emit_progress(app, id, 0, total, "active", None, 0.0);

    loop {
        if cancel.load(Ordering::Relaxed) {
            local.flush().await?;
            drop(local);
            let _ = tokio::fs::remove_file(local_path).await;
            emit_progress(app, id, transferred, total, "canceled", None, 0.0);
            return Ok(());
        }
        let n = remote.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        local.write_all(&buf[..n]).await?;
        transferred += n as u64;
        if last.elapsed().as_millis() >= EMIT_INTERVAL_MS {
            let speed = calc_speed(transferred - last_bytes, last.elapsed());
            emit_progress(app, id, transferred, total, "active", None, speed);
            last = Instant::now();
            last_bytes = transferred;
        }
    }
    local.flush().await?;
    emit_progress(app, id, transferred, total, "done", None, 0.0);
    Ok(())
}

/// 원격 디렉토리 → 아카이브(zip/tar.gz/tar.xz)로 다운로드.
/// 서버에서 /tmp 에 아카이브를 만든 뒤 스트리밍하고 정리한다.
pub async fn download_dir(
    app: &AppHandle,
    session: &SshSession,
    remote_path: &str,
    local_path: &str,
    format: &str,
    id: &str,
    cancel: &Arc<AtomicBool>,
) -> AppResult<()> {
    let (parent, name) = split_path(remote_path);
    let ext = match format {
        "zip" => "zip",
        "tarxz" => "tar.xz",
        _ => "tar.gz",
    };
    let tmp = format!("/tmp/sshe-{}.{}", id, ext);

    let build = match format {
        "zip" => format!(
            "cd {} && zip -qr {} {}",
            shell_quote(parent),
            shell_quote(&tmp),
            shell_quote(name)
        ),
        "tarxz" => format!(
            "tar cJf {} -C {} {}",
            shell_quote(&tmp),
            shell_quote(parent),
            shell_quote(name)
        ),
        _ => format!(
            "tar czf {} -C {} {}",
            shell_quote(&tmp),
            shell_quote(parent),
            shell_quote(name)
        ),
    };

    emit_progress(app, id, 0, 0, "active", None, 0.0);

    // 아카이브 생성
    let (out, code) = run_command(session, &build).await?;
    if code != 0 {
        let msg = String::from_utf8_lossy(&out);
        return Err(AppError::Other(format!("아카이브 생성 실패: {}", msg.trim())));
    }

    if cancel.load(Ordering::Relaxed) {
        let _ = run_command(session, &format!("rm -f {}", shell_quote(&tmp))).await;
        emit_progress(app, id, 0, 0, "canceled", None, 0.0);
        return Ok(());
    }

    // 크기 조회 (GNU stat || BSD stat)
    let (sz_out, _) = run_command(
        session,
        &format!(
            "stat -c %s {} 2>/dev/null || stat -f %z {}",
            shell_quote(&tmp),
            shell_quote(&tmp)
        ),
    )
    .await?;
    let total: u64 = String::from_utf8_lossy(&sz_out).trim().parse().unwrap_or(0);

    // 스트리밍
    let mut local = tokio::fs::File::create(local_path).await?;
    let mut transferred = 0u64;
    let mut canceled = false;
    {
        let handle = session.handle.lock().await;
        let mut channel = handle.channel_open_session().await?;
        let cat_cmd = format!("cat {}", shell_quote(&tmp));
        channel.exec(true, cat_cmd.as_str()).await?;

        let mut last = Instant::now();
        let mut last_bytes = 0u64;
        loop {
            if cancel.load(Ordering::Relaxed) {
                canceled = true;
                break;
            }
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    local.write_all(&data).await?;
                    transferred += data.len() as u64;
                    if last.elapsed().as_millis() >= EMIT_INTERVAL_MS {
                        let speed = calc_speed(transferred - last_bytes, last.elapsed());
                        emit_progress(app, id, transferred, total, "active", None, speed);
                        last = Instant::now();
                        last_bytes = transferred;
                    }
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {}
            }
        }
    }
    local.flush().await?;

    // 임시 파일 정리
    let _ = run_command(session, &format!("rm -f {}", shell_quote(&tmp))).await;

    if canceled {
        drop(local);
        let _ = tokio::fs::remove_file(local_path).await;
        emit_progress(app, id, transferred, total, "canceled", None, 0.0);
        return Ok(());
    }

    emit_progress(app, id, transferred, if total > 0 { total } else { transferred }, "done", None, 0.0);
    Ok(())
}
