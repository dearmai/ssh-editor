use crate::config::ConnectionProfile;
use crate::error::{AppError, AppResult};
use dashmap::DashMap;
use russh::client;
use russh::client::AuthResult;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct SshClientHandler;

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SshSession {
    pub id: String,
    pub profile: ConnectionProfile,
    pub handle: Mutex<client::Handle<SshClientHandler>>,
    pub sftp: Mutex<Option<SftpSession>>,
}

pub struct SshConnectionPool {
    pub sessions: DashMap<String, Arc<SshSession>>,
}

impl SshConnectionPool {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    pub fn get(&self, id: &str) -> AppResult<Arc<SshSession>> {
        self.sessions
            .get(id)
            .map(|r| r.value().clone())
            .ok_or_else(|| AppError::ConnectionNotFound { id: id.to_string() })
    }
}

async fn try_publickey_auth(
    handle: &mut client::Handle<SshClientHandler>,
    username: &str,
    key_path: &std::path::Path,
) -> AppResult<bool> {
    let key = russh::keys::load_secret_key(key_path, None)
        .map_err(|e| AppError::Config(format!("키 로드 실패 {:?}: {}", key_path, e)))?;
    let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), None);
    let result = handle
        .authenticate_publickey(username, key_with_hash)
        .await?;
    Ok(matches!(result, AuthResult::Success))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingInfo {
    /// 서버 UTC epoch (초)
    pub epoch: i64,
    /// 서버 타임존 오프셋 (분)
    pub tz_offset_minutes: i32,
    /// 왕복 지연 (ms)
    pub ping_ms: u64,
}

/// SSH exec로 `date`를 실행해 서버 시각과 왕복 지연(ping)을 측정한다.
pub async fn ping_server(session: &SshSession) -> AppResult<PingInfo> {
    use russh::ChannelMsg;

    let start = std::time::Instant::now();
    let handle = session.handle.lock().await;
    let mut channel = handle.channel_open_session().await?;
    channel.exec(true, "date '+%s|%z'").await?;

    let mut out: Vec<u8> = Vec::new();
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => out.extend_from_slice(&data),
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    let ping_ms = start.elapsed().as_millis() as u64;

    let text = String::from_utf8_lossy(&out);
    let line = text.trim();
    let mut parts = line.split('|');
    let epoch = parts
        .next()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .ok_or_else(|| AppError::Other(format!("date 출력 파싱 실패: {:?}", line)))?;
    let tz = parts.next().unwrap_or("+0000").trim();
    let tz_offset_minutes = parse_tz_offset(tz);

    Ok(PingInfo {
        epoch,
        tz_offset_minutes,
        ping_ms,
    })
}

/// 원격에서 명령을 실행하고 stdout(문자열)과 종료 코드를 반환
pub async fn run_command(session: &SshSession, cmd: &str) -> AppResult<(Vec<u8>, i32)> {
    use russh::ChannelMsg;

    let handle = session.handle.lock().await;
    let mut channel = handle.channel_open_session().await?;
    channel.exec(true, cmd).await?;

    let mut out: Vec<u8> = Vec::new();
    let mut code: i32 = 0;
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => out.extend_from_slice(&data),
            Some(ChannelMsg::ExitStatus { exit_status }) => code = exit_status as i32,
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    Ok((out, code))
}

/// 셸 인용 (작은따옴표로 감싸고 내부 ' 는 '\'' 로 이스케이프)
pub fn shell_quote(s: &str) -> String {
    let mut q = String::with_capacity(s.len() + 2);
    q.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            q.push_str("'\\''");
        } else {
            q.push(ch);
        }
    }
    q.push('\'');
    q
}

/// "+0900" / "-0530" 형식의 타임존 오프셋을 분 단위로 변환
fn parse_tz_offset(tz: &str) -> i32 {
    let sign = if tz.starts_with('-') { -1 } else { 1 };
    let digits: String = tz.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 4 {
        let h: i32 = digits[0..2].parse().unwrap_or(0);
        let m: i32 = digits[2..4].parse().unwrap_or(0);
        sign * (h * 60 + m)
    } else {
        0
    }
}

pub async fn ssh_connect_inner(profile: ConnectionProfile) -> AppResult<Arc<SshSession>> {
    tokio::time::timeout(
        std::time::Duration::from_secs(30),
        ssh_connect_impl(profile),
    )
    .await
    .map_err(|_| AppError::Other("SSH 연결 시간 초과 (30초)".to_string()))?
}

async fn ssh_connect_impl(profile: ConnectionProfile) -> AppResult<Arc<SshSession>> {
    let config = Arc::new(client::Config::default());
    let handler = SshClientHandler;

    let addr = format!("{}:{}", profile.hostname, profile.port);
    let mut handle = client::connect(config, addr, handler).await?;

    // username이 비어있으면 현재 OS 사용자 사용
    let username = if profile.username.is_empty() {
        std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .unwrap_or_else(|_| "root".to_string())
    } else {
        profile.username.clone()
    };

    let authenticated = match &profile.auth {
        crate::config::AuthMethod::Password { password } => {
            let result = handle
                .authenticate_password(&username, password)
                .await?;
            matches!(result, AuthResult::Success)
        }
        crate::config::AuthMethod::PublicKey { identity_file } => {
            try_publickey_auth(&mut handle, &username, std::path::Path::new(identity_file))
                .await?
        }
        crate::config::AuthMethod::Agent => {
            // SSH 에이전트 미지원 → 기본 키 파일들을 순서대로 시도
            let home = dirs::home_dir()
                .ok_or_else(|| AppError::Config("홈 디렉토리를 찾을 수 없습니다".to_string()))?;
            let default_keys = [
                "id_ed25519",
                "id_ecdsa",
                "id_rsa",
                "id_ecdsa_sk",
                "id_ed25519_sk",
            ];
            let mut ok = false;
            for key_name in &default_keys {
                let key_path = home.join(".ssh").join(key_name);
                if !key_path.exists() {
                    continue;
                }
                match try_publickey_auth(&mut handle, &username, &key_path).await {
                    Ok(true) => {
                        ok = true;
                        break;
                    }
                    Ok(false) => continue,
                    Err(_) => continue,
                }
            }
            ok
        }
    };

    if !authenticated {
        return Err(AppError::AuthFailed(format!(
            "{}@{} 인증 실패",
            username, profile.hostname
        )));
    }

    // SFTP 서브시스템 초기화
    let sftp_channel = handle.channel_open_session().await?;
    sftp_channel.request_subsystem(true, "sftp").await?;
    let sftp = SftpSession::new(sftp_channel.into_stream()).await?;

    let id = uuid::Uuid::new_v4().to_string();
    let session = Arc::new(SshSession {
        id: id.clone(),
        profile,
        handle: Mutex::new(handle),
        sftp: Mutex::new(Some(sftp)),
    });

    Ok(session)
}
