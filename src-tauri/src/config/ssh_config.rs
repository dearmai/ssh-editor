use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    pub hostname: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

pub fn parse_ssh_config() -> AppResult<Vec<SshConfigHost>> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Config("홈 디렉토리를 찾을 수 없습니다".to_string()))?;
    let config_path = home.join(".ssh").join("config");

    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&config_path)?;
    let hosts = parse_config_content(&content, &home.to_string_lossy());
    Ok(hosts)
}

fn parse_config_content(content: &str, home: &str) -> Vec<SshConfigHost> {
    let mut hosts = Vec::new();
    let mut current: Option<SshConfigHost> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let Some((key, value)) = trimmed.split_once(char::is_whitespace) else {
            continue;
        };
        let key = key.to_lowercase();
        let value = value.trim().to_string();

        match key.as_str() {
            "host" => {
                if let Some(h) = current.take() {
                    // 와일드카드 제외
                    if !h.alias.contains('*') && !h.alias.contains('?') {
                        hosts.push(h);
                    }
                }
                current = Some(SshConfigHost {
                    alias: value,
                    hostname: String::new(),
                    user: None,
                    port: None,
                    identity_file: None,
                    proxy_jump: None,
                });
            }
            "hostname" => {
                if let Some(ref mut h) = current {
                    h.hostname = value;
                }
            }
            "user" => {
                if let Some(ref mut h) = current {
                    h.user = Some(value);
                }
            }
            "port" => {
                if let Some(ref mut h) = current {
                    h.port = value.parse().ok();
                }
            }
            "identityfile" => {
                if let Some(ref mut h) = current {
                    let expanded = value.replace('~', home);
                    h.identity_file = Some(expanded);
                }
            }
            "proxyjump" => {
                if let Some(ref mut h) = current {
                    h.proxy_jump = Some(value);
                }
            }
            _ => {}
        }
    }

    if let Some(h) = current {
        if !h.alias.contains('*') && !h.alias.contains('?') && !h.hostname.is_empty() {
            hosts.push(h);
        }
    }

    hosts
}
