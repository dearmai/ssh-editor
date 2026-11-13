mod commands;
mod config;
mod error;
mod file_assoc;
mod file_view;
use file_view::*;
use file_assoc::{file_assoc_open_defaults, file_assoc_set, file_assoc_status};
mod local_crypto;
mod local_files;
mod text_encoding;
use local_crypto::*;
use local_files::*;
mod ssh;
mod storage;
#[cfg(target_os = "linux")]
mod webview_recovery;

use commands::*;
use serde::{Deserialize, Serialize};
use ssh::{SshConnectionPool, TerminalPool};
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
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

/// Native menu activation can temporarily clear the OS focused-window flag.
/// Keep the last focused label so menu actions still reach the initiating window.
struct MenuWindowState(Mutex<Option<String>>);

fn menu_window_label<'a>(labels: &'a [String], focused: Option<&str>, last: Option<&str>) -> Option<&'a str> {
    [focused, last, Some("main")]
        .into_iter()
        .flatten()
        .find_map(|label| labels.iter().find(|candidate| candidate.as_str() == label))
        .or_else(|| labels.first())
        .map(String::as_str)
}

fn menu_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    let focused = windows.values().find(|window| window.is_focused().unwrap_or(false));
    let last = app.state::<MenuWindowState>().0.lock().unwrap().clone();
    let labels = windows.keys().cloned().collect::<Vec<_>>();
    menu_window_label(&labels, focused.map(|window| window.label()), last.as_deref())
        .and_then(|label| windows.get(label).cloned())
}

#[cfg(test)]
mod menu_tests {
    use super::menu_window_label;

    #[test]
    fn menu_targets_current_or_last_focused_window() {
        let labels = vec!["main".into(), "secondary".into()];
        assert_eq!(menu_window_label(&labels, Some("main"), Some("secondary")), Some("main"));
        // Native menus can temporarily leave no webview window focused.
        assert_eq!(menu_window_label(&labels, None, Some("secondary")), Some("secondary"));
    }

    #[test]
    fn menu_targets_surviving_window_when_last_window_closed() {
        let labels = vec!["main".into(), "secondary".into()];
        assert_eq!(menu_window_label(&labels, None, Some("closed")), Some("main"));
        assert_eq!(menu_window_label(&["secondary".into()], None, Some("closed")), Some("secondary"));
        assert_eq!(menu_window_label(&[], None, Some("closed")), None);
    }
}

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
    // 탐색기에서 여러 항목으로 보관/보관 해제를 실행하면 항목마다 프로세스가 뜬다 —
    // 요청을 맡은 프로세스 하나만 창을 띄우고 나머지는 여기서 종료한다.
    let crypto_request = match startup_request(std::env::args().skip(1)) {
        Startup::Exit => return,
        Startup::Request(req) => Some(req),
        Startup::Normal => None,
    };
    storage::initialize().expect("설정 디렉터리를 준비할 수 없습니다. 실행파일 폴더의 쓰기 권한을 확인하세요.");
    let builder = tauri::Builder::default();
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(webview_recovery::plugin());
    builder
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SshConnectionPool::new())
        .manage(TerminalPool::new())
        .manage(ssh::TransferCancelState::new())
        .manage(StartupArgsState(Mutex::new(startup_args)))
        .manage(PendingFiles(Mutex::new(cli_files(
            std::env::args().skip(1),
        ))))
        .manage(PendingCrypto(Mutex::new(crypto_request)))
        .manage(ExitVoteState(Mutex::new(None)))
        .manage(MenuWindowState(Mutex::new(None)))
        .setup(|app| {
            file_assoc::startup_maintenance();
            explorer_menu_maintenance();
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

            let release_notes_item = MenuItemBuilder::with_id("release-notes", "버전 수정 내역...")
                .build(app)?;
            let app_menu = SubmenuBuilder::new(app, "SSH Editor")
                .about(Some(AboutMetadata {
                    name: Some("SSH Editor".into()),
                    version: Some(app.package_info().version.to_string()),
                    authors: Some(vec![env!("CARGO_PKG_AUTHORS").into()]),
                    comments: Some("SSH 원격 파일 편집기".into()),
                    ..Default::default()
                }))
                .item(&release_notes_item)
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
            let open_path_item = MenuItemBuilder::with_id("open-path", "경로로 파일 열기...")
                .accelerator("CmdOrCtrl+P")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "파일").item(&open_path_item).build()?;

            // macOS의 기본 copy:는 xterm의 자체 선택 영역을 인식하지 못할 수 있다.
            // 포커스된 웹뷰로 전달해 터미널과 일반 에디터가 각자 처리하게 한다.
            #[cfg(target_os = "macos")]
            let copy_item = MenuItemBuilder::with_id("copy", "복사")
                .accelerator("CmdOrCtrl+C")
                .build(app)?;
            let edit_menu = SubmenuBuilder::new(app, "편집")
                .undo()
                .redo()
                .separator()
                .cut();
            #[cfg(target_os = "macos")]
            let edit_menu = edit_menu.item(&copy_item);
            #[cfg(not(target_os = "macos"))]
            let edit_menu = edit_menu.copy();
            let edit_menu = edit_menu
                .paste()
                .select_all()
                .build()?;

            // close_window(기본 Cmd+W)을 빼서 Cmd+W가 웹뷰로 전달되도록 함
            // → 프론트에서 Cmd+W = 탭 닫기, 탭이 없으면 창 닫기로 처리
            let window_menu = SubmenuBuilder::new(app, "윈도우")
                .minimize()
                .maximize()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "보기")
                .item(&word_wrap_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
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
                "toggle-word-wrap" | "copy" | "open-path" | "release-notes" => {
                    // 전역 emit이면 모든 창이 토글되므로 포커스된 창에만 전달
                    // (get_focused_window는 tauri "unstable" feature라 is_focused로 탐색)
                    if let Some(w) = menu_window(app) {
                        let event_name = match event.id().as_ref() {
                            "copy" => "menu-copy",
                            "open-path" => "menu-open-path",
                            "release-notes" => "menu-release-notes",
                            _ => "menu-toggle-word-wrap",
                        };
                        let _ = app.emit_to(w.label(), event_name, ());
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

            // 탐색기 "보관/해제"로 실행된 경우: 메인 창을 작은 단독 대화상자로 바꾼다
            // (프론트는 같은 요청을 보고 에디터 대신 보관/해제 화면만 그린다)
            if app.state::<PendingCrypto>().0.lock().unwrap().is_some() {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.remove_menu();
                    let _ = win.set_title("SSH Editor — 보관/해제");
                    let _ = win.set_min_size(None::<tauri::LogicalSize<f64>>);
                    let _ = win.set_size(tauri::LogicalSize::new(440.0, 380.0));
                    let _ = win.set_resizable(false);
                    let _ = win.set_maximizable(false);
                    let _ = win.center();
                    let _ = win.set_focus();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 연결 관리
            ssh_connect,
            ssh_disconnect,
            ssh_ping,
            ssh_health_check,
            ssh_reconnect,
            ssh_file_access,
            open_new_window,
            get_active_connections,
            load_ssh_config,
            load_profiles,
            save_profile,
            delete_profile,
            // SFTP
            sftp_list_dir,
            path_home,
            sftp_read_file,
            sftp_log_chunk,
            sftp_log_search,
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
            terminal_prepare_upload,
            // 기타
            take_open_files,
            local_read_file,
            text_encoding::text_read_file,
            text_encoding::text_write_file,
            text_encoding::text_encoded_lengths,
            local_write_file,
            local_stat,
            local_list_dir,
            local_crypto_plan,
            local_crypto_batch,
            take_crypto_request,
            local_probe,
            local_read_text,
            local_read_bytes,
            local_search,
            sftp_read_bytes,
            local_line_index,
            local_read_lines,
            local_read_segment,
            local_write_segment,
            explorer_menu_status,
            explorer_menu_set,
            get_startup_args,
            read_clipboard_uploads,
            exit_vote,
            // 파일 연결 (Windows)
            file_assoc_status,
            file_assoc_set,
            file_assoc_open_defaults,
        ])
        .build(tauri::generate_context!())
        .expect("SSH Editor 실행 오류")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Focused(true),
                ..
            } = &event
            {
                *app.state::<MenuWindowState>().0.lock().unwrap() = Some(label.clone());
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                let files = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .collect::<Vec<_>>();
                app.state::<PendingFiles>().0.lock().unwrap().extend(files);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit_to("main", "open-files-available", ());
                }
            }
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
