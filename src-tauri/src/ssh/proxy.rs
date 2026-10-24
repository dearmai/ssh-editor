//! SSH 첫 홉까지의 전송 계층: 직접 TCP 또는 HTTP/HTTPS(CONNECT)·SOCKS5 프록시 경유.
use crate::config::{ProxyConfig, ProxyKind};
use crate::error::{AppError, AppResult};
use base64::Engine;
use std::net::IpAddr;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

pub trait ProxyStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> ProxyStream for T {}

pub type BoxStream = Box<dyn ProxyStream>;

/// `host:port`까지의 스트림을 연다. 프록시가 지정되면 프록시를 경유한다.
pub async fn open_stream(proxy: Option<&ProxyConfig>, host: &str, port: u16) -> AppResult<BoxStream> {
    let Some(proxy) = proxy else {
        let tcp = tcp_connect(host, port).await?;
        return Ok(Box::new(tcp));
    };

    let tcp = tcp_connect(&proxy.host, proxy.port)
        .await
        .map_err(|e| AppError::Other(format!("프록시 {}:{} 접속 실패: {}", proxy.host, proxy.port, e)))?;
    match proxy.kind {
        ProxyKind::Http => {
            let mut s = tcp;
            http_connect(&mut s, proxy, host, port).await?;
            Ok(Box::new(s))
        }
        ProxyKind::Https => {
            let connector = tokio_native_tls::native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(proxy.insecure)
                .danger_accept_invalid_hostnames(proxy.insecure)
                .build()
                .map_err(|e| AppError::Other(format!("TLS 초기화 실패: {}", e)))?;
            let mut s = tokio_native_tls::TlsConnector::from(connector)
                .connect(&proxy.host, tcp)
                .await
                .map_err(|e| AppError::Other(format!("HTTPS 프록시 TLS 핸드셰이크 실패: {}", e)))?;
            http_connect(&mut s, proxy, host, port).await?;
            Ok(Box::new(s))
        }
        ProxyKind::Socks5 => {
            let mut s = tcp;
            socks5_connect(&mut s, proxy, host, port).await?;
            Ok(Box::new(s))
        }
    }
}

async fn tcp_connect(host: &str, port: u16) -> AppResult<TcpStream> {
    let tcp = TcpStream::connect((host, port)).await?;
    let _ = tcp.set_nodelay(true);
    Ok(tcp)
}

fn credentials(proxy: &ProxyConfig) -> Option<(&str, &str)> {
    match proxy.username.as_deref() {
        Some(user) if !user.is_empty() => Some((user, proxy.password.as_deref().unwrap_or(""))),
        _ => None,
    }
}

/// HTTP CONNECT 터널 수립. 응답 헤더 끝(\r\n\r\n)까지만 읽어 이후 SSH 데이터를 소비하지 않는다.
async fn http_connect<S: AsyncRead + AsyncWrite + Unpin>(
    s: &mut S,
    proxy: &ProxyConfig,
    host: &str,
    port: u16,
) -> AppResult<()> {
    let authority = match host.parse::<IpAddr>() {
        Ok(IpAddr::V6(_)) => format!("[{}]:{}", host, port),
        _ => format!("{}:{}", host, port),
    };
    let mut req = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n");
    if let Some((user, pass)) = credentials(proxy) {
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", user, pass));
        req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", token));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).await?;
    s.flush().await?;

    let mut head = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 {
            return Err(AppError::Other("HTTP 프록시 응답 헤더가 너무 깁니다".to_string()));
        }
        if s.read(&mut byte).await? == 0 {
            return Err(AppError::Other("HTTP 프록시가 응답 중 연결을 닫았습니다".to_string()));
        }
        head.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&head);
    let status_line = text.lines().next().unwrap_or("").trim();
    let code = status_line.split_whitespace().nth(1).unwrap_or("");
    if code != "200" {
        return Err(AppError::Other(format!("HTTP 프록시 CONNECT 거부: {}", status_line)));
    }
    Ok(())
}

/// SOCKS5 (RFC 1928/1929) CONNECT. 도메인은 프록시 측에서 해석한다.
async fn socks5_connect<S: AsyncRead + AsyncWrite + Unpin>(
    s: &mut S,
    proxy: &ProxyConfig,
    host: &str,
    port: u16,
) -> AppResult<()> {
    let creds = credentials(proxy);
    let methods: &[u8] = if creds.is_some() { &[0x00, 0x02] } else { &[0x00] };
    let mut hello = vec![0x05, methods.len() as u8];
    hello.extend_from_slice(methods);
    s.write_all(&hello).await?;

    let mut reply = [0u8; 2];
    s.read_exact(&mut reply).await?;
    if reply[0] != 0x05 {
        return Err(AppError::Other("SOCKS5 프록시가 아닙니다".to_string()));
    }
    match reply[1] {
        0x00 => {}
        0x02 => {
            let (user, pass) = creds
                .ok_or_else(|| AppError::Other("SOCKS5 프록시가 인증을 요구합니다".to_string()))?;
            if user.len() > 255 || pass.len() > 255 {
                return Err(AppError::Other("SOCKS5 사용자명/비밀번호가 너무 깁니다".to_string()));
            }
            let mut auth = vec![0x01, user.len() as u8];
            auth.extend_from_slice(user.as_bytes());
            auth.push(pass.len() as u8);
            auth.extend_from_slice(pass.as_bytes());
            s.write_all(&auth).await?;
            let mut res = [0u8; 2];
            s.read_exact(&mut res).await?;
            if res[1] != 0x00 {
                return Err(AppError::Other("SOCKS5 프록시 인증 실패".to_string()));
            }
        }
        _ => return Err(AppError::Other("SOCKS5 프록시가 지원하는 인증 방식이 없습니다".to_string())),
    }

    let mut req = vec![0x05, 0x01, 0x00];
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            req.push(0x01);
            req.extend_from_slice(&ip.octets());
        }
        Ok(IpAddr::V6(ip)) => {
            req.push(0x04);
            req.extend_from_slice(&ip.octets());
        }
        Err(_) => {
            if host.len() > 255 {
                return Err(AppError::Other("호스트 이름이 너무 깁니다".to_string()));
            }
            req.push(0x03);
            req.push(host.len() as u8);
            req.extend_from_slice(host.as_bytes());
        }
    }
    req.extend_from_slice(&port.to_be_bytes());
    s.write_all(&req).await?;

    let mut head = [0u8; 4];
    s.read_exact(&mut head).await?;
    if head[1] != 0x00 {
        return Err(AppError::Other(format!("SOCKS5 CONNECT 실패: {}", socks5_error(head[1]))));
    }
    // 바인드 주소 + 포트를 읽어 버린다
    let addr_len = match head[3] {
        0x01 => 4,
        0x04 => 16,
        0x03 => {
            let mut len = [0u8; 1];
            s.read_exact(&mut len).await?;
            len[0] as usize
        }
        _ => return Err(AppError::Other("SOCKS5 응답 주소 형식 오류".to_string())),
    };
    let mut rest = vec![0u8; addr_len + 2];
    s.read_exact(&mut rest).await?;
    Ok(())
}

fn socks5_error(code: u8) -> &'static str {
    match code {
        0x01 => "일반 오류",
        0x02 => "규칙상 허용되지 않음",
        0x03 => "네트워크 도달 불가",
        0x04 => "호스트 도달 불가",
        0x05 => "연결 거부",
        0x06 => "TTL 만료",
        0x07 => "지원하지 않는 명령",
        0x08 => "지원하지 않는 주소 형식",
        _ => "알 수 없는 오류",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(kind: ProxyKind, user: Option<&str>) -> ProxyConfig {
        ProxyConfig {
            kind,
            host: "proxy".into(),
            port: 1,
            username: user.map(Into::into),
            password: user.map(|_| "pw".into()),
            insecure: false,
        }
    }

    #[tokio::test]
    async fn http_connect_sends_auth_and_stops_at_header_end() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        let srv = tokio::spawn(async move {
            let mut buf = vec![0u8; 1024];
            let n = server.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            server
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-test")
                .await
                .unwrap();
            req
        });
        http_connect(&mut client, &proxy(ProxyKind::Http, Some("u")), "10.0.0.1", 22)
            .await
            .unwrap();
        let req = srv.await.unwrap();
        assert!(req.starts_with("CONNECT 10.0.0.1:22 HTTP/1.1\r\n"));
        assert!(req.contains("Proxy-Authorization: Basic dTpwdw==\r\n"));
        // 헤더 이후 데이터는 SSH 쪽에 남아 있어야 한다
        let mut rest = [0u8; 12];
        client.read_exact(&mut rest).await.unwrap();
        assert_eq!(&rest, b"SSH-2.0-test");
    }

    #[tokio::test]
    async fn http_connect_rejects_non_200() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let mut buf = vec![0u8; 1024];
            let _ = server.read(&mut buf).await.unwrap();
            server
                .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
                .await
                .unwrap();
        });
        let err = http_connect(&mut client, &proxy(ProxyKind::Http, None), "h", 22)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("407"));
    }

    #[tokio::test]
    async fn socks5_connect_with_password_and_domain() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        let srv = tokio::spawn(async move {
            let mut hello = [0u8; 4];
            server.read_exact(&mut hello).await.unwrap();
            assert_eq!(hello, [5, 2, 0, 2]);
            server.write_all(&[5, 2]).await.unwrap();
            let mut auth = [0u8; 6];
            server.read_exact(&mut auth).await.unwrap();
            assert_eq!(auth, [1, 1, b'u', 2, b'p', b'w']);
            server.write_all(&[1, 0]).await.unwrap();
            let mut req = [0u8; 4 + 1 + 9 + 2];
            server.read_exact(&mut req).await.unwrap();
            assert_eq!(&req[..5], &[5, 1, 0, 3, 9]);
            assert_eq!(&req[5..14], b"host.test");
            assert_eq!(&req[14..], &22u16.to_be_bytes());
            server
                .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 22])
                .await
                .unwrap();
        });
        socks5_connect(&mut client, &proxy(ProxyKind::Socks5, Some("u")), "host.test", 22)
            .await
            .unwrap();
        srv.await.unwrap();
    }

    #[tokio::test]
    async fn socks5_reports_connect_failure() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let mut hello = [0u8; 3];
            server.read_exact(&mut hello).await.unwrap();
            server.write_all(&[5, 0]).await.unwrap();
            let mut req = [0u8; 10];
            server.read_exact(&mut req).await.unwrap();
            server
                .write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0])
                .await
                .unwrap();
        });
        let err = socks5_connect(&mut client, &proxy(ProxyKind::Socks5, None), "10.0.0.1", 22)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("연결 거부"));
    }
}
