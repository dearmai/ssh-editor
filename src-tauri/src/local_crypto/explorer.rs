//! 탐색기 우클릭 메뉴 연동 (Windows)
//!
//! 레지스트리 (HKCU — 관리자 권한 불필요, 파일·폴더 모두)
//!   HKCU\Software\Classes\AllFilesystemObjects\shell\SSHEditor.Seal  → "exe" --seal "%1"
//! 메뉴는 "보관/해제" 하나 — 보관할지 해제할지는 앱이 대상 파일 상태로 판단한다.
//!
//! 탐색기는 여러 항목을 선택하면 항목마다 프로세스를 하나씩 띄운다. 창이 여러 개 뜨고
//! 비밀번호를 여러 번 묻지 않도록, 각 프로세스는 임시 폴더의 큐 파일에 경로를 적고
//! 잠금 폴더를 먼저 만든 프로세스(리더)만 큐를 모아 창을 띄운다. 나머지는 바로 종료한다.

use super::{targets::display_path, CryptoRequest};
use crate::error::AppResult;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const SEAL_FLAG: &str = "--seal";

pub enum Startup {
    /// 보관 요청 없이 일반 실행
    Normal,
    /// 이 프로세스가 모은 요청을 처리한다
    Request(CryptoRequest),
    /// 다른 프로세스가 요청을 맡았으므로 바로 종료한다
    Exit,
}

fn parse(args: &[String]) -> Option<PathBuf> {
    if args.first()? != SEAL_FLAG {
        return None;
    }
    std::fs::canonicalize(args.get(1)?).ok()
}

fn age(p: &Path) -> Duration {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .unwrap_or_default()
}

fn size(p: &Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

/// 실행 인자를 해석해 보관 요청을 모은다 (Tauri 시작 전에 호출)
pub fn startup_request(args: impl IntoIterator<Item = String>) -> Startup {
    let args: Vec<String> = args.into_iter().collect();
    let Some(path) = parse(&args) else {
        return if args.first().is_some_and(|a| a == SEAL_FLAG) {
            Startup::Exit // 대상 경로가 없거나 사라짐
        } else {
            Startup::Normal
        };
    };
    match gather(&std::env::temp_dir().join("ssh-editor-seal"), &path) {
        Ok(Some(paths)) => Startup::Request(CryptoRequest { paths }),
        Ok(None) => Startup::Exit,
        Err(e) => {
            log::warn!("보관 요청 수집 실패: {e}");
            Startup::Request(CryptoRequest { paths: vec![display_path(&path)] })
        }
    }
}

/// 리더면 모은 경로 목록, 팔로워면 None
fn gather(dir: &Path, path: &Path) -> std::io::Result<Option<Vec<String>>> {
    std::fs::create_dir_all(dir)?;
    let tag = "seal";
    let queue = dir.join(format!("{tag}.queue"));
    let lock = dir.join(format!("{tag}.lock"));

    // 한 줄 단위 append 는 짧아서 프로세스 간에 섞이지 않는다
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&queue)?
        .write_all(format!("{}\n", display_path(path)).as_bytes())?;

    let start = Instant::now();
    loop {
        if std::fs::create_dir(&lock).is_ok() {
            break;
        }
        // 리더가 큐를 가져갔다 → 내 경로도 포함됨
        if !queue.exists() {
            return Ok(None);
        }
        // 리더가 비정상 종료해 잠금이 남은 경우
        if age(&lock) > Duration::from_secs(15) {
            let _ = std::fs::remove_dir(&lock);
        }
        if start.elapsed() > Duration::from_secs(30) {
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // 리더: 탐색기가 나머지 프로세스를 다 띄울 때까지 큐 크기가 잠잠해지길 기다린다
    let mut last = size(&queue);
    let mut quiet = Instant::now();
    while quiet.elapsed() < Duration::from_millis(800) && start.elapsed() < Duration::from_secs(8) {
        std::thread::sleep(Duration::from_millis(50));
        let now = size(&queue);
        if now != last {
            last = now;
            quiet = Instant::now();
        }
    }
    let taken = dir.join(format!("{tag}.{}.taken", uuid::Uuid::new_v4().simple()));
    let result = std::fs::rename(&queue, &taken).and_then(|_| std::fs::read_to_string(&taken));
    let _ = std::fs::remove_file(&taken);
    let _ = std::fs::remove_dir(&lock);
    let text = match result {
        // 잠금을 얻기 직전에 이전 리더가 내 경로까지 가져간 경우
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        other => other?,
    };
    let mut paths: Vec<String> = text.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect();
    paths.sort();
    paths.dedup();
    Ok((!paths.is_empty()).then_some(paths))
}

/// 탐색기 메뉴 등록 여부 (Windows 외에는 항상 false)
#[tauri::command]
pub fn explorer_menu_status() -> bool {
    #[cfg(windows)]
    {
        win::is_registered()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 탐색기 메뉴 등록(enabled=true) / 제거(enabled=false)
#[tauri::command]
pub fn explorer_menu_set(enabled: bool) -> AppResult<()> {
    #[cfg(windows)]
    {
        if enabled {
            win::register()
        } else {
            win::unregister()
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err(crate::error::AppError::Other("탐색기 메뉴는 Windows에서만 지원합니다.".into()))
    }
}

/// 앱 시작 시 — 메뉴가 등록되어 있으면 실행 파일 경로(포터블 이동 등)를 최신으로 맞춘다
pub fn explorer_menu_maintenance() {
    #[cfg(windows)]
    std::thread::spawn(|| {
        if win::is_registered() && !win::is_current() {
            if let Err(e) = win::register() {
                log::warn!("탐색기 메뉴 갱신 실패: {e}");
            }
        }
    });
}

#[cfg(windows)]
mod win {
    use super::SEAL_FLAG;
    use crate::error::{AppError, AppResult};
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const SHELL: &str = r"Software\Classes\AllFilesystemObjects\shell";
    const VERB: &str = "SSHEditor.Seal";
    const LABEL: &str = "보관/해제 (SSH Editor)";
    /// 메뉴를 하나로 합치기 전의 별도 해제 항목 — 남아 있으면 정리한다
    const LEGACY_VERB: &str = "SSHEditor.Unseal";

    fn hkcu() -> RegKey {
        RegKey::predef(HKEY_CURRENT_USER)
    }

    fn err(ctx: &str, e: std::io::Error) -> AppError {
        AppError::Other(format!("{ctx}: {e}"))
    }

    fn exe() -> AppResult<String> {
        let exe = std::env::current_exe().map_err(|e| err("실행 파일 경로 확인 실패", e))?;
        Ok(exe.to_string_lossy().into_owned())
    }

    fn command_for(exe: &str, flag: &str) -> String {
        format!("\"{exe}\" {flag} \"%1\"")
    }

    fn notify_shell() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        // SAFETY: SHCNE_ASSOCCHANGED는 item 포인터를 사용하지 않는다
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as _, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }

    fn registered_command(key: &str) -> Option<String> {
        hkcu()
            .open_subkey(format!(r"{SHELL}\{key}\command"))
            .and_then(|k| k.get_value(""))
            .ok()
    }

    pub fn is_registered() -> bool {
        registered_command(VERB).is_some()
    }

    /// 등록된 명령이 현재 실행 파일·현재 메뉴 구성과 일치하는지
    pub fn is_current() -> bool {
        let Ok(exe) = exe() else { return true };
        let label: Option<String> = hkcu().open_subkey(format!(r"{SHELL}\{VERB}")).and_then(|k| k.get_value("MUIVerb")).ok();
        registered_command(VERB).as_deref() == Some(command_for(&exe, SEAL_FLAG).as_str())
            && label.as_deref() == Some(LABEL)
            && registered_command(LEGACY_VERB).is_none()
    }

    fn delete_verb(key: &str) -> AppResult<()> {
        match hkcu().delete_subkey_all(format!(r"{SHELL}\{key}")) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err("탐색기 메뉴 제거", e)),
            _ => Ok(()),
        }
    }

    pub fn register() -> AppResult<()> {
        let exe = exe()?;
        let w = |e| err("탐색기 메뉴 등록", e);
        delete_verb(LEGACY_VERB)?;
        let (verb, _) = hkcu().create_subkey(format!(r"{SHELL}\{VERB}")).map_err(w)?;
        verb.set_value("MUIVerb", &LABEL).map_err(w)?;
        verb.set_value("Icon", &format!("\"{exe}\",0")).map_err(w)?;
        // 여러 항목 선택 시에도 메뉴 표시 (기본값은 15개 제한)
        verb.set_value("MultiSelectModel", &"Player").map_err(w)?;
        let (cmd, _) = verb.create_subkey("command").map_err(w)?;
        cmd.set_value("", &command_for(&exe, SEAL_FLAG)).map_err(w)?;
        notify_shell();
        Ok(())
    }

    pub fn unregister() -> AppResult<()> {
        delete_verb(VERB)?;
        delete_verb(LEGACY_VERB)?;
        notify_shell();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flags_and_gathers_queue() {
        let file = std::env::temp_dir().join(format!("ssh-editor-cli-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&file, "x").unwrap();
        let p = file.to_string_lossy().into_owned();
        assert!(matches!(startup_request(vec![p.clone()]), Startup::Normal));
        assert!(matches!(startup_request(vec![SEAL_FLAG.into()]), Startup::Exit));
        assert!(crate::local_files::cli_files(vec![SEAL_FLAG.into(), p.clone()]).is_empty());
        assert!(matches!(startup_request(vec!["--unseal".into(), p.clone()]), Startup::Normal));
        match startup_request(vec![SEAL_FLAG.into(), p]) {
            Startup::Request(req) => {
                assert_eq!(req.paths.len(), 1);
                assert!(!req.paths[0].contains('\\') && !req.paths[0].starts_with("//?/"));
            }
            _ => panic!("요청이 수집되어야 함"),
        }
        std::fs::remove_file(file).unwrap();
    }

    /// 탐색기 다중 선택처럼 동시에 여러 번 실행돼도 리더 하나가 전부 모은다
    #[test]
    fn concurrent_launches_elect_one_leader() {
        let dir = std::env::temp_dir().join(format!("ssh-editor-multi-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let files: Vec<PathBuf> = (0..4)
            .map(|i| {
                let f = dir.join(format!("{i}.txt"));
                std::fs::write(&f, "x").unwrap();
                std::fs::canonicalize(f).unwrap()
            })
            .collect();
        let queue_dir = dir.join("queue");
        let handles: Vec<_> = files
            .iter()
            .cloned()
            .map(|f| {
                let q = queue_dir.clone();
                std::thread::spawn(move || gather(&q, &f).unwrap())
            })
            .collect();
        let results: Vec<_> = handles.into_iter().filter_map(|h| h.join().unwrap()).collect();
        assert_eq!(results.len(), 1, "리더는 하나여야 함");
        assert_eq!(results[0].len(), files.len());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
