use crate::config::Route;
use crate::proxy::SharedRegistry;
use crate::ratelimit::RateLimiter;
use bytes::Bytes;
use http::{Request, Response, StatusCode};
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::net::TcpStream;
use tracing::debug;

pub struct GrpcHandler {
    pub registry: SharedRegistry,
    pub limiter: Arc<RateLimiter>,
    pub peer: SocketAddr,
}

impl GrpcHandler {
    pub async fn handle_stream(
        &self,
        request: Request<h2::RecvStream>,
        mut respond: h2::server::SendResponse<Bytes>,
        route: Arc<Route>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !self.limiter.check(self.peer.ip()) {
            return send_grpc_error(&mut respond, 14, "rate limit exceeded").await;
        }

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

        let reg = self.registry.load();
        let ip = self.peer.ip().to_string();
        let (upstream, stats) = match reg
            .get(&host)
            .and_then(|b| b.pick(&route.strategy, Some(&ip)))
        {
            Some(u) => (u.0.to_owned(), u.1),
            None => return send_grpc_error(&mut respond, 14, "no upstream").await,
        };

        stats.total_requests.fetch_add(1, Ordering::Relaxed);
        stats.active_connections.fetch_add(1, Ordering::Relaxed);

        let timeout = std::time::Duration::from_secs(route.upstream_timeout_secs);
        let tcp = match tokio::time::timeout(timeout, TcpStream::connect(&upstream)).await {
            Ok(Ok(c)) => c,
            _ => {
                stats.failures.fetch_add(1, Ordering::Relaxed);
                stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                return send_grpc_error(&mut respond, 14, "connect failed").await;
            }
        };
        tcp.set_nodelay(true)?;

        let (mut h2_send, h2_conn) =
            h2::client::handshake(tcp).await.map_err(|e| {
                stats.failures.fetch_add(1, Ordering::Relaxed);
                stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                e
            })?;

        tokio::spawn(async move {
            if let Err(e) = h2_conn.await {
                debug!("upstream h2 conn: {e}");
            }
        });

        let (parts, mut body_recv) = request.into_parts();

        let mut upstream_req = Request::builder()
            .method(parts.method)
            .uri(parts.uri)
            .version(http::Version::HTTP_2);

        for (name, value) in &parts.headers {
            let name_str = name.as_str();
            if route.header_rules.remove_request.iter().any(|r| r.eq_ignore_ascii_case(name_str)) {
                continue;
            }
            const HOP: &[&str] = &[
                "connection", "keep-alive", "proxy-connection",
                "transfer-encoding", "upgrade",
            ];
            if HOP.contains(&name_str) {
                continue;
            }
            upstream_req = upstream_req.header(name, value);
        }

        for (k, v) in &route.header_rules.set_request {
            upstream_req = upstream_req.header(k.as_str(), v.as_str());
        }

        let ip_str = self.peer.ip().to_string();
        for (hdr, val) in [
            ("x-real-ip", &ip_str),
            ("x-forwarded-for", &ip_str),
            ("x-forwarded-proto", &"https".to_string()),
        ] {
            if !route.header_rules.set_request.contains_key(hdr) {
                upstream_req = upstream_req.header(hdr, val.as_str());
            }
        }

        let upstream_req = upstream_req.body(()).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
        let (upstream_resp_future, mut upstream_send) =
            h2_send.send_request(upstream_req, false)?;

        let body_task = tokio::spawn(async move {
            while let Some(chunk) = body_recv.data().await {
                match chunk {
                    Ok(data) => {
                        let _ = body_recv.flow_control().release_capacity(data.len());
                        if upstream_send.send_data(data, false).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = upstream_send.send_data(Bytes::new(), true);
        });

        let upstream_resp = match tokio::time::timeout(timeout, upstream_resp_future).await {
            Ok(Ok(r)) => r,
            _ => {
                stats.failures.fetch_add(1, Ordering::Relaxed);
                stats.active_connections.fetch_add(-1, Ordering::Relaxed);
                let _ = body_task.await;
                return send_grpc_error(&mut respond, 14, "upstream timeout").await;
            }
        };

        let (resp_parts, mut resp_body) = upstream_resp.into_parts();

        let mut client_resp = Response::builder()
            .status(resp_parts.status)
            .version(http::Version::HTTP_2);

        for (name, value) in &resp_parts.headers {
            let name_str = name.as_str();
            if route.header_rules.remove_response.iter().any(|r| r.eq_ignore_ascii_case(name_str)) {
                continue;
            }
            client_resp = client_resp.header(name, value);
        }

        for (k, v) in &route.header_rules.set_response {
            client_resp = client_resp.header(k.as_str(), v.as_str());
        }
        for (k, v) in &route.add_headers {
            client_resp = client_resp.header(k.as_str(), v.as_str());
        }

        let client_resp = client_resp.body(()).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
        let mut send_stream = respond.send_response(client_resp, false)?;

        while let Some(chunk) = resp_body.data().await {
            match chunk {
                Ok(data) => {
                    let _ = resp_body.flow_control().release_capacity(data.len());
                    if send_stream.send_data(data, false).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        if let Ok(Some(trailers)) = resp_body.trailers().await {
            send_stream.send_trailers(trailers)?;
        } else {
            send_stream.send_data(Bytes::new(), true)?;
        }

        let _ = body_task.await;
        stats.active_connections.fetch_add(-1, Ordering::Relaxed);
        Ok(())
    }
}

async fn send_grpc_error(
    respond: &mut h2::server::SendResponse<Bytes>,
    code: u32,
    msg: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let resp = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/grpc")
        .header("grpc-status", code.to_string())
        .header("grpc-message", msg)
        .body(())?;
    respond.send_response(resp, true)?;
    Ok(())
}