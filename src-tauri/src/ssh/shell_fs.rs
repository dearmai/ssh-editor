//! SFTP 서브시스템이 막힌 서버용 대체 파일 접근 (exec 채널 + POSIX sh).
//!
//! - Linux: GNU `stat`
//! - macOS/BSD: BSD `stat`
//! - AIX: 기본 설치에 `stat` 명령이 없어 기본 포함된 `perl`의 stat/readdir 사용
//!
//! 로그인 셸(csh/ksh 등)과 무관하게 동작하도록 셸 스크립트는 `sh -c '<스크립트>' sh <인자...>`로,
//! perl은 `perl -e '<스크립트>' <인자...>`로 실행하고 경로는 위치 인자로만 전달한다.
//! GNU 전용 옵션(`--`, `head -c`, `find -printf` 등)은 쓰지 않는다.

use crate::error::{AppError, AppResult};
use crate::ssh::connection::{shell_quote, SshClientHandler, SshSession};
use crate::ssh::sftp::{FileEntry, FileStat};
use russh::{client, Channel, ChannelMsg};

/// 파일 메타데이터 조회 수단 (접속 시 판정)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatTool {
    Gnu,
    Bsd,
    Perl,
}

/// 대체 경로에 필요한 POSIX 기본 명령
const REQUIRED_COMMANDS: &str = "cat mv rm rmdir mkdir dd";

const PROBE_SCRIPT: &str = concat!(
    "if stat -L -c %f / >/dev/null 2>&1; then echo stat:gnu; ",
    "elif stat -L -f %Xp / >/dev/null 2>&1; then echo stat:bsd; ",
    "elif perl -e 1 >/dev/null 2>&1; then echo stat:perl; ",
    "else echo stat:none; fi; ",
    "for c in cat mv rm rmdir mkdir dd; do command -v $c >/dev/null 2>&1 || echo missing:$c; done",
);

/// 출력 형식: `<16진수 mode>|<size>|<mtime>\n`
const PERL_STAT: &str = concat!(
    "my @s=stat($ARGV[0]); @s=lstat($ARGV[0]) unless @s; @s or die \"$!\\n\"; ",
    "printf \"%x|%d|%d\\n\",$s[2],$s[7],$s[9]",
);

/// 출력 형식: 항목마다 `<mode>|<size>|<mtime>\n<이름>\0`
const PERL_LIST: &str = concat!(
    "my $d=shift; opendir(my $h,$d) or die \"$!\\n\"; ",
    "for my $n (readdir $h) { next if $n eq \".\" or $n eq \"..\"; ",
    "my @s=stat(\"$d/$n\"); @s=lstat(\"$d/$n\") unless @s; @s=(0)x10 unless @s; ",
    "printf \"%x|%d|%d\\n%s\\0\",$s[2],$s[7],$s[9],$n }",
);

pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub code: Option<u32>,
}

impl ExecOutput {
    /// 종료 코드 0이 아니면 stderr를 담은 오류로 변환
    pub fn check(self, what: &str) -> AppResult<Vec<u8>> {
        if self.code == Some(0) {
            return Ok(self.stdout);
        }
        let msg = String::from_utf8_lossy(&self.stderr).trim().to_string();
        let detail = match (msg.is_empty(), self.code) {
            (false, _) => msg,
            (true, Some(code)) => format!("종료 코드 {}", code),
            (true, None) => "종료 상태 없음".to_string(),
        };
        Err(AppError::Other(format!("{} 실패: {}", what, detail)))
    }
}

/// `-`로 시작하는 경로가 옵션으로 해석되지 않게 `./`를 붙인다 (AIX는 `--` 지원을 보장할 수 없음)
fn path_arg(path: &str) -> String {
    let path = if path.starts_with('-') { format!("./{}", path) } else { path.to_string() };
    shell_quote(&path)
}

/// `sh -c '<script>' sh <args...>` 명령 문자열 생성 (인자는 모두 경로)
pub fn sh_command(script: &str, args: &[&str]) -> String {
    let mut cmd = format!("sh -c {} sh", shell_quote(script));
    for arg in args {
        cmd.push(' ');
        cmd.push_str(&path_arg(arg));
    }
    cmd
}

fn perl_command(script: &str, args: &[&str]) -> String {
    let mut cmd = format!("perl -e {}", shell_quote(script));
    for arg in args {
        cmd.push(' ');
        cmd.push_str(&path_arg(arg));
    }
    cmd
}

pub async fn open_exec(
    handle: &client::Handle<SshClientHandler>,
    cmd: &str,
) -> AppResult<Channel<client::Msg>> {
    let channel = handle.channel_open_session().await?;
    channel.exec(true, cmd).await?;
    Ok(channel)
}

/// 채널이 닫힐 때까지 stdout/stderr/종료 코드 수집.
/// 종료 코드는 EOF 뒤에 오는 서버가 많아 Close까지 기다린다.
pub async fn collect(mut channel: Channel<client::Msg>) -> ExecOutput {
    let mut out = ExecOutput { stdout: Vec::new(), stderr: Vec::new(), code: None };
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => out.stdout.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, .. } => out.stderr.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => out.code = Some(exit_status),
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    out
}

async fn exec_on(
    handle: &client::Handle<SshClientHandler>,
    cmd: &str,
    stdin: &[u8],
) -> AppResult<ExecOutput> {
    let channel = open_exec(handle, cmd).await?;
    if !stdin.is_empty() {
        channel.data(stdin).await?;
    }
    // 입력을 기다리는 명령(cat 등)이 끝나도록 항상 EOF 전송
    channel.eof().await?;
    Ok(collect(channel).await)
}

pub async fn exec(session: &SshSession, cmd: &str, stdin: &[u8]) -> AppResult<ExecOutput> {
    // 핸들 락은 채널 생성까지만 잡는다 — 긴 명령이 다른 요청을 막지 않게
    let channel = {
        let handle = session.handle.lock().await;
        open_exec(&handle, cmd).await?
    };
    if !stdin.is_empty() {
        channel.data(stdin).await?;
    }
    channel.eof().await?;
    Ok(collect(channel).await)
}

/// SFTP 대신 셸 명령으로 파일을 다룰 수 있는지 판정. 불가하면 사유를 반환한다.
pub async fn probe(handle: &client::Handle<SshClientHandler>) -> Result<StatTool, String> {
    let out = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        exec_on(handle, &sh_command(PROBE_SCRIPT, &[]), &[]),
    )
    .await
    .map_err(|_| "셸 명령 실행 시간 초과 (10초)".to_string())?
    .map_err(|e| format!("셸 명령 실행 불가: {}", e))?;

    let text = String::from_utf8_lossy(&out.stdout);
    let mut tool = None;
    let mut missing = Vec::new();
    for line in text.lines().map(str::trim) {
        match line {
            "stat:gnu" => tool = Some(StatTool::Gnu),
            "stat:bsd" => tool = Some(StatTool::Bsd),
            "stat:perl" => tool = Some(StatTool::Perl),
            _ => {
                if let Some(cmd) = line.strip_prefix("missing:") {
                    missing.push(cmd.to_string());
                }
            }
        }
    }
    if !text.contains("stat:") {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "셸 명령 실행이 차단되었거나 sh가 없습니다".to_string()
        } else {
            format!("셸 명령 실행 실패: {}", err)
        });
    }
    if !missing.is_empty() {
        return Err(format!(
            "필수 명령 없음: {} (필요: {})",
            missing.join(", "),
            REQUIRED_COMMANDS
        ));
    }
    tool.ok_or_else(|| "파일 정보 조회 수단 없음 (stat 또는 perl 필요)".to_string())
}

fn stat_command(tool: StatTool, path: &str) -> String {
    match tool {
        StatTool::Gnu => sh_command(
            "stat -L -c \"%f|%s|%Y\" \"$1\" 2>/dev/null || stat -c \"%f|%s|%Y\" \"$1\"",
            &[path],
        ),
        StatTool::Bsd => sh_command(
            "stat -L -f \"%Xp|%z|%m\" \"$1\" 2>/dev/null || stat -f \"%Xp|%z|%m\" \"$1\"",
            &[path],
        ),
        StatTool::Perl => perl_command(PERL_STAT, &[path]),
    }
}

fn list_command(tool: StatTool, path: &str) -> String {
    let (follow, nofollow) = match tool {
        StatTool::Gnu => ("stat -L -c \"%f|%s|%Y\"", "stat -c \"%f|%s|%Y\""),
        StatTool::Bsd => ("stat -L -f \"%Xp|%z|%m\"", "stat -f \"%Xp|%z|%m\""),
        StatTool::Perl => return perl_command(PERL_LIST, &[path]),
    };
    let script = format!(
        "cd \"$1\" || exit 1; for f in * .[!.]* ..?*; do \
         if [ -e \"$f\" ] || [ -L \"$f\" ]; then \
         {follow} \"./$f\" 2>/dev/null || {nofollow} \"./$f\" 2>/dev/null || echo \"0|0|0\"; \
         printf \"%s\\0\" \"$f\"; fi; done"
    );
    sh_command(&script, &[path])
}

/// `<16진수 mode>|<size>|<mtime>` 파싱
fn parse_meta(line: &str) -> (u32, u64, u64) {
    let mut parts = line.trim().split('|');
    let mode = u32::from_str_radix(parts.next().unwrap_or("0").trim(), 16).unwrap_or(0);
    let size = parts.next().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    let mtime = parts.next().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    (mode, size, mtime)
}

fn is_dir_mode(mode: u32) -> bool {
    mode & 0o170000 == 0o040000
}

fn parse_list(dir: &str, out: &[u8]) -> Vec<FileEntry> {
    out.split(|b| *b == 0)
        .filter_map(|chunk| {
            let nl = chunk.iter().position(|b| *b == b'\n')?;
            let name = String::from_utf8_lossy(&chunk[nl + 1..]).to_string();
            if name.is_empty() || name == "." || name == ".." {
                return None;
            }
            let (mode, size, mtime) = parse_meta(&String::from_utf8_lossy(&chunk[..nl]));
            let path = if dir.ends_with('/') {
                format!("{}{}", dir, name)
            } else {
                format!("{}/{}", dir, name)
            };
            Some(FileEntry {
                name,
                path,
                is_dir: is_dir_mode(mode),
                size,
                modified: (mtime > 0).then_some(mtime),
                permissions: (mode > 0).then_some(mode),
            })
        })
        .collect()
}

pub async fn list_dir(session: &SshSession, tool: StatTool, path: &str) -> AppResult<Vec<FileEntry>> {
    let out = exec(session, &list_command(tool, path), &[]).await?.check("디렉토리 목록 조회")?;
    Ok(parse_list(path, &out))
}

pub async fn stat(session: &SshSession, tool: StatTool, path: &str) -> AppResult<FileStat> {
    let out = exec(session, &stat_command(tool, path), &[]).await?.check("파일 정보 조회")?;
    let (_, size, mtime) = parse_meta(&String::from_utf8_lossy(&out));
    Ok(FileStat { size, mtime: (mtime > 0).then_some(mtime) })
}

pub async fn read_bytes(session: &SshSession, path: &str) -> AppResult<Vec<u8>> {
    exec(session, &sh_command("cat \"$1\"", &[path]), &[]).await?.check("파일 읽기")
}

/// 파일 앞부분 최대 `len` 바이트 (head -c는 AIX에서 보장되지 않아 dd 사용)
pub async fn read_head(session: &SshSession, path: &str, len: usize) -> AppResult<Vec<u8>> {
    let script = format!("dd if=\"$1\" bs={} count=1 2>/dev/null", len);
    exec(session, &sh_command(&script, &[path]), &[]).await?.check("파일 읽기")
}

/// stdin 내용으로 파일 덮어쓰기(append면 이어쓰기). 기존 파일의 권한·소유자는 유지된다.
pub async fn write_bytes(session: &SshSession, path: &str, data: &[u8], append: bool) -> AppResult<()> {
    let script = if append { "cat >> \"$1\"" } else { "cat > \"$1\"" };
    exec(session, &sh_command(script, &[path]), data).await?.check("파일 쓰기")?;
    Ok(())
}

pub async fn create_file(session: &SshSession, path: &str) -> AppResult<()> {
    exec(session, &sh_command(": > \"$1\"", &[path]), &[]).await?.check("파일 생성")?;
    Ok(())
}

/// SFTP와 동일하게 디렉토리는 비어 있을 때만 삭제
pub async fn delete_path(session: &SshSession, path: &str) -> AppResult<()> {
    let script = "if [ -d \"$1\" ] && [ ! -L \"$1\" ]; then rmdir \"$1\"; else rm \"$1\"; fi";
    exec(session, &sh_command(script, &[path]), &[]).await?.check("삭제")?;
    Ok(())
}

pub async fn remove_file_quiet(session: &SshSession, path: &str) {
    let _ = exec(session, &sh_command("rm -f \"$1\"", &[path]), &[]).await;
}

/// SFTP rename처럼 대상이 이미 있으면 실패한다 (mv의 덮어쓰기 방지)
pub async fn rename_path(session: &SshSession, from: &str, to: &str) -> AppResult<()> {
    let script = "if [ -e \"$2\" ] || [ -L \"$2\" ]; then echo \"대상이 이미 존재합니다: $2\" >&2; exit 1; fi; mv \"$1\" \"$2\"";
    exec(session, &sh_command(script, &[from, to]), &[]).await?.check("이름 변경")?;
    Ok(())
}

pub async fn exists(session: &SshSession, path: &str) -> AppResult<bool> {
    let out = exec(session, &sh_command("[ -e \"$1\" ] || [ -L \"$1\" ]", &[path]), &[]).await?;
    Ok(out.code == Some(0))
}

pub async fn create_dir(session: &SshSession, path: &str) -> AppResult<()> {
    exec(session, &sh_command("mkdir \"$1\"", &[path]), &[]).await?.check("폴더 생성")?;
    Ok(())
}

/// exec 채널의 시작 디렉토리 = 로그인 홈
pub async fn home(session: &SshSession) -> AppResult<String> {
    let out = exec(session, &sh_command("cd && pwd -P 2>/dev/null || pwd", &[]), &[])
        .await?
        .check("홈 디렉토리 조회")?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gnu_bsd_perl_meta() {
        assert_eq!(parse_meta("41ed|4096|1700000000\n"), (0o40755, 4096, 1700000000));
        assert_eq!(parse_meta("81a4|12|5"), (0o100644, 12, 5));
        assert!(is_dir_mode(0o40755));
        assert!(!is_dir_mode(0o100644));
    }

    #[test]
    fn parses_nul_separated_listing_with_odd_names() {
        let out = b"41ed|0|10\nsub dir\x0081a4|3|20\nline\nbreak\x00".to_vec();
        let entries = parse_list("/home/u/", &out);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "/home/u/sub dir");
        assert!(entries[0].is_dir);
        assert_eq!(entries[1].name, "line\nbreak");
        assert_eq!(entries[1].size, 3);
        assert_eq!(entries[1].modified, Some(20));
    }

    /// 원격 로그인 셸이 받는 것과 같은 명령 문자열을 로컬 sh로 실행
    #[cfg(unix)]
    fn run_local(cmd: &str) -> (Vec<u8>, i32) {
        let out = std::process::Command::new("sh").arg("-c").arg(cmd).output().unwrap();
        (out.stdout, out.status.code().unwrap_or(-1))
    }

    #[cfg(unix)]
    fn local_tools() -> Vec<StatTool> {
        let (out, _) = run_local(&sh_command(PROBE_SCRIPT, &[]));
        let text = String::from_utf8_lossy(&out).to_string();
        let mut tools = Vec::new();
        if text.contains("stat:gnu") {
            tools.push(StatTool::Gnu);
        }
        if text.contains("stat:bsd") {
            tools.push(StatTool::Bsd);
        }
        if run_local("perl -e 1").1 == 0 {
            tools.push(StatTool::Perl);
        }
        assert!(!text.contains("missing:"), "{}", text);
        tools
    }

    #[cfg(unix)]
    #[test]
    fn local_shell_scripts_list_and_stat_odd_names() {
        let dir = std::env::temp_dir().join(format!("shell-fs-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub dir")).unwrap();
        std::fs::write(dir.join("it's \"q\" $x"), b"abc").unwrap();
        std::fs::write(dir.join(".hidden"), b"").unwrap();
        std::fs::write(dir.join("-dash"), b"z").unwrap();
        let root = dir.to_string_lossy().to_string();

        let tools = local_tools();
        assert!(!tools.is_empty());
        for tool in tools {
            let (out, code) = run_local(&list_command(tool, &root));
            assert_eq!(code, 0, "{:?}", tool);
            let mut names: Vec<_> = parse_list(&root, &out)
                .into_iter()
                .map(|e| (e.name, e.is_dir, e.size))
                .collect();
            names.sort();
            assert_eq!(
                names,
                vec![
                    ("-dash".to_string(), false, 1),
                    (".hidden".to_string(), false, 0),
                    ("it's \"q\" $x".to_string(), false, 3),
                    ("sub dir".to_string(), true, names[3].2),
                ],
                "{:?}",
                tool
            );

            let file = format!("{}/it's \"q\" $x", root);
            let (out, code) = run_local(&stat_command(tool, &file));
            assert_eq!(code, 0);
            let (mode, size, mtime) = parse_meta(&String::from_utf8_lossy(&out));
            assert_eq!((mode & 0o170000, size), (0o100000, 3), "{:?}", tool);
            assert!(mtime > 0);
            assert_ne!(run_local(&stat_command(tool, &format!("{}/none", root))).1, 0);
        }

        // 쓰기·읽기·이름 변경·삭제 스크립트
        let file = format!("{}/new file", root);
        let write = |script: &str, data: &[u8]| {
            use std::io::Write;
            let mut child = std::process::Command::new("sh")
                .arg("-c")
                .arg(sh_command(script, &[&file]))
                .stdin(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(data).unwrap();
            assert!(child.wait().unwrap().success());
        };
        write("cat > \"$1\"", b"one");
        write("cat >> \"$1\"", b"\0two");
        assert_eq!(run_local(&sh_command("cat \"$1\"", &[&file])).0, b"one\0two");
        assert_eq!(run_local(&sh_command("dd if=\"$1\" bs=3 count=1 2>/dev/null", &[&file])).0, b"one");
        let renamed = format!("{}/renamed", root);
        let rename = "if [ -e \"$2\" ] || [ -L \"$2\" ]; then echo \"대상이 이미 존재합니다: $2\" >&2; exit 1; fi; mv \"$1\" \"$2\"";
        assert_eq!(run_local(&sh_command(rename, &[&file, &renamed])).1, 0);
        assert_ne!(run_local(&sh_command(rename, &[&renamed, &format!("{}/-dash", root)])).1, 0);
        let delete = "if [ -d \"$1\" ] && [ ! -L \"$1\" ]; then rmdir \"$1\"; else rm \"$1\"; fi";
        assert_eq!(run_local(&sh_command(delete, &[&renamed])).1, 0);
        assert_ne!(run_local(&sh_command("[ -e \"$1\" ] || [ -L \"$1\" ]", &[&renamed])).1, 0);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn quotes_arguments_positionally() {
        assert_eq!(sh_command("cat \"$1\"", &["/a b/it's"]), "sh -c 'cat \"$1\"' sh '/a b/it'\\''s'");
        assert_eq!(sh_command("rm \"$1\"", &["-rf"]), "sh -c 'rm \"$1\"' sh './-rf'");
    }
}
