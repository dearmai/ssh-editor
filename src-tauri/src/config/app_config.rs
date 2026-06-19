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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "authType", rename_all = "camelCase")]
pub enum AuthMethod {
    Password { password: String },
    PublicKey { identity_file: String },
    Agent,
}
