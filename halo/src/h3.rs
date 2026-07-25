use crate::conn::ConnHandler;
use crate::proxy::{SharedRegistry, SharedState};
use crate::ratelimit::RateLimiter;
use crate::static_files::RespCache;
use crate::upstream::UpstreamPool;
use bytes::{Buf, Bytes, BytesMut};
use http::{Request, Response};
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::debug;

pub async fn listen(
    addr: SocketAddr,
    tls: Arc<rustls::ServerConfig>,
    config: SharedState,
    registry: SharedRegistry,
    limiter: Arc<RateLimiter>,
    pool: Arc<UpstreamPool>,
    resp: RespCache,
) -> std::io::Result<()> {
    let mut tls_h3 = (*tls).clone();
    tls_h3.alpn_protocols = vec![b"h3".to_vec()];
    let tls_h3 = Arc::new(tls_h3);

    let mut transport = quinn::TransportConfig::default();
    transport.max_idle_timeout(Some(
        std::time::Duration::from_secs(30).try_into().unwrap(),
    ));
    transport.keep_alive_interval(Some(std::time::Duration::from_secs(10)));
    transport.receive_window(quinn::VarInt::from_u32(4 * 1024 * 1024));
    transport.stream_receive_window(quinn::VarInt::from_u32(2 * 1024 * 1024));
    transport.send_window(4 * 1024 * 1024);

    let mut server_cfg = quinn::ServerConfig::with_crypto(Arc::new(
        quinn::crypto::rustls::QuicServerConfig::try_from(tls_h3)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?,
    ));
    server_cfg.transport_config(Arc::new(transport));

    let endpoint = quinn::Endpoint::server(server_cfg, addr)?;
    tracing::info!("HTTP/3 listening on {addr}");

    while let Some(incoming) = endpoint.accept().await {
        let config   = config.clone();
        let registry = registry.clone();
        let limiter  = limiter.clone();
        let pool     = pool.clone();
        let resp     = resp.clone();
        let p_cache  = crate::proxy::build_proxy_cache(104857600, 60);

        tokio::spawn(async move {
            let conn = match incoming.await {
                Ok(c) => c,
                Err(e) => { debug!("quic handshake: {e}"); return; }
            };
            let peer = conn.remote_address();

            if !limiter.check(peer.ip()) {
                conn.close(quinn::VarInt::from_u32(429), b"rate limited");
                return;
            }

            let h3_conn = match h3::server::builder()
                .build(h3_quinn::Connection::new(conn))
                .await
            {
                Ok(c) => c,
                Err(e) => { debug!("h3 handshake: {e}"); return; }
            };

            let handler = ConnHandler {
                config,
                registry,
                limiter,
                pool,
                resp,
                proxy_cache: p_cache,
                peer,
            };

            serve_conn(handler, h3_conn).await;
        });
    }
    Ok(())
}

async fn serve_conn(
    handler: ConnHandler,
    mut conn: h3::server::Connection<h3_quinn::Connection, Bytes>,
) {
    loop {
        match conn.accept().await {
            Ok(Some(resolver)) => {
                let h = handler.clone_fast();
                tokio::spawn(async move {
                    match resolver.resolve_request().await {
                        Ok((req, stream)) => {
                            if let Err(e) = h.handle_h3_stream(req, stream).await {
                                debug!("h3 stream error: {e}");
                            }
                        }
                        Err(e) => debug!("resolve request: {e}"),
                    }
                });
            }
            Ok(None) => break,
            Err(e) => {
                debug!("h3 conn error: {e}");
                break;
            }
        }
    }
}

impl ConnHandler {
    async fn handle_h3_stream(
        &self,
        request: Request<()>,
        mut stream: h3::server::RequestStream<h3_quinn::BidiStream<Bytes>, Bytes>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let is_grpc = request
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|ct| ct.starts_with("application/grpc"))
            .unwrap_or(false);

        let host = request
            .headers()
            .get("host")
            .or_else(|| request.headers().get(":authority"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(':')
            .next()
            .unwrap_or("")
            .to_lowercase();

        let cfg = self.config.load();
        let route = match cfg.route_for(&host) {
            Some(r) => r,
            None => {
                return send_h3_page(
                    &mut stream,
                    &crate::error_page::default_page(),
                )
                .await;
            }
        };

        if is_grpc {
            return send_h3_error(&mut stream, 501, Some(route.as_ref())).await;
        }

        self.proxy_h3(request, stream, route).await
    }

    async fn proxy_h3(
        &self,
        request: Request<()>,
        mut stream: h3::server::RequestStream<h3_quinn::BidiStream<Bytes>, Bytes>,
        route: Arc<crate::config::Route>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let method = request.method().to_string();
        let path = crate::h1::apply_rewrites(
            request.uri().path(),
            &route.rewrites,
        );

        if let Some(ref sf) = route.static_files {
            let me = crate::proto::Method::from_bytes(method.as_bytes());
            if let Some(m) = me {
                if matches!(m, crate::proto::Method::Get | crate::proto::Method::Head) {
                    match crate::static_files::serve_raw(
                        &path, sf, m, &self.resp,
                    )
                    .await
                    {
                        Ok(Some(raw)) => {
                            let bytes = raw.into_bytes();
                            return send_raw_h3(&mut stream, &bytes, route.as_ref()).await;
                        }
                        Ok(None) | Err(_) => {}
                    }
                }
            }
        }

        let cache_key = if let Some(ref pc) = route.proxy_cache {
            if pc.enabled && method == "GET" {
                Some(format!("GET:{path}"))
            } else { None }
        } else { None };
        if let Some(ref key) = cache_key {
            if let Some(entry) = self.proxy_cache.get(key).await {
                let resp = Response::builder().status(200).body(()).map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
                stream.send_response(resp).await?;
                stream.send_data(entry.headers.clone()).await?;
                stream.finish().await?;
                return Ok(());
            }
        }

        crate::metrics::REQUESTS.fetch_add(1, Ordering::Relaxed);
        let reg = self.registry.load();
        let ip  = self.peer.ip().to_string();
        let (upstream, stats) = match reg
            .get(&route.domain)
            .and_then(|b| b.pick(&route.strategy, Some(&ip)))
        {
            Some(u) => (u.0.to_owned(), u.1),
            None => return send_h3_error(&mut stream, 502, Some(route.as_ref())).await,
        };
        stats.total_requests.fetch_add(1, Ordering::Relaxed);
        stats.active_connections.fetch_add(1, Ordering::Relaxed);

        let mut body_buf: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.recv_data().await? {
            body_buf.extend_from_slice(chunk.chunk());
        }

        let timeout = std::time::Duration::from_secs(route.upstream_timeout_secs);
        let mut us = match tokio::time::timeout(timeout, self.pool.get(&upstream)).await {
            Ok(Ok(c)) => c,
            _ => {
                stats.failures.fetch_add(1, Ordering::Relaxed);
                stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                return send_h3_error(&mut stream, 502, Some(route.as_ref())).await;
            }
        };

        let mut req_str = format!(
            "{} {} HTTP/1.1\r\nhost: {}\r\nconnection: keep-alive\r\n",
            method, path, route.domain
        );

        for (k, v) in &route.header_rules.set_request {
            req_str.push_str(&format!("{k}: {v}\r\n"));
        }

        let ip_str = self.peer.ip().to_string();
        for (hdr, val) in [("x-real-ip", &ip_str), ("x-forwarded-for", &ip_str)] {
            if !route.header_rules.set_request.contains_key(hdr) {
                req_str.push_str(&format!("{hdr}: {val}\r\n"));
            }
        }
        if !route.header_rules.set_request.contains_key("x-forwarded-proto") {
            req_str.push_str("x-forwarded-proto: https\r\n");
        }
        if !body_buf.is_empty() {
            req_str.push_str(&format!("content-length: {}\r\n", body_buf.len()));
        }
        req_str.push_str("\r\n");

        us.write_all(req_str.as_bytes()).await?;
        if !body_buf.is_empty() {
            us.write_all(&body_buf).await?;
        }

        let mut resp_buf = BytesMut::with_capacity(16 * 1024);

        loop {
            match crate::proto::parse_response(&resp_buf) {
                Ok(rh) => {
                    let mut builder = Response::builder().status(rh.status);

                    let raw = &resp_buf[..rh.headers_end];
                    let mut pos = memchr::memchr(b'\n', raw)
                        .map(|i| i + 1)
                        .unwrap_or(raw.len());

                    while pos < raw.len() {
                        let lf = memchr::memchr(b'\n', &raw[pos..])
                            .map(|i| pos + i)
                            .unwrap_or(raw.len());
                        let line =
                            raw[pos..lf].strip_suffix(b"\r").unwrap_or(&raw[pos..lf]);
                        pos = lf + 1;
                        if line.is_empty() { break; }

                        if let Some(c) = memchr::memchr(b':', line) {
                            let name  = &line[..c];
                            let value =
                                line[c + 1..].strip_prefix(b" ").unwrap_or(&line[c + 1..]);
                            let name_str = std::str::from_utf8(name).unwrap_or("");

                            if route
                                .header_rules
                                .remove_response
                                .iter()
                                .any(|r| r.eq_ignore_ascii_case(name_str))
                            {
                                continue;
                            }
                            if crate::proto::eq_ic(name, b"connection")
                                || crate::proto::eq_ic(name, b"transfer-encoding")
                                || crate::proto::eq_ic(name, b"keep-alive")
                            {
                                continue;
                            }
                            if let (Ok(n), Ok(v)) = (
                                std::str::from_utf8(name),
                                std::str::from_utf8(value),
                            ) {
                                builder = builder.header(n, v);
                            }
                        }
                    }

                    for (k, v) in &route.header_rules.set_response {
                        builder = builder.header(k.as_str(), v.as_str());
                    }
                    for (k, v) in &route.add_headers {
                        builder = builder.header(k.as_str(), v.as_str());
                    }

                    let upstream_ka = !rh.connection_close;
                    let response = builder.body(())?;

                    stream.send_response(response).await?;

                    let empty = rh.content_length == Some(0)
                        || rh.status == 204
                        || rh.status == 304;

                    if empty {
                        stream.finish().await?;
                        stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                        if upstream_ka {
                            self.pool.release(&upstream, us);
                        } else {
                            self.pool.discard(&upstream, us);
                        }
                        return Ok(());
                    }

                    let body_start = rh.headers_end;
                    let buffered   = resp_buf.len().saturating_sub(body_start);

                    if let Some(cl) = rh.content_length {
                        let cl = cl as usize;
                        if buffered > 0 {
                            let send_len = buffered.min(cl);
                            let mut chunk = resp_buf.split_to(body_start + send_len);
                            chunk.advance(body_start);
                            stream.send_data(chunk.freeze()).await?;
                        } else {
                            resp_buf.advance(body_start);
                        }

                        let mut remaining = cl.saturating_sub(buffered);
                        let mut tmp = { let mut v = Vec::with_capacity(32 * 1024); unsafe { v.set_len(32 * 1024); } v };
                        while remaining > 0 {
                            let limit = remaining.min(tmp.len());
                            let n = us.read(&mut tmp[..limit]).await?;
                            if n == 0 { break; }
                            remaining -= n;
                            stream
                                .send_data(Bytes::copy_from_slice(&tmp[..n]))
                                .await?;
                        }
                    } else {
                        if buffered > 0 {
                            let chunk = resp_buf.split_off(body_start).freeze();
                            stream.send_data(chunk).await?;
                        }
                        let mut tmp = { let mut v = Vec::with_capacity(32 * 1024); unsafe { v.set_len(32 * 1024); } v };
                        loop {
                            let n = us.read(&mut tmp).await?;
                            if n == 0 { break; }
                            stream
                                .send_data(Bytes::copy_from_slice(&tmp[..n]))
                                .await?;
                        }
                    }

                    stream.finish().await?;
                    stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                    if upstream_ka && rh.content_length.is_some() {
                        self.pool.release(&upstream, us);
                    } else {
                        self.pool.discard(&upstream, us);
                    }
                    return Ok(());
                }

                Err(crate::proto::ParseError::Incomplete) => {
                    let n = us.read_buf(&mut resp_buf).await?;
                    if n == 0 {
                        stats.failures.fetch_add(1, Ordering::Relaxed);
                        stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                        self.pool.discard(&upstream, us);
                        return Err("upstream closed before headers".into());
                    }
                    if resp_buf.len() > 256 * 1024 {
                        stats.failures.fetch_add(1, Ordering::Relaxed);
                        stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                        self.pool.discard(&upstream, us);
                        return Err("response headers too large".into());
                    }
                }

                Err(_) => {
                    stats.failures.fetch_add(1, Ordering::Relaxed);
                    stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                    self.pool.discard(&upstream, us);
                    return Err("bad upstream response".into());
                }
            }
        }
    }
}

type H3Stream = h3::server::RequestStream<h3_quinn::BidiStream<Bytes>, Bytes>;

async fn send_h3_error(
    stream: &mut H3Stream,
    code: u16,
    route: Option<&crate::config::Route>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let body = crate::error_page::error_page_bytes(code, route.map(|r| &r.error_pages));
    let resp = Response::builder()
        .status(code)
        .header("content-type", "text/html")
        .header("content-length", body.len().to_string())
        .body(())?;
    stream.send_response(resp).await?;
    stream.send_data(body).await?;
    stream.finish().await?;
    Ok(())
}

async fn send_h3_page(
    stream: &mut H3Stream,
    body: &Bytes,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let resp = Response::builder()
        .status(200)
        .header("content-type", "text/html")
        .header("content-length", body.len().to_string())
        .body(())?;
    stream.send_response(resp).await?;
    stream.send_data(body.clone()).await?;
    stream.finish().await?;
    Ok(())
}

async fn send_raw_h3(
    stream: &mut H3Stream,
    raw: &Bytes,
    route: &crate::config::Route,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let header_end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
        .unwrap_or(raw.len());

    let head = &raw[..header_end];
    let body = &raw[header_end..];

    let status: u16 = head
        .split(|&b| b == b'\n')
        .next()
        .and_then(|l| l.split(|&b| b == b' ').nth(1))
        .and_then(|s| std::str::from_utf8(s).ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(200);

    let mut builder = Response::builder().status(status);

    let mut pos = memchr::memchr(b'\n', head)
        .map(|i| i + 1)
        .unwrap_or(head.len());

    while pos < head.len() {
        let lf = memchr::memchr(b'\n', &head[pos..])
            .map(|i| pos + i)
            .unwrap_or(head.len());
        let line = head[pos..lf].strip_suffix(b"\r").unwrap_or(&head[pos..lf]);
        pos = lf + 1;
        if line.is_empty() { break; }

        if let Some(c) = memchr::memchr(b':', line) {
            let name     = &line[..c];
            let value    = line[c + 1..].strip_prefix(b" ").unwrap_or(&line[c + 1..]);
            let name_str = std::str::from_utf8(name).unwrap_or("");

            if route
                .header_rules
                .remove_response
                .iter()
                .any(|r| r.eq_ignore_ascii_case(name_str))
            {
                continue;
            }
            if crate::proto::eq_ic(name, b"connection")
                || crate::proto::eq_ic(name, b"transfer-encoding")
            {
                continue;
            }
            if let (Ok(n), Ok(v)) =
                (std::str::from_utf8(name), std::str::from_utf8(value))
            {
                builder = builder.header(n, v);
            }
        }
    }

    for (k, v) in &route.header_rules.set_response {
        builder = builder.header(k.as_str(), v.as_str());
    }
    for (k, v) in &route.add_headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    let response = builder.body(())?;
    stream.send_response(response).await?;
    if !body.is_empty() {
        stream.send_data(Bytes::copy_from_slice(body)).await?;
    }
    stream.finish().await?;
    Ok(())
}