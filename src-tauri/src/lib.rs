mod commands;
mod config;
mod error;
mod ssh;

use commands::*;
use serde::{Deserialize, Serialize};
use ssh::{SshConnectionPool, TerminalPool};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupArgs {
    pub host: String,
    pub username: Option<String>,
    pub path: Option<String>,
    pub profile_id: Option<String>,
}

pub struct StartupArgsState(pub Mutex<Option<StartupArgs>>);

/// 종료 확인 대기 중인 창 라벨 집합. None이면 종료 절차가 진행 중이 아니다.
/// 모든 창이 승인(exit_vote(true))해야 실제로 종료하고, 한 창이라도 취소하면 절차를 접는다.
pub struct ExitVoteState(pub Mutex<Option<HashSet<String>>>);

/// 종료 절차 시작 — 열린 모든 창에 확인을 요청한다 (미저장 문서 저장·확인은 프론트가 수행)
fn start_exit_flow(app: &tauri::AppHandle) {
    let labels: HashSet<String> = app.webview_windows().keys().cloned().collect();
    if labels.is_empty() {
        app.exit(0);
        return;
    }
    {
        let state = app.state::<ExitVoteState>();
        let mut pending = state.0.lock().unwrap();
        // 이미 확인을 요청해 둔 상태면 중복 요청하지 않는다 (Cmd+Q 연타)
        if pending.is_some() {
            return;
        }
        *pending = Some(labels.clone());
    }
    for label in labels {
        let _ = app.emit_to(label.as_str(), "app-exit-requested", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(startup_args: Option<StartupArgs>) {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SshConnectionPool::new())
        .manage(TerminalPool::new())
        .manage(ssh::TransferCancelState::new())
        .manage(StartupArgsState(Mutex::new(startup_args)))
        .manage(ExitVoteState(Mutex::new(None)))
        .setup(|app| {
            let prefs_item = MenuItemBuilder::with_id("preferences", "환경설정...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let new_window_item = MenuItemBuilder::with_id("new-window", "새 창")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;
            // 기본 quit 항목은 macOS에서 ExitRequested 없이 즉시 종료되어 미저장 확인을
            // 건너뛴다. 직접 만든 항목으로 대체해 프론트 확인 절차를 태운다.
            let quit_item = MenuItemBuilder::with_id("quit", "SSH Editor 종료")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "SSH Editor")
                .about(None)
                .separator()
                .item(&prefs_item)
                .item(&new_window_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
                .build()?;

            let word_wrap_item = MenuItemBuilder::with_id("toggle-word-wrap", "자동 줄바꿈")
                .accelerator("Alt+Z")
                .build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "편집")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // close_window(기본 Cmd+W)을 빼서 Cmd+W가 웹뷰로 전달되도록 함
            // → 프론트에서 Cmd+W = 탭 닫기, 탭이 없으면 창 닫기로 처리
            let window_menu = SubmenuBuilder::new(app, "윈도우")
                .minimize()
                .maximize()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "보기").item(&word_wrap_item).build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "quit" => {
                    start_exit_flow(app);
                }
                "preferences" => {
                    app.emit("menu-preferences", ()).ok();
                }
                "toggle-word-wrap" => {
                    // 전역 emit이면 모든 창이 토글되므로 포커스된 창에만 전달
                    // (get_focused_window는 tauri "unstable" feature라 is_focused로 탐색)
                    let focused = app
                        .webview_windows()
                        .into_values()
                        .find(|w| w.is_focused().unwrap_or(false));
                    if let Some(w) = focused {
                        let _ = app.emit_to(w.label(), "menu-toggle-word-wrap", ());
                    }
                }
                "new-window" => {
                    let label = format!("win-{}", uuid::Uuid::new_v4());
                    let _ = WebviewWindowBuilder::new(
                        app,
                        &label,
                        WebviewUrl::App("index.html".into()),
                    )
                    .title("SSH Editor")
                    .inner_size(1400.0, 900.0)
                    .min_inner_size(960.0, 640.0)
                    // HTML5 드래그앤드롭(탭 이동/분할)이 동작하도록
                    .disable_drag_drop_handler()
                    .build();
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 연결 관리
            ssh_connect,
            ssh_disconnect,
            ssh_ping,
            ssh_health_check,
            ssh_reconnect,
            open_new_window,
            get_active_connections,
            load_ssh_config,
            load_profiles,
            save_profile,
            delete_profile,
            // SFTP
            sftp_list_dir,
            sftp_read_file,
            sftp_write_file,
            sftp_stat,
            sftp_create_file,
            sftp_delete_path,
            sftp_rename_path,
            sftp_copy_path,
            sftp_create_dir,
            sftp_probe,
            sftp_exists,
            sftp_check_write_access,
            sftp_upload,
            sftp_upload_data_chunk,
            sftp_abort_upload_data,
            transfer_cancel,
            sftp_download,
            sftp_download_dir,
            // 터미널
            terminal_create,
            terminal_write,
            terminal_close,
            terminal_resize,
            // 기타
            get_startup_args,
            read_clipboard_uploads,
            exit_vote,
        ])
        .build(tauri::generate_context!())
        .expect("SSH Editor 실행 오류")
        .run(|app, event| {
            // Cmd+Q(앱 종료)는 창 close 이벤트를 거치지 않는다. 종료를 일단 막고
            // 프론트에 알려 미저장 문서를 저장·확인하게 한 뒤, confirm_exit 로 다시 종료한다.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                // code가 있는 종료(= 확인을 마친 app.exit)는 그대로 진행
                if code.is_none() {
                    api.prevent_exit();
                    start_exit_flow(app);
                }
            }
        });
}

/// 창 하나의 종료 확인 결과. 모든 창이 승인하면 실제로 종료하고, 하나라도 취소하면 절차를 접는다.
#[tauri::command]
fn exit_vote(app: tauri::AppHandle, window: tauri::Window, approve: bool) {
    let state = app.state::<ExitVoteState>();
    let done = {
        let mut guard = state.0.lock().unwrap();
        let Some(pending) = guard.as_mut() else {
            return; // 진행 중인 종료 절차가 없음
        };
        if !approve {
            *guard = None;
            return;
        }
        pending.remove(window.label());
        let empty = pending.is_empty();
        if empty {
            *guard = None;
        }
        empty
    };
    if done {
        app.exit(0);
    }
}

#[tauri::command]
fn get_startup_args(state: tauri::State<'_, StartupArgsState>) -> Option<StartupArgs> {
    state.0.lock().ok()?.clone()
}
