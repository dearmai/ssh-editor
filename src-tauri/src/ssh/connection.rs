use crate::config::{AuthMethod, ConnectionProfile};
use crate::error::{AppError, AppResult};
use crate::ssh::proxy;
use crate::ssh::shell_fs::{self, StatTool};
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
    /// None이면 SFTP 서브시스템을 쓸 수 없는 서버 — 파일 작업은 셸 대체 경로(`shell_fs`) 사용
    pub sftp: Mutex<Option<SftpSession>>,
    /// 셸 대체 경로의 파일 정보 조회 수단 (SFTP 사용 시 의미 없음)
    pub stat_tool: Mutex<StatTool>,
    /// 점프 호스트 핸들 — 최종 세션의 터널이 살아 있도록 보관만 한다
    pub jumps: Mutex<Vec<client::Handle<SshClientHandler>>>,
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
/// 끊긴 연결에서 핸들 락이 영원히 잡히는 것을 막기 위해 내부 타임아웃을 둔다.
pub async fn ping_server(session: &SshSession) -> AppResult<PingInfo> {
    tokio::time::timeout(
        std::time::Duration::from_secs(8),
        ping_server_inner(session),
    )
    .await
    .map_err(|_| AppError::Other("ping 시간 초과 (8초)".to_string()))?
}

async fn ping_server_inner(session: &SshSession) -> AppResult<PingInfo> {
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
    let (handle, files, jumps) = establish(&profile).await?;
    let id = uuid::Uuid::new_v4().to_string();
    let session = Arc::new(SshSession {
        id,
        profile,
        handle: Mutex::new(handle),
        sftp: Mutex::new(files.sftp),
        stat_tool: Mutex::new(files.stat_tool),
        jumps: Mutex::new(jumps),
    });
    Ok(session)
}

/// 접속 경로상의 한 SSH 홉 (점프 호스트 또는 최종 대상)
struct Hop<'a> {
    hostname: &'a str,
    port: u16,
    username: &'a str,
    auth: &'a AuthMethod,
}

/// 접속 시 판정한 파일 접근 방식
struct FileAccess {
    sftp: Option<SftpSession>,
    stat_tool: StatTool,
}

type Established = (
    client::Handle<SshClientHandler>,
    FileAccess,
    Vec<client::Handle<SshClientHandler>>,
);

/// SFTP 서브시스템 열기. 거부 응답을 직접 확인해 막힌 서버에서 오래 기다리지 않는다.
async fn open_sftp(handle: &client::Handle<SshClientHandler>) -> Result<SftpSession, String> {
    use russh::ChannelMsg;

    let init = async {
        let mut channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| e.to_string())?;
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Success) => break,
                Some(ChannelMsg::Failure) => return Err("서버가 sftp 서브시스템을 거부함".to_string()),
                Some(ChannelMsg::Eof | ChannelMsg::Close) | None => {
                    return Err("sftp 채널이 닫힘".to_string())
                }
                _ => {}
            }
        }
        SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| e.to_string())
    };
    tokio::time::timeout(std::time::Duration::from_secs(10), init)
        .await
        .map_err(|_| "SFTP 초기화 시간 초과 (10초)".to_string())?
}

/// SFTP → 셸 대체 경로 순으로 파일 접근 수단을 판정한다. 둘 다 안 되면 접속 실패.
async fn detect_file_access(handle: &client::Handle<SshClientHandler>) -> AppResult<FileAccess> {
    let sftp_err = match open_sftp(handle).await {
        Ok(sftp) => return Ok(FileAccess { sftp: Some(sftp), stat_tool: StatTool::Gnu }),
        Err(e) => e,
    };
    match shell_fs::probe(handle).await {
        Ok(stat_tool) => Ok(FileAccess { sftp: None, stat_tool }),
        Err(shell_err) => Err(AppError::Other(format!(
            "원격 파일 접근 불가 — SFTP: {} / 셸 대체 경로: {}",
            sftp_err, shell_err
        ))),
    }
}

/// 프로필로 새 SSH 핸들과 SFTP 세션을 생성한다 (프록시·점프 호스트 경유 + 인증 + SFTP 초기화).
/// 최초 접속과 재접속에서 공통으로 사용한다. 점프 호스트 핸들은 터널 유지를 위해 함께 반환한다.
async fn establish(profile: &ConnectionProfile) -> AppResult<Established> {
    let mut config = client::Config::default();
    // 유휴 연결(서버 다운/슬립 후 복귀 등)을 능동적으로 감지하기 위한 keepalive.
    // 응답 없는 keepalive가 누적되면 러스시 이벤트 루프가 종료되어 채널 작업이 빠르게 실패한다.
    config.keepalive_interval = Some(std::time::Duration::from_secs(15));
    config.keepalive_max = 3;
    let config = Arc::new(config);

    let hops: Vec<Hop> = profile
        .jump_hosts
        .iter()
        .map(|j| Hop {
            hostname: &j.hostname,
            port: j.port,
            username: &j.username,
            auth: &j.auth,
        })
        .chain(std::iter::once(Hop {
            hostname: &profile.hostname,
            port: profile.port,
            username: &profile.username,
            auth: &profile.auth,
        }))
        .collect();

    // 첫 홉은 (프록시를 경유한) TCP, 이후 홉은 이전 홉의 direct-tcpip 채널 위에서 접속
    let first = &hops[0];
    let stream = proxy::open_stream(profile.proxy.as_ref(), first.hostname, first.port).await?;
    let mut handle = client::connect_stream(config.clone(), stream, SshClientHandler).await?;
    authenticate(&mut handle, first).await?;

    let mut jumps = Vec::new();
    for hop in &hops[1..] {
        let channel = handle
            .channel_open_direct_tcpip(hop.hostname, hop.port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| {
                AppError::Other(format!(
                    "점프 호스트에서 {}:{} 터널 생성 실패: {}",
                    hop.hostname, hop.port, e
                ))
            })?;
        let mut next =
            client::connect_stream(config.clone(), channel.into_stream(), SshClientHandler)
                .await?;
        authenticate(&mut next, hop).await?;
        jumps.push(std::mem::replace(&mut handle, next));
    }

    let files = detect_file_access(&handle).await?;
    Ok((handle, files, jumps))
}

async fn authenticate(handle: &mut client::Handle<SshClientHandler>, hop: &Hop<'_>) -> AppResult<()> {
    // username이 비어있으면 현재 OS 사용자 사용
    let username = if hop.username.is_empty() {
        std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .or_else(|_| std::env::var("USERNAME"))
            .unwrap_or_else(|_| "root".to_string())
    } else {
        hop.username.to_string()
    };

    let authenticated = match hop.auth {
        AuthMethod::Password { password } => {
            let result = handle.authenticate_password(&username, password).await?;
            matches!(result, AuthResult::Success)
        }
        AuthMethod::PublicKey { identity_file } => {
            try_publickey_auth(handle, &username, std::path::Path::new(identity_file)).await?
        }
        AuthMethod::Agent => {
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
                if let Ok(true) = try_publickey_auth(handle, &username, &key_path).await {
                    ok = true;
                    break;
                }
            }
            ok
        }
    };

    if !authenticated {
        return Err(AppError::AuthFailed(format!(
            "{}@{} 인증 실패",
            username, hop.hostname
        )));
    }
    Ok(())
}

/// 기존 세션을 동일한 sessionId로 재접속한다 (핸들/SFTP를 새 연결로 교체).
/// sessionId가 그대로이므로 에디터 탭·파일트리 등 프론트의 connectionId 참조가 유지된다.
pub async fn reconnect_session(session: &SshSession) -> AppResult<()> {
    let (handle, files, jumps) = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        establish(&session.profile),
    )
    .await
    .map_err(|_| AppError::Other("재접속 시간 초과 (20초)".to_string()))??;

    *session.handle.lock().await = handle;
    *session.sftp.lock().await = files.sftp;
    *session.stat_tool.lock().await = files.stat_tool;
    *session.jumps.lock().await = jumps;
    Ok(())
}
