use std::sync::Arc;

use crate::conn::ConnHandler;
use bytes::{Buf, Bytes, BytesMut};
use http::{Request, Response};
use std::sync::atomic::Ordering;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tracing::debug;

pub async fn serve<S: AsyncRead + AsyncWrite + Unpin>(
    handler: ConnHandler,
    stream: S,
) -> std::io::Result<()> {
    let mut conn = h2::server::handshake(stream)
        .await
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

    while let Some(result) = conn.accept().await {
        let (request, respond) = result
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

        let h = handler.clone_fast();
        tokio::spawn(async move {
            if let Err(e) = h.handle_stream(request, respond).await {
                debug!("h2 stream error: {e}");
            }
        });
    }
    Ok(())
}

impl ConnHandler {
    async fn handle_stream(
        &self,
        request: Request<h2::RecvStream>,
        mut respond: h2::server::SendResponse<Bytes>,
    ) -> Result<(), Box<dyn std::error::Error>> {
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
                return send_h2_page(&mut respond, &crate::error_page::default_page()).await;
            }
        };

        if is_grpc && route.grpc {
            let grpc_handler = crate::grpc::GrpcHandler {
                registry: self.registry.clone(),
                limiter: self.limiter.clone(),
                peer: self.peer,
            };
            return grpc_handler.handle_stream(request, respond, route).await;
        }

        self.handle_http2_stream(request, respond, route).await
    }

    async fn handle_http2_stream(
        &self,
        request: Request<h2::RecvStream>,
        mut respond: h2::server::SendResponse<Bytes>,
        route: Arc<crate::config::Route>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let method = request.method().to_string();
        let mut path = request.uri().path().to_string();
        path = crate::h1::apply_rewrites(&path, &route.rewrites);

        if let Some(ref sf) = route.static_files {
            let method_enum = crate::proto::Method::from_bytes(method.as_bytes());
            if let Some(m) = method_enum {
                if matches!(m, crate::proto::Method::Get | crate::proto::Method::Head) {
                    match crate::static_files::serve_raw(
                        &path, sf, m, &self.resp,
                    ).await {
                        Ok(Some(raw)) => {
                            let bytes = raw.into_bytes();
                            send_raw_h2(&mut respond, &bytes, route.as_ref()).await?;
                            return Ok(());
                        }
                        Ok(None) => {
                            if route.upstreams.is_empty() {
                                return send_h2_error(&mut respond, 404, Some(route.as_ref())).await;
                            }
                        }
                        Err(_) => {}
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
                let resp = Response::builder().status(200).body(()).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
                let mut s = respond.send_response(resp, false)?;
                s.send_data(entry.headers.clone(), true)?;
                return Ok(());
            }
        }

        crate::metrics::REQUESTS.fetch_add(1, Ordering::Relaxed);
        let reg = self.registry.load();
        let ip = self.peer.ip().to_string();
        let (upstream, stats) = match reg
            .get(&route.domain)
            .and_then(|b| b.pick(&route.strategy, Some(&ip)))
        {
            Some(u) => (u.0.to_owned(), u.1),
            None => {
                return send_h2_error(&mut respond, 502, Some(route.as_ref())).await;
            }
        };
        stats.total_requests.fetch_add(1, Ordering::Relaxed);
        stats.active_connections.fetch_add(1, Ordering::Relaxed);

        let (_parts, mut body_stream) = request.into_parts();
        let mut body_buf = Vec::new();
        while let Some(chunk) = body_stream.data().await {
            let chunk = chunk?;
            body_buf.extend_from_slice(&chunk);
            let _ = body_stream.flow_control().release_capacity(chunk.len());
        }

        let timeout = std::time::Duration::from_secs(route.upstream_timeout_secs);
        let mut us = match tokio::time::timeout(timeout, self.pool.get(&upstream)).await {
            Ok(Ok(c)) => c,
            _ => {
                stats.failures.fetch_add(1, Ordering::Relaxed);
                stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                return send_h2_error(&mut respond, 502, Some(route.as_ref())).await;
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
        for (hdr, val) in [
            ("x-real-ip", &ip_str),
            ("x-forwarded-for", &ip_str),
        ] {
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
                    let mut pos =
                        memchr::memchr(b'\n', raw).map(|i| i + 1).unwrap_or(raw.len());
                    while pos < raw.len() {
                        let lf = memchr::memchr(b'\n', &raw[pos..])
                            .map(|i| pos + i)
                            .unwrap_or(raw.len());
                        let line = &raw[pos..lf];
                        let line = line.strip_suffix(b"\r").unwrap_or(line);
                        pos = lf + 1;
                        if line.is_empty() { break; }

                        if let Some(c) = memchr::memchr(b':', line) {
                            let name = &line[..c];
                            let value = &line[c + 1..];
                            let value = value.strip_prefix(b" ").unwrap_or(value);

                            let name_str = std::str::from_utf8(name).unwrap_or("");

                            if route.header_rules.remove_response.iter().any(|r| {
                                r.eq_ignore_ascii_case(name_str)
                            }) {
                                continue;
                            }

                            if crate::proto::eq_ic(name, b"connection")
                                || crate::proto::eq_ic(name, b"transfer-encoding")
                                || crate::proto::eq_ic(name, b"keep-alive")
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

                    builder = builder.header("alt-svc", "h3=\":443\"; ma=86400");

                    let end_stream = rh.content_length == Some(0)
                        || rh.status == 204
                        || rh.status == 304;

                    let upstream_ka = !rh.connection_close;

                    let response = builder.body(())?;
                    let mut send_stream = respond.send_response(response, end_stream)?;

                    if end_stream {
                        stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                        if upstream_ka {
                            self.pool.release(&upstream, us);
                        } else {
                            self.pool.discard(&upstream, us);
                        }
                        return Ok(());
                    }

                    let body_start = rh.headers_end;
                    let buffered = resp_buf.len().saturating_sub(body_start);

                    if let Some(cl) = rh.content_length {
                        let cl = cl as usize;
                        if buffered > 0 {
                            let send_len = buffered.min(cl);
                            let mut chunk = resp_buf.split_to(body_start + send_len);
                            chunk.advance(body_start);
                            send_stream.send_data(chunk.freeze(), send_len >= cl)?;
                            if send_len >= cl {
                                stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                                if upstream_ka {
                                    self.pool.release(&upstream, us);
                                } else {
                                    self.pool.discard(&upstream, us);
                                }
                                return Ok(());
                            }
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
                            send_stream.send_data(
                                Bytes::copy_from_slice(&tmp[..n]),
                                remaining == 0,
                            )?;
                        }
                    } else {
                        if buffered > 0 {
                            let chunk = resp_buf.split_off(body_start).freeze();
                            send_stream.send_data(chunk, false)?;
                        }

                        let mut tmp = { let mut v = Vec::with_capacity(32 * 1024); unsafe { v.set_len(32 * 1024); } v };
                        loop {
                            let n = us.read(&mut tmp).await?;
                            if n == 0 { break; }
                            send_stream
                                .send_data(Bytes::copy_from_slice(&tmp[..n]), false)?;
                        }
                        send_stream.send_data(Bytes::new(), true)?;
                    }

                    stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                    if upstream_ka && rh.content_length.is_some() {
                        self.pool.release(&upstream, us);
                    } else {
                        self.pool.discard(&upstream, us);
                    }
                    if let Some(ref key) = cache_key {
                        if let Some(cl) = rh.content_length {
                            if cl > 0 && cl < 65536 {
                                let cached = crate::proxy::CachedResponse {
                                    headers: resp_buf.clone().freeze(),
                                    body: Bytes::new(),
                                };
                                self.proxy_cache.insert(key.clone(), cached).await;
                            }
                        }
                    }
                    return Ok(());
                }
                Err(crate::proto::ParseError::Incomplete) => {
                    let n = us.read_buf(&mut resp_buf).await?;
                    if n == 0 {
                        stats.failures.fetch_add(1, Ordering::Relaxed);
                        stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                        self.pool.discard(&upstream, us);
                        return Err("upstream closed".into());
                    }
                    if resp_buf.len() > 256 * 1024 {
                        stats.failures.fetch_add(1, Ordering::Relaxed);
                        stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                        self.pool.discard(&upstream, us);
                        return Err("headers too large".into());
                    }
                }
                Err(_) => {
                    stats.failures.fetch_add(1, Ordering::Relaxed);
                    stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                    self.pool.discard(&upstream, us);
                    return Err("bad response".into());
                }
            }
        }
    }
}

async fn send_raw_h2(
    respond: &mut h2::server::SendResponse<Bytes>,
    raw: &bytes::Bytes,
    route: &crate::config::Route,
) -> Result<(), Box<dyn std::error::Error>> {
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
        let line = &head[pos..lf];
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        pos = lf + 1;
        if line.is_empty() { break; }

        if let Some(c) = memchr::memchr(b':', line) {
            let name = &line[..c];
            let value = &line[c + 1..];
            let value = value.strip_prefix(b" ").unwrap_or(value);

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

            if let (Ok(n), Ok(v)) = (std::str::from_utf8(name), std::str::from_utf8(value)) {
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

    builder = builder.header("alt-svc", "h3=\":443\"; ma=86400");

    let end_stream = body.is_empty();
    let response = builder.body(())?;
    let mut send_stream = respond.send_response(response, end_stream)?;

    if !body.is_empty() {
        send_stream.send_data(Bytes::copy_from_slice(body), true)?;
    }
    Ok(())
}

async fn send_h2_error(
    respond: &mut h2::server::SendResponse<Bytes>,
    code: u16,
    route: Option<&crate::config::Route>,
) -> Result<(), Box<dyn std::error::Error>> {
    let body = crate::error_page::error_page_bytes(code, route.map(|r| &r.error_pages));
    let resp = Response::builder()
        .status(code)
        .header("content-type", "text/html")
        .header("alt-svc", "h3=\":443\"; ma=86400")
        .body(())
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
    let mut stream = respond.send_response(resp, false)?;
    stream.send_data(body, true)?;
    Ok(())
}

async fn send_h2_page(
    respond: &mut h2::server::SendResponse<Bytes>,
    body: &Bytes,
) -> Result<(), Box<dyn std::error::Error>> {
    let resp = Response::builder()
        .status(200)
        .header("content-type", "text/html")
        .header("alt-svc", "h3=\":443\"; ma=86400")
        .body(())
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
    let mut stream = respond.send_response(resp, false)?;
    stream.send_data(body.clone(), true)?;
    Ok(())
}