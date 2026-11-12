//! Live regression test against tests/ssh-no-sftp (never a mock SSH server).
use super::{connection::*, sftp};
use crate::config::ConnectionProfile;
use russh::{Channel, ChannelMsg};
use std::sync::Arc;
use tokio::time::{timeout, Duration};

async fn terminal(session: &SshSession) -> Channel<russh::client::Msg> {
    let handle = session.handle.lock().await;
    let mut channel = handle.channel_open_session().await.unwrap();
    channel
        .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .unwrap();
    request_succeeded(&mut channel).await;
    channel.request_shell(true).await.unwrap();
    request_succeeded(&mut channel).await;
    channel
}

async fn request_succeeded(channel: &mut Channel<russh::client::Msg>) {
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Success) => return,
            Some(ChannelMsg::Failure | ChannelMsg::Close) | None => {
                panic!("PTY/shell request rejected")
            }
            _ => {}
        }
    }
}

async fn terminal_echo(channel: &mut Channel<russh::client::Msg>, marker: &str) {
    // Split the marker so terminal input echo cannot satisfy the assertion.
    let command = format!("printf '%s%s\\n' '{}' '{}'\n", &marker[..4], &marker[4..]);
    channel.data(command.as_bytes()).await.unwrap();
    timeout(Duration::from_secs(10), async {
        let mut output = String::new();
        while let Some(msg) = channel.wait().await {
            if let ChannelMsg::Data { data } = msg {
                output.push_str(&String::from_utf8_lossy(&data));
                if output.contains(marker) {
                    return;
                }
            }
        }
        panic!("terminal exited without output: {output}");
    })
    .await
    .expect("terminal response timed out");
}

#[tokio::test]
#[ignore = "requires Podman no-SFTP fixture on localhost:22222"]
async fn no_sftp_live_files_and_terminals() {
    timeout(Duration::from_secs(90), exercise())
        .await
        .expect("live test timed out");
}

async fn exercise() {
    let profile: ConnectionProfile = serde_json::from_value(serde_json::json!({
        "id": "no-sftp-test", "name": "Podman no SFTP", "hostname": "127.0.0.1",
        "port": 22222, "username": "tester", "authType": "password",
        "password": "test-only-password", "lastPath": null
    }))
    .unwrap();
    let session = ssh_connect_inner(profile).await.unwrap();
    assert!(
        session.sftp.lock().await.is_none(),
        "fixture must reject SFTP"
    );
    println!("PASS: SSH connected with SFTP rejected, shell fallback selected");
    let root = format!("/home/tester/regression-{}", uuid::Uuid::new_v4());
    sftp::create_dir(&session, &root).await.unwrap();
    // Several open editor documents issue independent backend requests.
    let mut jobs = Vec::new();
    for i in 0..8 {
        let session = Arc::clone(&session);
        let path = format!("{root}/파일 {i}'s.txt");
        jobs.push(tokio::spawn(async move {
            let original = format!("original {i}\n한글\n");
            sftp::write_file(&session, &path, &original).await.unwrap();
            assert_eq!(sftp::read_file(&session, &path).await.unwrap(), original);
            let edited = format!("edited {i}\n저장 확인\n");
            let stat = sftp::write_file(&session, &path, &edited).await.unwrap();
            assert_eq!(stat.size, edited.len() as u64);
            assert_eq!(sftp::read_file(&session, &path).await.unwrap(), edited);
        }));
    }
    for job in jobs {
        job.await.unwrap();
    }
    assert_eq!(sftp::list_dir(&session, &root).await.unwrap().len(), 8);
    println!("PASS: 8 concurrent file open/edit/save/readbacks, Unicode and quoted paths");
    let mut terminals = Vec::new();
    for i in 0..3 {
        let mut channel = terminal(&session).await;
        terminal_echo(&mut channel, &format!("READY_TERMINAL_{i}")).await;
        terminals.push(channel);
    }
    let path = format!("{root}/파일 0's.txt");
    sftp::write_file(&session, &path, "saved with three terminals\n")
        .await
        .unwrap();
    assert_eq!(
        sftp::read_file(&session, &path).await.unwrap(),
        "saved with three terminals\n"
    );
    ping_server(&session).await.unwrap();
    println!("PASS: 3 live PTYs plus file save/read and ping");
    let fourth = terminal(&session).await;
    assert_eq!(
        sftp::read_file(&session, &path).await.unwrap(),
        "saved with three terminals\n"
    );
    println!("PASS: additional fourth PTY and file read");
    fourth.close().await.unwrap();
    drop(fourth);
    timeout(Duration::from_secs(10), async {
        loop {
            if sftp::read_file(&session, &path).await.is_ok() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("channel slot not reclaimed");
    let mut replacement = terminal(&session).await;
    terminal_echo(&mut replacement, "RECOVERED_TERMINAL").await;
    replacement.close().await.unwrap();
    drop(replacement);
    for channel in terminals {
        channel.close().await.unwrap();
    }
    // Wait for the remote close acknowledgements before the cleanup exec.
    timeout(Duration::from_secs(10), async {
        loop {
            if let Ok((_, 0)) =
                run_command(&session, &format!("rm -rf {}", shell_quote(&root))).await
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .unwrap();
    println!("PASS: file access remains available after terminal close; replacement PTY works");
}
