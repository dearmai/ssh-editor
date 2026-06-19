// Tauri 앱은 콘솔 창 없이 실행 (Windows)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ssh_editor_lib::StartupArgs;

fn main() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("PANIC: {}", info);
        if let Some(location) = info.location() {
            eprintln!("  at {}:{}:{}", location.file(), location.line(), location.column());
        }
    }));

    let startup_args = parse_cli_args();
    ssh_editor_lib::run(startup_args);
}

fn parse_cli_args() -> Option<StartupArgs> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        return None;
    }

    // --profile NAME /path 형식
    if args.first().map(|s| s.as_str()) == Some("--profile") {
        let profile_id = args.get(1)?.clone();
        let path = args.get(2).cloned();
        return Some(StartupArgs {
            host: String::new(),
            username: None,
            path,
            profile_id: Some(profile_id),
        });
    }

    // user@host:/path 또는 host:/path 형식
    let target = args.first()?;
    if let Some(colon_pos) = target.find(':') {
        let host_part = &target[..colon_pos];
        let path = Some(target[colon_pos + 1..].to_string());

        if let Some(at_pos) = host_part.find('@') {
            let username = Some(host_part[..at_pos].to_string());
            let host = host_part[at_pos + 1..].to_string();
            return Some(StartupArgs {
                host,
                username,
                path,
                profile_id: None,
            });
        } else {
            return Some(StartupArgs {
                host: host_part.to_string(),
                username: None,
                path,
                profile_id: None,
            });
        }
    }

    None
}
