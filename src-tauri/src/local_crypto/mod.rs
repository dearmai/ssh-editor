//! 로컬 파일 보관(암호화)/보관 해제(복호화) — ChaCha20-Poly1305 + Argon2id 키 유도
//!
//! 파일 형식: `매직(16) || salt(16) || nonce(12) || ciphertext || tag(16)`
//! 매직은 "이 앱이 보관한 파일"임을 식별할 뿐, 알고리즘·버전 정보는 기록하지 않는다.
//! 따라서 KDF 파라미터는 코드에 고정되어 있으며 바꾸면 기존 파일을 복호화할 수 없다.

mod explorer;
mod targets;

pub use explorer::{
    explorer_menu_maintenance, explorer_menu_set, explorer_menu_status, startup_request, Startup,
    SEAL_FLAG,
};

use crate::error::{AppError, AppResult};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    ChaCha20Poly1305, Key, Nonce,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 보관 파일 식별용 매직 바이트 — 식별 문자열의 SHA-256 앞 16바이트 (원문은 테스트에만 둔다).
/// 릴리스 바이너리에 원문이 남지 않도록 계산값만 상수로 둔다.
pub const SEALED_MAGIC: &[u8] = &[
    0x51, 0x58, 0x95, 0x47, 0x79, 0xf7, 0x9f, 0x29, 0x98, 0x21, 0x2a, 0x7c, 0xea, 0xd9, 0xcc, 0x6a,
];
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Encrypt,
    Decrypt,
}

/// 고정 KDF 파라미터 (Argon2id, 19 MiB, 2회, 병렬 1 — OWASP 권장 최소값)
fn derive_key(password: &str, salt: &[u8]) -> AppResult<Key> {
    let params = Params::new(19 * 1024, 2, 1, Some(32))
        .map_err(|e| AppError::Other(format!("키 유도 설정 오류: {e}")))?;
    let mut key = Key::default();
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Other(format!("키 유도 실패: {e}")))?;
    Ok(key)
}

fn encrypt_bytes(plain: &[u8], password: &str) -> AppResult<Vec<u8>> {
    let mut salt = [0u8; SALT_LEN];
    chacha20poly1305::aead::rand_core::RngCore::fill_bytes(&mut OsRng, &mut salt);
    let key = derive_key(password, &salt)?;
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let cipher = ChaCha20Poly1305::new(&key)
        .encrypt(&nonce, plain)
        .map_err(|_| AppError::Other("보관 실패".into()))?;
    let mut out = Vec::with_capacity(SEALED_MAGIC.len() + SALT_LEN + NONCE_LEN + cipher.len());
    out.extend_from_slice(SEALED_MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&cipher);
    Ok(out)
}

fn decrypt_bytes(data: &[u8], password: &str) -> AppResult<Vec<u8>> {
    let Some(data) = data.strip_prefix(SEALED_MAGIC) else {
        return Err(AppError::Other("보관된 파일이 아닙니다".into()));
    };
    let bad = || AppError::Other("비밀번호가 틀렸거나 파일이 손상되었습니다".into());
    if data.len() < SALT_LEN + NONCE_LEN + TAG_LEN {
        return Err(bad());
    }
    let (salt, rest) = data.split_at(SALT_LEN);
    let (nonce, cipher) = rest.split_at(NONCE_LEN);
    let key = derive_key(password, salt)?;
    ChaCha20Poly1305::new(&key)
        .decrypt(Nonce::from_slice(nonce), cipher)
        .map_err(|_| bad())
}

/// 보관(암호화)된 파일인지 헤더로 판별
pub fn is_sealed(data: &[u8]) -> bool {
    data.starts_with(SEALED_MAGIC)
}

/// 확장자 입력 정규화: 공백 제거, 비어 있지 않으면 앞에 '.' 보장
fn normalize_ext(ext: Option<&str>) -> Option<String> {
    let ext = ext?.trim().trim_start_matches('.');
    (!ext.is_empty()).then(|| format!(".{ext}"))
}

fn encrypted_path(src: &Path, ext: Option<&str>) -> PathBuf {
    match ext {
        Some(ext) => {
            let mut name = src.file_name().unwrap_or_default().to_os_string();
            name.push(ext);
            src.with_file_name(name)
        }
        None => src.to_path_buf(),
    }
}

fn decrypted_path(src: &Path, ext: Option<&str>) -> PathBuf {
    let (Some(ext), Some(name)) = (ext, src.file_name().and_then(|n| n.to_str())) else {
        return src.to_path_buf();
    };
    if name.len() > ext.len() && name.to_lowercase().ends_with(&ext.to_lowercase()) {
        src.with_file_name(&name[..name.len() - ext.len()])
    } else {
        src.to_path_buf()
    }
}

/// 같은 폴더의 임시 파일에 쓴 뒤 교체한다. 대상이 원본과 다르면 원본을 삭제한다.
fn replace_file(src: &Path, dst: &Path, bytes: &[u8]) -> AppResult<()> {
    if dst != src && dst.exists() {
        return Err(AppError::Other(format!("대상 파일이 이미 존재합니다: {}", dst.display())));
    }
    let tmp = dst.with_file_name(format!(
        ".{}.{}.tmp",
        dst.file_name().unwrap_or_default().to_string_lossy(),
        uuid::Uuid::new_v4().simple()
    ));
    if let Err(e) = std::fs::write(&tmp, bytes).and_then(|_| std::fs::rename(&tmp, dst)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    if dst != src {
        std::fs::remove_file(src)?;
    }
    Ok(())
}

/// 파일 하나 처리 (차단 경로 재확인 포함) → 결과 파일 경로
fn run_one(path: &str, password: &str, ext: Option<&str>, mode: Mode) -> AppResult<String> {
    let src = targets::canonical(Path::new(path))?;
    if let Some(reason) = targets::blocked_reason(&src) {
        return Err(AppError::Other(reason));
    }
    if !std::fs::symlink_metadata(&src)?.is_file() {
        return Err(AppError::Other("일반 파일이 아닙니다".into()));
    }
    let ext = normalize_ext(ext);
    let data = std::fs::read(&src)?;
    let (out, dst) = match mode {
        Mode::Encrypt if is_sealed(&data) => return Err(AppError::Other("이미 보관된 파일입니다".into())),
        Mode::Encrypt => (encrypt_bytes(&data, password)?, encrypted_path(&src, ext.as_deref())),
        Mode::Decrypt => (decrypt_bytes(&data, password)?, decrypted_path(&src, ext.as_deref())),
    };
    replace_file(&src, &dst, &out)?;
    Ok(targets::display_path(&dst))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    pub path: String,
    pub output: Option<String>,
    pub error: Option<String>,
}

fn run_batch(paths: &[String], password: &str, ext: Option<&str>, mode: Mode) -> AppResult<Vec<BatchItem>> {
    if password.is_empty() {
        return Err(AppError::Other("비밀번호를 입력하세요".into()));
    }
    if paths.len() >= targets::MAX_FILES {
        return Err(targets::too_many());
    }
    Ok(paths
        .iter()
        .map(|path| match run_one(path, password, ext, mode) {
            Ok(output) => BatchItem { path: path.clone(), output: Some(output), error: None },
            Err(e) => BatchItem { path: path.clone(), output: None, error: Some(e.to_string()) },
        })
        .collect())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
}

/// 선택한 파일·폴더를 처리 대상 파일 목록으로 펼친다 (루트·시스템 폴더·5개 이상 차단).
/// mode 생략 시 대상 상태로 보관/보관 해제를 자동 판단한다.
#[tauri::command]
pub async fn local_crypto_plan(paths: Vec<String>, mode: Option<Mode>) -> AppResult<targets::Plan> {
    blocking(move || targets::plan(&paths, mode)).await
}

/// 대상 파일들을 보관/보관 해제한다. 파일별 성공·실패를 돌려준다.
#[tauri::command]
pub async fn local_crypto_batch(
    paths: Vec<String>,
    password: String,
    extension: Option<String>,
    mode: Mode,
) -> AppResult<Vec<BatchItem>> {
    blocking(move || run_batch(&paths, &password, extension.as_deref(), mode)).await
}

/// 탐색기 메뉴로 실행됐을 때의 요청 (프론트가 한 번 가져감)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CryptoRequest {
    pub paths: Vec<String>,
}

pub struct PendingCrypto(pub Mutex<Option<CryptoRequest>>);

#[tauri::command]
pub fn take_crypto_request(state: tauri::State<'_, PendingCrypto>) -> Option<CryptoRequest> {
    state.0.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_wrong_password() {
        let enc = encrypt_bytes("안녕하세요".as_bytes(), "pw").unwrap();
        assert_eq!(enc.len(), SEALED_MAGIC.len() + SALT_LEN + NONCE_LEN + "안녕하세요".len() + TAG_LEN);
        assert!(is_sealed(&enc));
        assert_eq!(decrypt_bytes(&enc, "pw").unwrap(), "안녕하세요".as_bytes());
        assert!(decrypt_bytes(&enc, "nope").is_err());
        assert!(decrypt_bytes(&enc[SEALED_MAGIC.len()..], "pw").is_err());
        assert!(decrypt_bytes(b"short", "pw").is_err());
    }

    /// 매직 상수가 식별 문자열의 SHA-256 앞 16바이트와 일치하는지
    #[test]
    fn magic_is_sha256_prefix() {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(b"application/vnd.ssh-editor.sealed");
        assert_eq!(SEALED_MAGIC, &digest[..16]);
    }

    #[test]
    fn paths() {
        let ext = normalize_ext(Some("data"));
        assert_eq!(ext.as_deref(), Some(".data"));
        assert_eq!(normalize_ext(Some("  ")), None);
        let p = Path::new("/a/b.txt");
        assert_eq!(encrypted_path(p, ext.as_deref()), Path::new("/a/b.txt.data"));
        assert_eq!(encrypted_path(p, None), p);
        assert_eq!(decrypted_path(Path::new("/a/b.txt.DATA"), ext.as_deref()), Path::new("/a/b.txt"));
        assert_eq!(decrypted_path(p, ext.as_deref()), p);
        assert_eq!(decrypted_path(Path::new("/a/.data"), ext.as_deref()), Path::new("/a/.data"));
    }

    #[test]
    fn folder_round_trip() {
        let dir = std::env::temp_dir().join(format!("ssh-editor-crypto-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.txt"), "비밀 A").unwrap();
        std::fs::write(dir.join("sub/b.txt"), "비밀 B").unwrap();
        let root = vec![dir.to_string_lossy().into_owned()];

        let plan = targets::plan(&root, None).unwrap();
        assert_eq!((plan.mode, plan.files.len()), (Mode::Encrypt, 2));
        let res = run_batch(&plan.files, "pw", Some(".data"), Mode::Encrypt).unwrap();
        assert!(res.iter().all(|r| r.error.is_none()));
        assert!(dir.join("a.txt.data").exists() && !dir.join("a.txt").exists());
        // 이미 보관된 파일은 다시 보관 대상에서 제외
        let again = targets::plan(&root, Some(Mode::Encrypt)).unwrap();
        assert_eq!((again.files.len(), again.skipped), (0, 2));

        // 모두 보관된 상태 → 자동으로 보관 해제
        let plan = targets::plan(&root, None).unwrap();
        assert_eq!((plan.mode, plan.files.len()), (Mode::Decrypt, 2));
        let wrong = run_batch(&plan.files, "x", Some(".data"), Mode::Decrypt).unwrap();
        assert!(wrong.iter().all(|r| r.error.is_some()));
        let res = run_batch(&plan.files, "pw", Some(".data"), Mode::Decrypt).unwrap();
        assert!(res.iter().all(|r| r.error.is_none()));
        assert_eq!(std::fs::read_to_string(dir.join("sub/b.txt")).unwrap(), "비밀 B");

        // 확장자 미지정 → 제자리 교체
        let a = vec![dir.join("a.txt").to_string_lossy().into_owned()];
        run_batch(&a, "pw", None, Mode::Encrypt).unwrap();
        assert!(is_sealed(&std::fs::read(dir.join("a.txt")).unwrap()));
        run_batch(&a, "pw", Some(""), Mode::Decrypt).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "비밀 A");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
