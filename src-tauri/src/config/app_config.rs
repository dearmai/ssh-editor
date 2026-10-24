use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    #[serde(flatten)]
    pub auth: AuthMethod,
    pub last_path: Option<String>,
    /// 즐겨찾기/시작 디렉토리 목록 (첫 번째가 기본 시작 디렉토리)
    #[serde(default)]
    pub directories: Vec<String>,
    /// 점프 호스트 체인 (ProxyJump). 앞에서부터 순서대로 경유한다.
    #[serde(default)]
    pub jump_hosts: Vec<JumpHost>,
    /// 첫 번째 홉(점프 호스트가 있으면 첫 점프 호스트)에 접속할 때 사용할 프록시
    #[serde(default)]
    pub proxy: Option<ProxyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "authType", rename_all = "camelCase")]
pub enum AuthMethod {
    Password { password: String },
    PublicKey { identity_file: String },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpHost {
    pub hostname: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(flatten)]
    pub auth: AuthMethod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyKind {
    Http,
    Https,
    Socks5,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    #[serde(rename = "type")]
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    /// HTTPS 프록시 인증서 검증 생략 (사내 자체 서명 인증서 등)
    #[serde(default)]
    pub insecure: bool,
}
