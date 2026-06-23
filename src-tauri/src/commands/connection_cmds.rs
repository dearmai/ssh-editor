use crate::config::{parse_ssh_config, ConnectionProfile, SshConfigHost};
use crate::error::{AppError, AppResult};
use crate::ssh::{ping_server, reconnect_session, ssh_connect_inner, PingInfo, SshConnectionPool};
use serde::{Deserialize, Serialize};
use tauri::{State, WebviewUrl, WebviewWindowBuilder};
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
pub async fn ssh_ping(
    session_id: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<PingInfo> {
    let session = pool.get(&session_id)?;
    ping_server(&session).await
}

/// 세션 생존 여부 점검. 5초 내 ping이 성공하면 true, 아니면(끊김/타임아웃/세션 없음) false.
/// 창 복귀 시 연결 끊김을 빠르게 감지하기 위한 용도.
#[tauri::command]
pub async fn ssh_health_check(
    session_id: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<bool> {
    let session = match pool.sessions.get(&session_id) {
        Some(s) => s.value().clone(),
        None => return Ok(false),
    };
    let alive = matches!(
        tokio::time::timeout(std::time::Duration::from_secs(5), ping_server(&session)).await,
        Ok(Ok(_))
    );
    Ok(alive)
}

/// 동일한 sessionId를 유지한 채 재접속한다 (핸들/SFTP 교체).
#[tauri::command]
pub async fn ssh_reconnect(
    session_id: String,
    pool: State<'_, SshConnectionPool>,
) -> AppResult<()> {
    let session = pool.get(&session_id)?;
    reconnect_session(&session).await
}

#[tauri::command]
pub async fn open_new_window(app: tauri::AppHandle) -> AppResult<()> {
    let label = format!("win-{}", uuid::Uuid::new_v4());
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("SSH Editor")
        .inner_size(1400.0, 900.0)
        .min_inner_size(960.0, 640.0)
        // HTML5 드래그앤드롭(탭 이동/분할)이 동작하도록 네이티브 drag-drop 핸들러 비활성화
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| AppError::Other(format!("새 창 생성 실패: {}", e)))?;
    Ok(())
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
