use crate::proxy::{SharedRegistry, SharedState};
use crate::ratelimit::RateLimiter;
use crate::static_files::RespCache;
use crate::upstream::UpstreamPool;
use bytes::BytesMut;
use std::net::SocketAddr;
use std::os::unix::io::RawFd;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

pub struct ConnHandler {
    pub config:   SharedState,
    pub registry: SharedRegistry,
    pub limiter:  Arc<RateLimiter>,
    pub pool:     Arc<UpstreamPool>,
    pub resp:     RespCache,
    pub peer:     SocketAddr,
}

impl ConnHandler {
    #[inline(always)]
    pub fn clone_fast(&self) -> Self {
        Self {
            config:   self.config.clone(),
            registry: self.registry.clone(),
            limiter:  self.limiter.clone(),
            pool:     self.pool.clone(),
            resp:     self.resp.clone(),
            peer:     self.peer,
        }
    }

    pub async fn run_plain(self, mut stream: TcpStream) -> std::io::Result<()> {
        if !self.limiter.check(self.peer.ip()) {
            let body = crate::error_page::error_page(429);
            let _ = stream
                .write_all(
                    format!(
                        "HTTP/1.1 429 Too Many Requests\r\n\
                         content-type: text/html\r\n\
                         content-length: {}\r\n\
                         connection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await;
            let _ = stream.write_all(&body).await;
            let _ = stream.shutdown().await;
            return Ok(());
        }

        let mut sniff = [0u8; 24];
        let n = match stream.read(&mut sniff).await {
            Ok(n) => n,
            Err(_) => {
                let _ = stream.shutdown().await;
                return Ok(());
            }
        };
        if n == 0 {
            let _ = stream.shutdown().await;
            return Ok(());
        }
        let buf = BytesMut::from(&sniff[..n]);
        crate::h1::serve(self, stream, buf, None).await
    }

    pub async fn run_tls<S: AsyncRead + AsyncWrite + Unpin>(
        self,
        mut stream: S,
        alpn: Option<Vec<u8>>,
        sendfile_fd: Option<RawFd>,
    ) -> std::io::Result<()> {
        if !self.limiter.check(self.peer.ip()) {
            let body = crate::error_page::error_page(429);
            let _ = stream
                .write_all(
                    format!(
                        "HTTP/1.1 429 Too Many Requests\r\n\
                         content-type: text/html\r\n\
                         content-length: {}\r\n\
                         connection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await;
            let _ = stream.write_all(&body).await;
            let _ = stream.shutdown().await;
            return Ok(());
        }

        let is_h2 = alpn.as_deref() == Some(b"h2");

        if is_h2 {
            crate::h2::serve(self, stream).await
        } else {
            let mut sniff = [0u8; 24];
            let n = match stream.read(&mut sniff).await {
                Ok(n) => n,
                Err(_) => {
                    let _ = stream.shutdown().await;
                    return Ok(());
                }
            };
            if n == 0 {
                let _ = stream.shutdown().await;
                return Ok(());
            }
            let buf = BytesMut::from(&sniff[..n]);
            crate::h1::serve(self, stream, buf, sendfile_fd).await
        }
    }
}