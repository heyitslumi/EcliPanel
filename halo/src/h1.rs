use crate::conn::ConnHandler;
use crate::proto::{self, Method, ParseError};
use crate::static_files;
use bytes::{Buf, BufMut, BytesMut};
use std::sync::atomic::Ordering;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::warn;

const MAX_HEADERS: usize = 16 * 1024;

fn try_read_fast<S: AsyncRead + Unpin>(
    stream: &mut S,
    buf: &mut BytesMut,
) -> std::io::Result<bool> {
    use std::pin::Pin;
    use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
    use tokio::io::ReadBuf;

    unsafe fn noop_clone(_: *const ()) -> RawWaker {
        RawWaker::new(std::ptr::null(), &NOOP_VTABLE)
    }
    unsafe fn noop(_: *const ()) {}
    static NOOP_VTABLE: RawWakerVTable =
        RawWakerVTable::new(noop_clone, noop, noop, noop);

    let raw = RawWaker::new(std::ptr::null(), &NOOP_VTABLE);
    let waker = unsafe { Waker::from_raw(raw) };
    let mut cx = Context::from_waker(&waker);

    buf.reserve(4096);
    let spare = buf.spare_capacity_mut();
    let mut rb = ReadBuf::uninit(spare);
    let ptr = unsafe { Pin::new_unchecked(stream) };
    match ptr.poll_read(&mut cx, &mut rb) {
        Poll::Ready(Ok(())) => {
            let n = rb.filled().len();
            if n > 0 {
                unsafe { buf.set_len(buf.len() + n); }
                Ok(true)
            } else {
                Ok(false)
            }
        }
        Poll::Ready(Err(e)) => Err(e),
        Poll::Pending => Ok(false),
    }
}

async fn try_write_all(stream: &mut TcpStream, buf: &[u8]) -> std::io::Result<()> {
    match stream.try_write(buf) {
        Ok(n) if n == buf.len() => Ok(()),
        Ok(n) => stream.write_all(&buf[n..]).await,
        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            stream.write_all(buf).await
        }
        Err(e) => Err(e),
    }
}

async fn try_read_upstream(
    upstream: &mut TcpStream,
    buf: &mut BytesMut,
) -> std::io::Result<()> {
    buf.reserve(4096);
    match upstream.try_read_buf(buf) {
        Ok(0) => Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "upstream closed",
        )),
        Ok(_) => Ok(()),
        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
            upstream.read_buf(buf).await.map(|_| ())
        }
        Err(e) => Err(e),
    }
}

pub async fn serve<S>(
    handler: ConnHandler,
    mut stream: S,
    mut buf: BytesMut,
    sendfile_fd: Option<std::os::unix::io::RawFd>,
) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut keep_alive = true;
    let client_ip = handler.peer.ip().to_string();
    let cfg = handler.config.load();
    let reg = handler.registry.load();
    let mut work = BytesMut::with_capacity(8192);

    while keep_alive {
        let req = loop {
            match proto::parse_request(&buf) {
                Ok(req) => break req,
                Err(ParseError::Incomplete) => {
                    if buf.len() >= MAX_HEADERS {
                        let _ = error_response(&mut stream, 431).await;
                        return Ok(());
                    }
                    if try_read_fast(&mut stream, &mut buf)? {
                        continue;
                    }
                    let n = stream.read_buf(&mut buf).await?;
                    if n == 0 {
                        return Ok(());
                    }
                }
                Err(ParseError::Invalid) => {
                    let _ = error_response(&mut stream, 400).await;
                    return Ok(());
                }
            }
        };
        keep_alive = !req.connection_close && req.version == 1;

        let route = match cfg.route_for(&req.host) {
            Some(r) => r,
            None => {
                keep_alive = false;
                let _ = default_response(&mut stream).await;
                buf.advance(req.headers_end);
                continue;
            }
        };

        if req.expect_continue {
            stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").await?;
        }

        if let Some(ref sf) = route.static_files {
            if matches!(req.method, Method::Get | Method::Head) {
                match crate::static_files::serve_raw(&req.path, sf, req.method, &handler.resp)
                    .await
                {
                    Ok(Some(static_files::Served::Full(raw))) => {
                        stream.write_all(&raw).await?;
                        buf.advance(req.headers_end);
                        continue;
                    }
                    Ok(Some(static_files::Served::Sendfile { headers, path, size })) => {
                        stream.write_all(&headers).await?;
                        if let Some(fd) = sendfile_fd {
                            match static_files::spawn_sendfile(fd, path, size).await {
                                Ok(Ok(())) => {}
                                Ok(Err(e)) => warn!("sendfile: {e}"),
                                Err(e) => warn!("sendfile task: {e}"),
                            }
                        } else {
                            let _ = stream_file_body(&mut stream, &path).await;
                        }
                        buf.advance(req.headers_end);
                        continue;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        let _ = error_response(&mut stream, 500).await;
                        buf.advance(req.headers_end);
                        continue;
                    }
                }
            }
        }

        if req.method == Method::Connect {
            buf.advance(req.headers_end);
            return handle_connect(stream, &req.path, buf).await;
        }

        if let Some(ref upg) = req.upgrade {
            if upg.contains("websocket") && route.websocket {
                let headers = buf[..req.headers_end].to_vec();
                buf.advance(req.headers_end);
                return handle_websocket(handler, stream, headers, buf, route.as_ref()).await;
            }
        }

        let (upstream, stats) = match reg
            .get(&req.host)
            .and_then(|b| b.pick(&route.strategy, Some(&client_ip)))
        {
            Some(u) => (u.0.to_owned(), u.1),
            None => {
                keep_alive = false;
                let _ = error_response(&mut stream, 502).await;
                buf.advance(req.headers_end);
                continue;
            }
        };
        stats
            .active_connections
            .fetch_add(1, Ordering::Relaxed);

        let mut us = if let Some(c) = handler.pool.try_get(&upstream) {
            c
        } else {
            match handler.pool.get(&upstream).await {
                Ok(c) => c,
                Err(e) => {
                    stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                    stats.failures.fetch_add(1, Ordering::Relaxed);
                    warn!(%upstream, "connect: {e}");
                    keep_alive = false;
                    let _ = error_response(&mut stream, 502).await;
                    buf.advance(req.headers_end);
                    continue;
                }
            }
        };

        rewrite_request(&buf[..req.headers_end], &req.path, &route, &client_ip, keep_alive, &mut work);
        if let Err(e) = try_write_all(&mut us, &work).await {
            warn!(%upstream, "write: {e}");
            keep_alive = false;
            stats.failures.fetch_add(1, Ordering::Relaxed);
            stats.active_connections.fetch_add(-1, Ordering::Relaxed);
            handler.pool.discard(&upstream, us);
            let _ = error_response(&mut stream, 502).await;
            buf.advance(req.headers_end);
            continue;
        }

        let body_err = if req.transfer_chunked {
            stream_chunked_body(&mut stream, &mut us, &mut buf, req.headers_end)
                .await
                .is_err()
        } else if let Some(cl) = req.content_length {
            stream_fixed_body(&mut stream, &mut us, &mut buf, req.headers_end, cl)
                .await
                .is_err()
        } else {
            buf.advance(req.headers_end);
            false
        };

        if body_err {
            stats.failures.fetch_add(1, Ordering::Relaxed);
            stats
                .active_connections
                .fetch_add(-1, Ordering::Relaxed);
            handler.pool.discard(&upstream, us);
            keep_alive = false;
            continue;
        }

        work.clear();
        match stream_response(&mut stream, &mut us, keep_alive, &mut work).await {
            Ok(resp_ka) => {
                keep_alive = keep_alive && resp_ka;
                stats
                    .active_connections
                    .fetch_add(-1, Ordering::Relaxed);
                if resp_ka {
                    handler.pool.release(&upstream, us);
                } else {
                    handler.pool.discard(&upstream, us);
                }
            }
            Err(_) => {
                stats.failures.fetch_add(1, Ordering::Relaxed);
                stats
                    .active_connections
                    .fetch_add(-1, Ordering::Relaxed);
                handler.pool.discard(&upstream, us);
                keep_alive = false;
            }
        }
    }
    let _ = stream.shutdown().await;
    Ok(())
}

async fn stream_fixed_body<S: AsyncRead + AsyncWrite + Unpin>(
    client: &mut S,
    upstream: &mut TcpStream,
    buf: &mut BytesMut,
    start: usize,
    length: u64,
) -> std::io::Result<()> {
    let buffered = buf.len().saturating_sub(start);
    let to_send = buffered.min(length as usize);
    if to_send > 0 {
        upstream.write_all(&buf[start..start + to_send]).await?;
    }
    buf.advance(start + to_send);

    let mut remaining = (length as usize).saturating_sub(to_send);
    let mut tmp = [0u8; 32768];
    while remaining > 0 {
        let n = client
            .read(&mut tmp[..remaining.min(32768)])
            .await?;
        if n == 0 {
            break;
        }
        upstream.write_all(&tmp[..n]).await?;
        remaining -= n;
    }
    Ok(())
}

async fn stream_chunked_body<S: AsyncRead + AsyncWrite + Unpin>(
    client: &mut S,
    upstream: &mut TcpStream,
    buf: &mut BytesMut,
    start: usize,
) -> std::io::Result<()> {
    buf.advance(start);
    let mut tmp = [0u8; 32768];

    loop {
        loop {
            if proto::parse_chunk_size(buf).is_ok() {
                break;
            }
            let n = client.read(&mut tmp).await?;
            if n == 0 {
                return Ok(());
            }
            buf.extend_from_slice(&tmp[..n]);
        }

        let (size, hdr_len) = proto::parse_chunk_size(buf).map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "chunk")
        })?;

        upstream.write_all(&buf[..hdr_len]).await?;
        buf.advance(hdr_len);

        if size == 0 {
            while buf.len() < 2 {
                let n = client.read(&mut tmp).await?;
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            if buf.len() >= 2 {
                upstream.write_all(&buf[..2]).await?;
                buf.advance(2);
            }
            break;
        }

        let total = size + 2;
        while buf.len() < total {
            let n = client.read(&mut tmp).await?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "chunk eof",
                ));
            }
            buf.extend_from_slice(&tmp[..n]);
        }
        upstream.write_all(&buf[..total]).await?;
        buf.advance(total);
    }
    Ok(())
}

async fn stream_response<S: AsyncRead + AsyncWrite + Unpin>(
    client: &mut S,
    upstream: &mut TcpStream,
    req_ka: bool,
    buf: &mut BytesMut,
) -> std::io::Result<bool> {

    loop {
        match proto::parse_response(&buf) {
            Ok(resp) => {
                let hdr_end = resp.headers_end;
                let body_start = hdr_end;
                let body_buffered = buf.len() - body_start;

                client.write_all(&buf[..]).await?;

                let ka = !resp.connection_close && req_ka;

                if resp.transfer_chunked {
                    stream_chunked_response(client, upstream, buf.split_off(body_start))
                        .await?;
                    if ka { drain_leftover(upstream).await; }
                    return Ok(ka);
                } else if let Some(cl) = resp.content_length {
                    let mut remaining = (cl as usize).saturating_sub(body_buffered);
                    let mut tmp = [0u8; 32768];
                    while remaining > 0 {
                        let n = upstream.read(&mut tmp[..remaining.min(32768)]).await?;
                        if n == 0 { break; }
                        client.write_all(&tmp[..n]).await?;
                        remaining -= n;
                    }
                    if ka && remaining > 0 { drain_leftover(upstream).await; }
                    return Ok(ka);
                } else {
                    let mut tmp = [0u8; 32768];
                    loop {
                        let n = upstream.read(&mut tmp).await?;
                        if n == 0 { break; }
                        client.write_all(&tmp[..n]).await?;
                    }
                    return Ok(false);
                }
            }
            Err(ParseError::Incomplete) => {
                try_read_upstream(upstream, buf).await?;
                if buf.len() > 256 * 1024 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "headers too large",
                    ));
                }
            }
            Err(ParseError::Invalid) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "bad response",
                ));
            }
        }
    }
}

async fn stream_chunked_response<S: AsyncRead + AsyncWrite + Unpin>(
    client: &mut S,
    upstream: &mut TcpStream,
    mut buf: BytesMut,
) -> std::io::Result<()> {
    let mut tmp = [0u8; 32768];
    loop {
        loop {
            match proto::parse_chunk_size(&buf) {
                Ok((size, hdr_len)) => {
                    client.write_all(&buf[..hdr_len]).await?;
                    buf.advance(hdr_len);

                    if size == 0 {
                        while buf.len() < 2 {
                            let n = upstream.read(&mut tmp).await?;
                            if n == 0 {
                                break;
                            }
                            buf.extend_from_slice(&tmp[..n]);
                        }
                        if buf.len() >= 2 {
                            client.write_all(&buf[..2]).await?;
                        }
                        return Ok(());
                    }

                    let total = size + 2;
                    while buf.len() < total {
                        let n = upstream.read(&mut tmp).await?;
                        if n == 0 {
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::UnexpectedEof,
                                "chunk eof",
                            ));
                        }
                        buf.extend_from_slice(&tmp[..n]);
                    }
                    client.write_all(&buf[..total]).await?;
                    buf.advance(total);
                    break;
                }
                Err(ParseError::Incomplete) => {
                    let n = upstream.read(&mut tmp).await?;
                    if n == 0 {
                        return Ok(());
                    }
                    buf.extend_from_slice(&tmp[..n]);
                }
                Err(_) => {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "bad chunk",
                    ))
                }
            }
        }
    }
}

async fn handle_connect<S>(
    mut stream: S,
    target: &str,
    buf: BytesMut,
) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let target = if target.contains(':') {
        target.to_owned()
    } else {
        format!("{target}:443")
    };

    let mut us = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        TcpStream::connect(&target),
    )
    .await
    .map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::TimedOut, "connect timeout")
    })??;
    us.set_nodelay(true)?;

    stream.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await?;

    if !buf.is_empty() {
        us.write_all(&buf).await?;
    }

    tokio::io::copy_bidirectional(&mut stream, &mut us).await?;
    Ok(())
}

async fn handle_websocket<S>(
    handler: ConnHandler,
    mut stream: S,
    headers: Vec<u8>,
    leftover: BytesMut,
    route: &crate::config::Route,
) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let reg = handler.registry.load();
    let ip = handler.peer.ip().to_string();
    let upstream = match reg
        .get(&route.domain)
        .and_then(|b| b.pick(&route.strategy, Some(&ip)))
    {
        Some((u, _)) => u.to_owned(),
        None => {
            stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n")
                .await?;
            return Ok(());
        }
    };

    let timeout = std::time::Duration::from_secs(route.upstream_timeout_secs);
    let mut us = tokio::time::timeout(timeout, TcpStream::connect(&upstream))
        .await
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::TimedOut, "ws connect timeout")
        })??;
    us.set_nodelay(true)?;

    us.write_all(&headers).await?;
    if !leftover.is_empty() {
        us.write_all(&leftover).await?;
    }

    tokio::io::copy_bidirectional(&mut stream, &mut us).await?;
    Ok(())
}

pub fn rewrite_request(
    raw: &[u8],
    path: &str,
    route: &crate::config::Route,
    client_ip: &str,
    keep_alive: bool,
    out: &mut BytesMut,
) {
    out.clear();
    out.reserve(raw.len() + 512);

    let mut lines = raw.split(|&b| b == b'\n');
    if let Some(rl) = lines.next() {
        let method = rl.split(|&b| b == b' ').next().unwrap_or(b"GET");
        out.extend_from_slice(method);
        out.put_u8(b' ');
        out.extend_from_slice(path.as_bytes());
        out.extend_from_slice(b" HTTP/1.1\r\n");
    }

    out.extend_from_slice(b"host: ");
    out.extend_from_slice(route.domain.as_bytes());
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(if keep_alive {
        b"connection: keep-alive\r\n"
    } else {
        b"connection: close\r\n"
    });

    for (k, v) in &route.header_rules.set_request {
        out.extend_from_slice(k.as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(v.as_bytes());
        out.extend_from_slice(b"\r\n");
    }

    if !route.header_rules.set_request.contains_key("x-real-ip") {
        out.extend_from_slice(b"x-real-ip: ");
        out.extend_from_slice(client_ip.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    if !route.header_rules.set_request.contains_key("x-forwarded-for") {
        out.extend_from_slice(b"x-forwarded-for: ");
        out.extend_from_slice(client_ip.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    if !route.header_rules.set_request.contains_key("x-forwarded-proto") {
        out.extend_from_slice(b"x-forwarded-proto: https\r\n");
    }

    let mut skip_arr: [&[u8]; 32] = [b""; 32];
    let mut n = 0;
    for s in [b"host" as &[u8], b"connection", b"keep-alive", b"transfer-encoding", b"upgrade",
              b"x-real-ip", b"x-forwarded-for", b"x-forwarded-proto"] {
        skip_arr[n] = s; n += 1;
    }
    for r in &route.header_rules.remove_request {
        skip_arr[n] = r.as_bytes(); n += 1;
    }
    for k in route.header_rules.set_request.keys() {
        skip_arr[n] = k.as_bytes(); n += 1;
    }
    let skip = &skip_arr[..n];

    for line in lines {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.is_empty() {
            break;
        }
        if let Some(c) = memchr::memchr(b':', line) {
            let name = &line[..c];
            if !skip.iter().any(|&s| crate::proto::eq_ic(name, s)) {
                out.extend_from_slice(line);
                out.extend_from_slice(b"\r\n");
            }
        }
    }
    out.extend_from_slice(b"\r\n");
}

async fn stream_file_body<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    path: &std::path::Path,
) -> std::io::Result<()> {
    let body = tokio::fs::read(path).await?;
    stream.write_all(&body).await?;
    Ok(())
}

async fn error_response<S: AsyncRead + AsyncWrite + Unpin>(
    w: &mut S,
    status: u16,
) -> std::io::Result<()> {
    let body = crate::error_page::error_page(status);
    let reason = crate::error_page::status_reason(status);
    let hdr = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         content-type: text/html\r\n\
         content-length: {}\r\n\
         alt-svc: h3=\":443\"; ma=86400\r\n\
         connection: close\r\n\r\n",
        body.len()
    );
    w.write_all(hdr.as_bytes()).await?;
    w.write_all(&body).await
}

async fn default_response<S: AsyncRead + AsyncWrite + Unpin>(w: &mut S) -> std::io::Result<()> {
    let body = crate::error_page::default_page();
    let hdr = format!(
        "HTTP/1.1 200 OK\r\n\
         content-type: text/html\r\n\
         content-length: {}\r\n\
         alt-svc: h3=\":443\"; ma=86400\r\n\
         connection: close\r\n\r\n",
        body.len()
    );
    w.write_all(hdr.as_bytes()).await?;
    w.write_all(&body).await
}

async fn drain_leftover(upstream: &mut TcpStream) {
    let mut tmp = [0u8; 512];
    loop {
        match upstream.try_read(&mut tmp) {
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Ok(0) => break,
            _ => continue,
        }
    }
}