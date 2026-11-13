//! 운영체제 파일 연결(확장자 → SSH Editor) 관리 — Windows 전용.
//!
//! 설치파일은 어떤 확장자도 자동으로 연결하지 않는다. 사용자가 환경설정에서 고른
//! 확장자만 HKCU(사용자 단위, 관리자 권한 불필요)에 등록한다.
//!
//! 레지스트리 구조
//!   HKCU\Software\Classes\SSHEditor.File                     ProgId (아이콘, open 명령)
//!   HKCU\Software\Classes\.<ext>\OpenWithProgids             "SSHEditor.File" 값 → 연결 프로그램 목록에 노출
//!   HKCU\Software\SSHEditor\Capabilities\FileAssociations    .<ext> = SSHEditor.File (Windows 기본 앱 설정 화면용)
//!   HKCU\Software\RegisteredApplications                     "SSH Editor" → 위 Capabilities
//!
//! Windows 10 이후 기본 앱(UserChoice)은 해시로 보호되어 앱이 직접 바꿀 수 없다.
//! 기본 앱 지정은 Windows 설정의 '기본 앱' 화면을 열어 사용자가 고르게 한다.

use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAssocStatus {
    /// 점 없는 소문자 확장자
    pub ext: String,
    /// SSH Editor가 '연결 프로그램' 목록에 등록되어 있는지
    pub registered: bool,
    /// 현재 이 확장자의 기본 앱이 SSH Editor인지
    pub is_default: bool,
    /// 현재 기본 앱 이름 (없으면 None)
    pub default_app: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAssocReport {
    /// 이 플랫폼에서 관리 기능을 지원하는지 (Windows만 true)
    pub supported: bool,
    pub items: Vec<FileAssocStatus>,
}

/// 확장자 정규화: 앞의 점/와일드카드 제거, 소문자, 허용 문자만 (레지스트리 경로 주입 방지)
fn normalize_ext(raw: &str) -> Option<String> {
    let e = raw.trim().trim_start_matches(['.', '*']).to_ascii_lowercase();
    let valid = !e.is_empty()
        && e.len() <= 32
        && e.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '+'));
    valid.then_some(e)
}

/// 확장자별 연결 상태 조회
#[tauri::command]
pub fn file_assoc_status(exts: Vec<String>) -> AppResult<FileAssocReport> {
    #[cfg(windows)]
    {
        win::status(&exts)
    }
    #[cfg(not(windows))]
    {
        let _ = exts;
        Ok(FileAssocReport { supported: false, items: Vec::new() })
    }
}

/// 확장자 연결 등록(enabled=true) / 해제(enabled=false)
#[tauri::command]
pub fn file_assoc_set(exts: Vec<String>, enabled: bool) -> AppResult<()> {
    #[cfg(windows)]
    {
        win::set(&exts, enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = (exts, enabled);
        Err(crate::error::AppError::Other("파일 연결 관리는 Windows에서만 지원합니다.".into()))
    }
}

/// Windows 설정의 '기본 앱' 화면 열기 (가능하면 SSH Editor 항목으로 바로 이동)
#[tauri::command]
pub fn file_assoc_open_defaults() -> AppResult<()> {
    #[cfg(windows)]
    {
        win::open_default_apps()
    }
    #[cfg(not(windows))]
    {
        Err(crate::error::AppError::Other("파일 연결 관리는 Windows에서만 지원합니다.".into()))
    }
}

/// 앱 시작 시 호출 — 이전 설치파일이 남긴 기본 클래스 덮어쓰기 정리 + 등록된 실행 경로 갱신
pub fn startup_maintenance() {
    #[cfg(windows)]
    std::thread::spawn(|| {
        if let Err(e) = win::maintenance() {
            log::warn!("파일 연결 정리 실패: {e}");
        }
    });
}

#[cfg(windows)]
mod win {
    use super::{normalize_ext, FileAssocReport, FileAssocStatus};
    use crate::error::{AppError, AppResult};
    use std::io::ErrorKind;
    use std::path::{Path, PathBuf};
    use winreg::enums::{HKEY_CURRENT_USER, REG_NONE};
    use winreg::{RegKey, RegValue};

    const PROG_ID: &str = "SSHEditor.File";
    const APP_NAME: &str = "SSH Editor";
    const CLASSES: &str = r"Software\Classes";
    const APP_KEY: &str = r"Software\SSHEditor";
    const CAPS_KEY: &str = r"Software\SSHEditor\Capabilities";
    const CAPS_ASSOC_KEY: &str = r"Software\SSHEditor\Capabilities\FileAssociations";
    const REGISTERED_APPS: &str = r"Software\RegisteredApplications";

    /// 0.1.1 이하 설치파일(tauri fileAssociations)이 만든 클래스 이름
    const LEGACY_CLASSES: &[&str] = &[
        "Text", "Markdown", "JSON", "YAML", "TOML", "XML", "HTML", "CSS", "JavaScript",
        "TypeScript", "Python", "Shell", "C", "C++", "Rust", "Go", "Java", "Ruby", "PHP", "SQL",
        "Other source",
    ];

    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    fn reg_err(ctx: &str, e: std::io::Error) -> AppError {
        AppError::Other(format!("{ctx}: {e}"))
    }

    fn current_exe() -> AppResult<PathBuf> {
        std::env::current_exe().map_err(|e| reg_err("실행 파일 경로 확인 실패", e))
    }

    fn same_path(a: &Path, b: &Path) -> bool {
        let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        canon(a).to_string_lossy().eq_ignore_ascii_case(&canon(b).to_string_lossy())
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// AssocQueryStringW 래퍼 — 확장자의 기본 open 핸들러 정보 조회
    fn assoc_query(ext: &str, what: i32) -> Option<String> {
        use windows_sys::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_NOTRUNCATE};
        let assoc = wide(&format!(".{ext}"));
        let verb = wide("open");
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        // SAFETY: 모든 포인터는 이 함수 안에서 유효한 NUL 종료 버퍼를 가리킨다
        let hr = unsafe {
            AssocQueryStringW(ASSOCF_NOTRUNCATE, what, assoc.as_ptr(), verb.as_ptr(), buf.as_mut_ptr(), &mut len)
        };
        if hr != 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let s = String::from_utf16_lossy(&buf[..end]).trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    /// 탐색기에 연결 정보 변경 알림 (아이콘/연결 프로그램 목록 갱신)
    fn notify_shell() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        // SAFETY: SHCNE_ASSOCCHANGED는 item 포인터를 사용하지 않는다
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as _, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }

    fn is_registered(ext: &str) -> bool {
        hkcu()
            .open_subkey(format!(r"{CLASSES}\.{ext}\OpenWithProgids"))
            .map(|k| k.get_raw_value(PROG_ID).is_ok())
            .unwrap_or(false)
    }

    pub fn status(exts: &[String]) -> AppResult<FileAssocReport> {
        let exe = current_exe()?;
        let items = exts
            .iter()
            .filter_map(|raw| normalize_ext(raw))
            .map(|ext| {
                use windows_sys::Win32::UI::Shell::{ASSOCSTR_EXECUTABLE, ASSOCSTR_FRIENDLYAPPNAME};
                let handler = assoc_query(&ext, ASSOCSTR_EXECUTABLE);
                let is_default = handler.as_deref().is_some_and(|h| same_path(Path::new(h), &exe));
                let default_app = if is_default {
                    Some(APP_NAME.to_string())
                } else {
                    assoc_query(&ext, ASSOCSTR_FRIENDLYAPPNAME)
                };
                FileAssocStatus { registered: is_registered(&ext), is_default, default_app, ext }
            })
            .collect();
        Ok(FileAssocReport { supported: true, items })
    }

    /// ProgId · Capabilities · RegisteredApplications 를 현재 실행 파일 기준으로 (재)작성
    fn write_app_registration(exe: &Path) -> AppResult<()> {
        let exe = exe.to_string_lossy();
        let root = hkcu();
        fn w(ctx: &'static str) -> impl Fn(std::io::Error) -> AppError {
            move |e| reg_err(ctx, e)
        }

        let (prog, _) = root.create_subkey(format!(r"{CLASSES}\{PROG_ID}")).map_err(w("ProgId 생성"))?;
        prog.set_value("", &format!("{APP_NAME} 문서")).map_err(w("ProgId 기록"))?;
        let (icon, _) = prog.create_subkey("DefaultIcon").map_err(w("아이콘 키 생성"))?;
        icon.set_value("", &format!("\"{exe}\",0")).map_err(w("아이콘 기록"))?;
        let (open, _) = prog.create_subkey(r"shell\open").map_err(w("open 키 생성"))?;
        open.set_value("FriendlyAppName", &APP_NAME).map_err(w("앱 이름 기록"))?;
        let (cmd, _) = open.create_subkey("command").map_err(w("명령 키 생성"))?;
        cmd.set_value("", &format!("\"{exe}\" \"%1\"")).map_err(w("명령 기록"))?;

        let (caps, _) = root.create_subkey(CAPS_KEY).map_err(w("Capabilities 생성"))?;
        caps.set_value("ApplicationName", &APP_NAME).map_err(w("Capabilities 기록"))?;
        caps.set_value("ApplicationDescription", &"SSH 원격 파일 에디터").map_err(w("Capabilities 기록"))?;
        caps.set_value("ApplicationIcon", &format!("\"{exe}\",0")).map_err(w("Capabilities 기록"))?;
        root.create_subkey(CAPS_ASSOC_KEY).map_err(w("FileAssociations 생성"))?;

        let (apps, _) = root.create_subkey(REGISTERED_APPS).map_err(w("RegisteredApplications 열기"))?;
        apps.set_value(APP_NAME, &CAPS_KEY).map_err(w("RegisteredApplications 기록"))?;
        Ok(())
    }

    /// 연결된 확장자가 하나도 없으면 앱 등록 흔적을 모두 제거
    fn remove_app_registration_if_unused() {
        let root = hkcu();
        let in_use = root
            .open_subkey(CAPS_ASSOC_KEY)
            .map(|k| k.enum_values().next().is_some())
            .unwrap_or(false);
        if in_use {
            return;
        }
        let _ = root.delete_subkey_all(format!(r"{CLASSES}\{PROG_ID}"));
        let _ = root.delete_subkey_all(APP_KEY);
        if let Ok(apps) = root.open_subkey_with_flags(REGISTERED_APPS, winreg::enums::KEY_SET_VALUE) {
            let _ = apps.delete_value(APP_NAME);
        }
    }

    /// 값·하위 키가 하나도 없는 키만 삭제
    fn delete_if_empty(root: &RegKey, path: &str) {
        let empty = root
            .open_subkey(path)
            .and_then(|k| k.query_info())
            .map(|i| i.sub_keys == 0 && i.values == 0)
            .unwrap_or(false);
        if empty {
            let _ = root.delete_subkey(path);
        }
    }

    fn ignore_missing(r: std::io::Result<()>) -> std::io::Result<()> {
        match r {
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            other => other,
        }
    }

    pub fn set(exts: &[String], enabled: bool) -> AppResult<()> {
        let exts: Vec<String> = exts.iter().filter_map(|e| normalize_ext(e)).collect();
        if exts.is_empty() {
            return Ok(());
        }
        let root = hkcu();
        if enabled {
            write_app_registration(&current_exe()?)?;
            let (caps_assoc, _) = root.create_subkey(CAPS_ASSOC_KEY).map_err(|e| reg_err("FileAssociations 열기", e))?;
            for ext in &exts {
                let (owp, _) = root
                    .create_subkey(format!(r"{CLASSES}\.{ext}\OpenWithProgids"))
                    .map_err(|e| reg_err(&format!(".{ext} 등록"), e))?;
                owp.set_raw_value(PROG_ID, &RegValue { vtype: REG_NONE, bytes: Vec::new() })
                    .map_err(|e| reg_err(&format!(".{ext} 등록"), e))?;
                caps_assoc
                    .set_value(format!(".{ext}"), &PROG_ID)
                    .map_err(|e| reg_err(&format!(".{ext} 등록"), e))?;
            }
        } else {
            for ext in &exts {
                if let Ok(owp) = root.open_subkey_with_flags(
                    format!(r"{CLASSES}\.{ext}\OpenWithProgids"),
                    winreg::enums::KEY_SET_VALUE,
                ) {
                    ignore_missing(owp.delete_value(PROG_ID)).map_err(|e| reg_err(&format!(".{ext} 해제"), e))?;
                }
                // 우리가 만든 빈 키만 정리 (다른 앱 값이 있으면 그대로 둠)
                delete_if_empty(&root, &format!(r"{CLASSES}\.{ext}\OpenWithProgids"));
                delete_if_empty(&root, &format!(r"{CLASSES}\.{ext}"));
                if let Ok(caps) = root.open_subkey_with_flags(CAPS_ASSOC_KEY, winreg::enums::KEY_SET_VALUE) {
                    ignore_missing(caps.delete_value(format!(".{ext}")))
                        .map_err(|e| reg_err(&format!(".{ext} 해제"), e))?;
                }
            }
            remove_app_registration_if_unused();
        }
        notify_shell();
        Ok(())
    }

    pub fn open_default_apps() -> AppResult<()> {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let registered = hkcu().open_subkey(CAPS_ASSOC_KEY).is_ok();
        // Windows 11: registeredAppUser 로 SSH Editor 항목 화면을 바로 연다
        let url = if registered {
            "ms-settings:defaultapps?registeredAppUser=SSH%20Editor"
        } else {
            "ms-settings:defaultapps"
        };
        let op = wide("open");
        let target = wide(url);
        // SAFETY: NUL 종료된 버퍼, 나머지 인자는 null 허용
        let h = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if (h as isize) <= 32 {
            return Err(AppError::Other(format!("Windows 기본 앱 설정을 열 수 없습니다 (코드 {})", h as isize)));
        }
        Ok(())
    }

    /// 클래스의 open 명령이 SSH Editor 실행 파일을 가리키는지
    fn class_points_to_us(root: &RegKey, class: &str) -> bool {
        root.open_subkey(format!(r"{CLASSES}\{class}\shell\open\command"))
            .and_then(|k| k.get_value::<String, _>(""))
            .map(|cmd| cmd.to_ascii_lowercase().contains("ssh-editor.exe"))
            .unwrap_or(false)
    }

    /// 0.1.1 이하 설치파일은 .ext 기본 클래스를 직접 덮어썼다(APP_ASSOCIATE).
    /// 업그레이드 후에도 남아 있으면 '자동 연결 안 함' 정책과 어긋나므로 원래대로 되돌린다.
    fn cleanup_legacy(root: &RegKey) -> bool {
        let Ok(classes) = root.open_subkey(CLASSES) else { return false };
        let ours: Vec<&str> = LEGACY_CLASSES
            .iter()
            .copied()
            .filter(|c| class_points_to_us(root, c))
            .collect();
        if ours.is_empty() {
            return false;
        }
        let mut changed = false;
        for name in classes.enum_keys().filter_map(Result::ok).filter(|n| n.starts_with('.')) {
            let Ok(key) = classes.open_subkey_with_flags(&name, winreg::enums::KEY_READ | winreg::enums::KEY_SET_VALUE)
            else {
                continue;
            };
            let current: String = key.get_value("").unwrap_or_default();
            for class in &ours {
                let backup_name = format!("{class}_backup");
                let Ok(backup) = key.get_value::<String, _>(&backup_name) else { continue };
                if current == *class {
                    if backup.is_empty() || backup == *class {
                        let _ = key.delete_value("");
                    } else {
                        let _ = key.set_value("", &backup);
                    }
                }
                let _ = key.delete_value(&backup_name);
                changed = true;
            }
        }
        for class in ours {
            let _ = root.delete_subkey_all(format!(r"{CLASSES}\{class}"));
            changed = true;
        }
        changed
    }

    pub fn maintenance() -> AppResult<()> {
        let root = hkcu();
        let mut changed = cleanup_legacy(&root);
        // 사용자가 연결해 둔 확장자가 있으면 실행 경로(포터블 이동·재설치 경로 변경)를 갱신
        let has_assoc = root
            .open_subkey(CAPS_ASSOC_KEY)
            .map(|k| k.enum_values().next().is_some())
            .unwrap_or(false);
        if has_assoc {
            let exe = current_exe()?;
            let expected = format!("\"{}\" \"%1\"", exe.to_string_lossy());
            let actual: Option<String> = root
                .open_subkey(format!(r"{CLASSES}\{PROG_ID}\shell\open\command"))
                .and_then(|k| k.get_value(""))
                .ok();
            if actual.as_deref() != Some(expected.as_str()) {
                write_app_registration(&exe)?;
                changed = true;
            }
        }
        if changed {
            notify_shell();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_ext;

    #[test]
    fn normalizes_extensions() {
        assert_eq!(normalize_ext(".TXT").as_deref(), Some("txt"));
        assert_eq!(normalize_ext("*.c++").as_deref(), Some("c++"));
        assert_eq!(normalize_ext(" rs ").as_deref(), Some("rs"));
        assert_eq!(normalize_ext(""), None);
        assert_eq!(normalize_ext(r"a\b"), None);
        assert_eq!(normalize_ext("a b"), None);
    }

    /// 실제 HKCU 레지스트리를 사용하는 왕복 테스트 — `cargo test -- --ignored`로만 실행
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn registry_round_trip() {
        let ext = vec!["zzsshedtest".to_string()];
        super::win::set(&ext, true).unwrap();
        let on = super::win::status(&ext).unwrap();
        assert!(on.items[0].registered);
        super::win::set(&ext, false).unwrap();
        let off = super::win::status(&ext).unwrap();
        assert!(!off.items[0].registered);
    }
}
