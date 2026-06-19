use crate::error::{AppError, AppResult};
use crate::ssh::connection::{run_command, shell_quote};
use crate::ssh::SshSession;
use russh::ChannelMsg;
use serde::Serialize;
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    id: String,
    transferred: u64,
    total: u64,
    status: String, // "active" | "done" | "error"
    error: Option<String>,
}

fn emit_progress(
    app: &AppHandle,
    id: &str,
    transferred: u64,
    total: u64,
    status: &str,
    error: Option<String>,
) {
    let _ = app.emit(
        "transfer-progress",
        TransferProgress {
            id: id.to_string(),
            transferred,
            total,
            status: status.to_string(),
            error,
        },
    );
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
    let mut last = Instant::now();
    emit_progress(app, id, 0, total, "active", None);

    loop {
        let n = local.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        remote.write_all(&buf[..n]).await?;
        transferred += n as u64;
        if last.elapsed().as_millis() >= EMIT_INTERVAL_MS {
            emit_progress(app, id, transferred, total, "active", None);
            last = Instant::now();
        }
    }
    remote.flush().await?;
    emit_progress(app, id, transferred, total, "done", None);
    Ok(())
}

/// 원격 파일 → 로컬 다운로드
pub async fn download_file(
    app: &AppHandle,
    session: &SshSession,
    remote_path: &str,
    local_path: &str,
    id: &str,
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
    let mut last = Instant::now();
    emit_progress(app, id, 0, total, "active", None);

    loop {
        let n = remote.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        local.write_all(&buf[..n]).await?;
        transferred += n as u64;
        if last.elapsed().as_millis() >= EMIT_INTERVAL_MS {
            emit_progress(app, id, transferred, total, "active", None);
            last = Instant::now();
        }
    }
    local.flush().await?;
    emit_progress(app, id, transferred, total, "done", None);
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

    emit_progress(app, id, 0, 0, "active", None);

    // 아카이브 생성
    let (out, code) = run_command(session, &build).await?;
    if code != 0 {
        let msg = String::from_utf8_lossy(&out);
        return Err(AppError::Other(format!("아카이브 생성 실패: {}", msg.trim())));
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
    {
        let handle = session.handle.lock().await;
        let mut channel = handle.channel_open_session().await?;
        let cat_cmd = format!("cat {}", shell_quote(&tmp));
        channel.exec(true, cat_cmd.as_str()).await?;

        let mut last = Instant::now();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    local.write_all(&data).await?;
                    transferred += data.len() as u64;
                    if last.elapsed().as_millis() >= EMIT_INTERVAL_MS {
                        emit_progress(app, id, transferred, total, "active", None);
                        last = Instant::now();
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

    emit_progress(app, id, transferred, if total > 0 { total } else { transferred }, "done", None);
    Ok(())
}
