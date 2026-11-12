# SSH server without SFTP

This fixture runs OpenSSH with **no `Subsystem sftp` configured**. SFTP requests
are rejected; SSH exec and interactive PTY shells are allowed. `MaxSessions 10`
is the normal OpenSSH channel limit, not a limit on SFTP sessions.

From the repository root:

```powershell
podman machine start # only if the machine is stopped
podman build -t localhost/ssh-editor-no-sftp -f tests/ssh-no-sftp/Containerfile tests/ssh-no-sftp
podman run -d --name ssh-editor-no-sftp -p 127.0.0.1:22222:22 localhost/ssh-editor-no-sftp
cargo test --manifest-path src-tauri/Cargo.toml --lib no_sftp_live_files_and_terminals -- --ignored --nocapture
```

For an existing fixture, use `podman start ssh-editor-no-sftp`. Rebuild and
recreate the container if its configuration changes. The test is ignored during
ordinary test runs because it needs a real server on this specific local port.

App connection settings:

| Setting | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `22222` |
| User | `tester` |
| Authentication | Password |
| Password | `test-only-password` |
| Directory | `/home/tester` |

The password is a disposable fixture credential. The published port binds only
to the local host. Stop the fixture with `podman stop ssh-editor-no-sftp`.

## Verified on 2026-11-12

The live Rust integration test passed against this Podman server:

- SFTP initialization is rejected and the app selects its shell file backend.
- Eight concurrent tasks create/open/edit/save/read back independent documents.
- File names contain Korean text, spaces and a single quote; saved UTF-8 contents
  and byte sizes are checked.
- Three interactive PTYs run commands while file save/read and server ping work.
- A fourth PTY can be added while file reads continue.
- Closing a PTY permits a replacement PTY with verified command output.

The file operations call the app's real `ssh::sftp` entry points, which dispatch
to `shell_fs` when SFTP is unavailable. PTYs use the same russh SSH handle and
PTY/shell protocol as the terminal backend, but do not exercise Tauri event
delivery, xterm rendering, editor tabs, or UI save shortcuts.

Frontend build and native portable debug build succeeded. Desktop UI validation
was attempted with an isolated portable app under `build/no-sftp-ui`, but the
Windows automation helper could not activate its window (`failed to activate
captured window`). UI end-to-end behavior is therefore not marked as verified.

The broader Rust library run (`--lib -- --include-ignored --nocapture`) finished
with 10 passing tests, including this live test, and one failure in the unrelated
`local_files::tests::accepts_files_and_urls_but_not_ssh_targets_or_directories`
test (directory-listing path equality assertion). No local-file code was changed.

An initial run used an extra `MaxSessions 4` restriction and correctly hit SSH
channel exhaustion with eight concurrent file requests. That extra restriction
is not part of this SFTP-disabled fixture.
