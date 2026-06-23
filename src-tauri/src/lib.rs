mod commands;
mod config;
mod error;
mod ssh;

use commands::*;
use serde::{Deserialize, Serialize};
use ssh::{SshConnectionPool, TerminalPool};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupArgs {
    pub host: String,
    pub username: Option<String>,
    pub path: Option<String>,
    pub profile_id: Option<String>,
}

pub struct StartupArgsState(pub Mutex<Option<StartupArgs>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(startup_args: Option<StartupArgs>) {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(SshConnectionPool::new())
        .manage(TerminalPool::new())
        .manage(StartupArgsState(Mutex::new(startup_args)))
        .setup(|app| {
            let prefs_item = MenuItemBuilder::with_id("preferences", "환경설정...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let new_window_item = MenuItemBuilder::with_id("new-window", "새 창")
                .accelerator("CmdOrCtrl+Shift+N")
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
                .quit()
                .build()?;

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

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| match event.id().as_ref() {
                "preferences" => {
                    app.emit("menu-preferences", ()).ok();
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
            sftp_create_dir,
            sftp_probe,
            sftp_upload,
            sftp_download,
            sftp_download_dir,
            // 터미널
            terminal_create,
            terminal_write,
            terminal_close,
            terminal_resize,
            // 기타
            get_startup_args,
        ])
        .run(tauri::generate_context!())
        .expect("SSH Editor 실행 오류");
}

#[tauri::command]
fn get_startup_args(state: tauri::State<'_, StartupArgsState>) -> Option<StartupArgs> {
    state.0.lock().ok()?.clone()
}
