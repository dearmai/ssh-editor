mod commands;
mod config;
mod error;
mod ssh;

use commands::*;
use serde::{Deserialize, Serialize};
use ssh::{SshConnectionPool, TerminalPool};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

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
        .manage(SshConnectionPool::new())
        .manage(TerminalPool::new())
        .manage(StartupArgsState(Mutex::new(startup_args)))
        .setup(|app| {
            let prefs_item = MenuItemBuilder::with_id("preferences", "환경설정...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;

            let app_menu = SubmenuBuilder::new(app, "SSH Editor")
                .about(None)
                .separator()
                .item(&prefs_item)
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

            let window_menu = SubmenuBuilder::new(app, "윈도우")
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                if event.id() == "preferences" {
                    app.emit("menu-preferences", ()).ok();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 연결 관리
            ssh_connect,
            ssh_disconnect,
            get_active_connections,
            load_ssh_config,
            load_profiles,
            save_profile,
            delete_profile,
            // SFTP
            sftp_list_dir,
            sftp_read_file,
            sftp_write_file,
            sftp_create_file,
            sftp_delete_path,
            sftp_rename_path,
            sftp_create_dir,
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
