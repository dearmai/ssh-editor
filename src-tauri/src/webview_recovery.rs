//! WebKit 프로세스가 죽으면 JavaScript 종료 확인도 동작하지 않는다.
//! 최초 창과 추가 창 모두 네이티브 경로로 오류를 알리고 닫는다.
use tauri::{Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use webkit2gtk::WebViewExt;

pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri::plugin::Builder::new("webview-recovery")
        .on_webview_ready(|webview| {
            let window = webview.window().clone();
            if let Err(error) = webview.with_webview(move |platform| {
                platform.inner().connect_web_process_terminated(move |_, reason| {
                    eprintln!("WebKit process terminated: window={}, reason={reason:?}", window.label());
                    // 죽은 창의 응답을 기다리던 앱 종료 요청은 취소한다.
                    // 다른 창의 미저장 문서는 기존 확인 절차로 보호한다.
                    *window.state::<crate::ExitVoteState>().0.lock().unwrap() = None;
                    let close_window = window.clone();
                    window.dialog()
                        .message("화면 프로세스가 예기치 않게 종료되었습니다. 이 창을 닫은 후 다시 열어 주세요.\n저장하지 않은 편집 내용은 유실되었을 수 있습니다.")
                        .title("SSH Editor — 화면 오류")
                        .kind(MessageDialogKind::Error)
                        .show(move |_| {
                            // close()는 죽은 JavaScript의 확인을 기다리므로 destroy()를 쓴다.
                            if let Err(error) = close_window.destroy() {
                                eprintln!("Failed to destroy crashed window: {error}");
                            }
                        });
                });
            }) {
                eprintln!("Failed to register WebKit recovery: {error}");
            }
        })
        .build()
}
