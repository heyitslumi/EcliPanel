use std::io;
use std::os::unix::io::{AsRawFd, RawFd};
use std::pin::Pin;
use tokio::net::TcpStream;
use tracing::info;

fn is_ktls_cipher(name: &str) -> bool {
    name.contains("AES") && name.contains("GCM")
        || name.contains("CHACHA20") && name.contains("POLY1305")
}

pub fn try_enable_ktls(fd: RawFd) -> bool {
    let ret = unsafe {
        libc::setsockopt(
            fd,
            libc::SOL_TCP,
            libc::TCP_ULP,
            b"tls\0".as_ptr() as *const libc::c_void,
            3,
        )
    };
    if ret == 0 {
        info!("kTLS: TCP_ULP tls enabled on fd {fd}");
        true
    } else {
        false
    }
}

pub struct KtlsResult {
    pub stream: tokio_openssl::SslStream<TcpStream>,
    pub alpn: Option<Vec<u8>>,
    pub ktls_active: bool,
}

pub async fn handshake(
    stream: TcpStream,
    acceptor: &openssl::ssl::SslAcceptor,
) -> io::Result<KtlsResult> {
    let fd = stream.as_raw_fd();
    let ktls_enabled = try_enable_ktls(fd);

    let ssl = openssl::ssl::Ssl::new(acceptor.context())
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    let mut tls_stream = tokio_openssl::SslStream::new(ssl, stream)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    tokio_openssl::SslStream::accept(Pin::new(&mut tls_stream))
        .await
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    let alpn = tls_stream
        .ssl()
        .selected_alpn_protocol()
        .map(|b| b.to_vec());

    let mut ktls_active = false;
    if ktls_enabled {
        if let Some(cipher) = tls_stream.ssl().current_cipher() {
            let name = cipher.name();
            if is_ktls_cipher(name) {
                ktls_active = true;
                info!("kTLS: offloaded cipher={name}, sendfile OK");
            } else {
                info!("kTLS: cipher {name} not kTLS compatible");
            }
        }
    }

    Ok(KtlsResult {
        stream: tls_stream,
        alpn,
        ktls_active,
    })
}