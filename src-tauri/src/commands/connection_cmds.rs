use crate::config::{parse_ssh_config, ConnectionProfile, SshConfigHost};
use crate::error::{AppError, AppResult};
use crate::ssh::{ssh_connect_inner, SshConnectionPool};
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveConnection {
    pub session_id: String,
    pub profile: ConnectionProfile,
}

#[tauri::command]
pub async fn ssh_connect(
    profile: ConnectionProfile,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<String> {
    let session = ssh_connect_inner(profile).await?;
    let id = session.id.clone();
    pool.sessions.insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
pub async fn ssh_disconnect(
    session_id: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    pool.sessions
        .remove(&session_id)
        .ok_or_else(|| AppError::ConnectionNotFound { id: session_id })?;
    Ok(())
}

#[tauri::command]
pub async fn get_active_connections(
    pool: State<'_, SshConnectionPool>,
) -> AppResult<Vec<ActiveConnection>> {
    let conns = pool
        .sessions
        .iter()
        .map(|r| ActiveConnection {
            session_id: r.key().clone(),
            profile: r.value().profile.clone(),
        })
        .collect();
    Ok(conns)
}

#[tauri::command]
pub async fn load_ssh_config() -> AppResult<Vec<SshConfigHost>> {
    parse_ssh_config()
}

#[tauri::command]
pub async fn load_profiles(app: tauri::AppHandle) -> AppResult<Vec<ConnectionProfile>> {
    let store = app
        .store("ssh-editor.json")
        .map_err(|e| AppError::Other(format!("Store 오류: {}", e)))?;
    let profiles = store
        .get("connections")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    Ok(profiles)
}

#[tauri::command]
pub async fn save_profile(
    profile: ConnectionProfile,
    app: tauri::AppHandle,
) -> AppResult<()> {
    let store = app
        .store("ssh-editor.json")
        .map_err(|e| AppError::Other(format!("Store 오류: {}", e)))?;
    let mut profiles: Vec<ConnectionProfile> = store
        .get("connections")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // 기존 항목 업데이트 또는 추가
    if let Some(existing) = profiles.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        profiles.push(profile);
    }

    store.set("connections", serde_json::to_value(&profiles)?);
    store
        .save()
        .map_err(|e| AppError::Other(format!("Store 저장 실패: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_profile(id: String, app: tauri::AppHandle) -> AppResult<()> {
    let store = app
        .store("ssh-editor.json")
        .map_err(|e| AppError::Other(format!("Store 오류: {}", e)))?;
    let mut profiles: Vec<ConnectionProfile> = store
        .get("connections")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    profiles.retain(|p| p.id != id);
    store.set("connections", serde_json::to_value(&profiles)?);
    store
        .save()
        .map_err(|e| AppError::Other(format!("Store 저장 실패: {}", e)))?;
    Ok(())
}
