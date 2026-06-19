use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    #[serde(flatten)]
    pub auth: AuthMethod,
    pub last_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "authType", rename_all = "camelCase")]
pub enum AuthMethod {
    Password { password: String },
    PublicKey { identity_file: String },
    Agent,
}
