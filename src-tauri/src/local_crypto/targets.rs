//! 보관 대상 수집 — 선택한 파일·폴더를 파일 목록으로 펼치고 위험한 대상은 차단한다.
//!
//! 차단 규칙
//! - 드라이브/파일시스템 루트 (C:\, /)
//! - 시스템 폴더와 그 하위 (Windows, Program Files, ProgramData, /usr, /etc, /System …)
//! - 홈 폴더·사용자 폴더 자체 (C:\Users\me, /home/me — 그 하위 폴더는 허용)
//! - 대상 파일이 MAX_FILES(5)개 이상

use super::{is_sealed, Mode, SEALED_MAGIC};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const MAX_FILES: usize = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// 결정된 동작 (자동 모드면 대상 상태로 판단)
    pub mode: Mode,
    /// 실제 처리할 파일 (표시용 경로, '/' 구분)
    pub files: Vec<String>,
    /// 모드에 맞지 않아 제외된 파일 수 (보관 시 이미 보관된 파일, 해제 시 보관되지 않은 파일)
    pub skipped: usize,
}

pub fn canonical(p: &Path) -> AppResult<PathBuf> {
    std::fs::canonicalize(p).map_err(|e| AppError::Other(format!("{}: {e}", p.display())))
}

/// 표시·IPC용 경로: Windows 확장 경로 접두사(\\?\) 제거 + '/' 구분자
pub fn display_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    let s = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else {
        s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
    };
    s.replace('\\', "/")
}

fn canon_list(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    paths.into_iter().filter_map(|p| std::fs::canonicalize(p).ok()).collect()
}

/// 하위까지 모두 차단하는 시스템 폴더
fn system_dirs() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut v: Vec<PathBuf> = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"]
            .iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .collect();
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        for d in ["$Recycle.Bin", "System Volume Information", "Recovery", "Boot"] {
            v.push(PathBuf::from(format!(r"{drive}\{d}")));
        }
        canon_list(v)
    }
    #[cfg(not(windows))]
    {
        canon_list(
            [
                "/bin", "/sbin", "/usr", "/etc", "/var", "/lib", "/lib32", "/lib64", "/boot", "/dev",
                "/proc", "/sys", "/run", "/snap", "/opt", "/System", "/Library", "/Applications",
                "/private/etc", "/private/var/db", "/cores",
            ]
            .map(PathBuf::from),
        )
    }
}

/// 그 자체만 차단하는 폴더 (하위 폴더는 허용)
fn exact_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(home) = dirs::home_dir() {
        if let Some(parent) = home.parent() {
            v.push(parent.to_path_buf());
        }
        v.push(home);
    }
    #[cfg(not(windows))]
    v.extend(["/home", "/Users", "/Volumes", "/mnt", "/media", "/private", "/tmp"].map(PathBuf::from));
    canon_list(v)
}

/// 차단 사유 (허용이면 None). `p`는 canonical 경로여야 한다.
pub fn blocked_reason(p: &Path) -> Option<String> {
    if p.parent().is_none() {
        return Some(format!("루트 경로는 대상으로 지정할 수 없습니다: {}", display_path(p)));
    }
    // 임시 폴더는 사용자 영역이므로 허용 (macOS는 /private/var 아래에 있다)
    let in_temp = std::fs::canonicalize(std::env::temp_dir()).is_ok_and(|t| p.starts_with(&t) && p != t);
    if !in_temp && system_dirs().iter().any(|d| p.starts_with(d)) {
        return Some(format!("시스템 폴더는 대상으로 지정할 수 없습니다: {}", display_path(p)));
    }
    if exact_dirs().iter().any(|d| p == d) {
        return Some(format!("홈·사용자 폴더 전체는 대상으로 지정할 수 없습니다: {}", display_path(p)));
    }
    None
}

pub fn too_many() -> AppError {
    AppError::Other(format!("{MAX_FILES}개 이상의 파일은 한 번에 보관하거나 해제할 수 없습니다"))
}

/// 폴더를 재귀로 펼친다. 심볼릭 링크는 따라가지 않는다.
fn walk(p: &Path, out: &mut BTreeSet<PathBuf>) -> AppResult<()> {
    let meta = std::fs::symlink_metadata(p)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_file() {
        out.insert(p.to_path_buf());
        if out.len() >= MAX_FILES {
            return Err(too_many());
        }
    } else if meta.is_dir() {
        for entry in std::fs::read_dir(p)? {
            walk(&entry?.path(), out)?;
        }
    }
    Ok(())
}

fn has_sealed_header(p: &Path) -> bool {
    let mut buf = vec![0u8; SEALED_MAGIC.len()];
    std::fs::File::open(p)
        .and_then(|f| f.take(buf.len() as u64).read_exact(&mut buf))
        .is_ok_and(|_| is_sealed(&buf))
}

/// `mode`가 None이면 자동 판단: 대상이 모두 보관된 파일이면 보관 해제, 아니면 보관
pub fn plan(paths: &[String], mode: Option<Mode>) -> AppResult<Plan> {
    if paths.is_empty() {
        return Err(AppError::Other("대상을 선택하세요".into()));
    }
    let mut all = BTreeSet::new();
    for raw in paths {
        let p = canonical(Path::new(raw))?;
        if let Some(reason) = blocked_reason(&p) {
            return Err(AppError::Other(reason));
        }
        walk(&p, &mut all)?;
    }
    let total = all.len();
    let tagged: Vec<(PathBuf, bool)> = all.into_iter().map(|p| { let s = has_sealed_header(&p); (p, s) }).collect();
    let mode = mode.unwrap_or(if !tagged.is_empty() && tagged.iter().all(|(_, s)| *s) {
        Mode::Decrypt
    } else {
        Mode::Encrypt
    });
    let files: Vec<String> = tagged
        .into_iter()
        .filter(|(_, sealed)| *sealed == (mode == Mode::Decrypt))
        .map(|(p, _)| display_path(&p))
        .collect();
    Ok(Plan { mode, skipped: total - files.len(), files })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_root_system_and_home() {
        let root = canonical(Path::new(if cfg!(windows) { r"C:\" } else { "/" })).unwrap();
        assert!(blocked_reason(&root).is_some());
        if let Some(home) = dirs::home_dir() {
            assert!(blocked_reason(&canonical(&home).unwrap()).is_some());
        }
        #[cfg(windows)]
        {
            let win = canonical(Path::new(&std::env::var("SystemRoot").unwrap())).unwrap();
            assert!(blocked_reason(&win).is_some());
            assert!(blocked_reason(&win.join("System32")).is_some());
        }
        #[cfg(not(windows))]
        assert!(blocked_reason(&canonical(Path::new("/etc")).unwrap()).is_some());
        let tmp = std::env::temp_dir().join(format!("ssh-editor-ok-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        assert!(blocked_reason(&canonical(&tmp).unwrap()).is_none());
        std::fs::remove_dir_all(tmp).unwrap();
    }

    #[test]
    fn blocks_100_files() {
        let dir = std::env::temp_dir().join(format!("ssh-editor-many-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..MAX_FILES - 1 {
            std::fs::write(dir.join(format!("{i}.txt")), "x").unwrap();
        }
        let arg = vec![dir.to_string_lossy().into_owned()];
        assert_eq!(plan(&arg, None).unwrap().files.len(), MAX_FILES - 1);
        std::fs::write(dir.join("last.txt"), "x").unwrap();
        assert!(plan(&arg, None).is_err());
        assert!(!display_path(&canonical(&dir).unwrap()).contains('\\'));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
