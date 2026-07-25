use std::str;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Head,
    Post,
    Put,
    Delete,
    Options,
    Patch,
    Connect,
    Trace,
}

impl Method {
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        match b {
            b"GET" => Some(Self::Get),
            b"HEAD" => Some(Self::Head),
            b"POST" => Some(Self::Post),
            b"PUT" => Some(Self::Put),
            b"DELETE" => Some(Self::Delete),
            b"OPTIONS" => Some(Self::Options),
            b"PATCH" => Some(Self::Patch),
            b"CONNECT" => Some(Self::Connect),
            b"TRACE" => Some(Self::Trace),
            _ => None,
        }
    }

}

#[derive(Debug)]
pub struct Request {
    pub method: Method,
    pub path: String,
    pub version: u8,
    pub host: String,
    pub content_length: Option<u64>,
    pub transfer_chunked: bool,
    pub connection_close: bool,
    pub upgrade: Option<String>,
    pub expect_continue: bool,
    pub headers_end: usize,
}

#[derive(Debug)]
pub struct Response {
    pub status: u16,
    pub content_length: Option<u64>,
    pub transfer_chunked: bool,
    pub connection_close: bool,
    pub headers_end: usize,
}

#[derive(Debug)]
pub enum ParseError {
    Incomplete,
    Invalid,
}

pub fn parse_request(buf: &[u8]) -> Result<Request, ParseError> {
    if let Ok(req) = parse_request_fast(buf) {
        return Ok(req);
    }
    parse_request_httparse(buf)
}

fn parse_request_fast(buf: &[u8]) -> Result<Request, ParseError> {
    let end = find_headers_end(buf).ok_or(ParseError::Incomplete)?;

    let mut lines = buf[..end].split(|&b| b == b'\n');
    let req_line = lines.next().ok_or(ParseError::Invalid)?;
    let req_line = trim_crlf(req_line);

    let mut parts = req_line.splitn(3, |&b| b == b' ');
    let method_bytes = parts.next().ok_or(ParseError::Invalid)?;
    let path_bytes = parts.next().ok_or(ParseError::Invalid)?;
    let version_bytes = parts.next().unwrap_or(b"HTTP/1.1");

    let method = Method::from_bytes(method_bytes).ok_or(ParseError::Invalid)?;
    let path = str::from_utf8(path_bytes)
        .map_err(|_| ParseError::Invalid)?
        .to_owned();
    let version = if version_bytes.ends_with(b"1.0") { 0 } else { 1 };

    let mut host = String::new();
    let mut content_length = None;
    let mut transfer_chunked = false;
    let mut connection_close = version == 0;
    let mut upgrade = None;
    let mut expect_continue = false;

    for line in lines {
        let line = trim_crlf(line);
        if line.is_empty() {
            break;
        }

        let colon = memchr::memchr(b':', line).ok_or(ParseError::Invalid)?;
        let name = &line[..colon];
        let value = ltrim(&line[colon + 1..]);

        if eq_ic(name, b"host") {
            host = str::from_utf8(value)
                .unwrap_or("")
                .split(':')
                .next()
                .unwrap_or("")
                .to_lowercase();
        } else if eq_ic(name, b"content-length") {
            content_length = str::from_utf8(value)
                .ok()
                .and_then(|s| s.trim().parse().ok());
        } else if eq_ic(name, b"transfer-encoding") {
            transfer_chunked = value.windows(7).any(|w| eq_ic(w, b"chunked"));
        } else if eq_ic(name, b"connection") {
            connection_close = value.windows(5).any(|w| eq_ic(w, b"close"));
        } else if eq_ic(name, b"upgrade") {
            upgrade = str::from_utf8(value)
                .ok()
                .map(|s| s.trim().to_lowercase());
        } else if eq_ic(name, b"expect") {
            expect_continue = value.windows(12).any(|w| eq_ic(w, b"100-continue"));
        }
    }

    Ok(Request {
        method,
        path,
        version,
        host,
        content_length,
        transfer_chunked,
        connection_close,
        upgrade,
        expect_continue,
        headers_end: end,
    })
}

fn parse_request_httparse(buf: &[u8]) -> Result<Request, ParseError> {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut req = httparse::Request::new(&mut headers);

    match req.parse(buf).map_err(|_| ParseError::Invalid)? {
        httparse::Status::Complete(end) => {
            let method = Method::from_bytes(req.method.unwrap_or("GET").as_bytes())
                .ok_or(ParseError::Invalid)?;
            let path = req.path.unwrap_or("/").to_owned();
            let version = req.version.unwrap_or(1) - 10;

            let mut host = String::new();
            let mut content_length = None;
            let mut transfer_chunked = false;
            let mut connection_close = version == 0;
            let mut upgrade = None;
            let mut expect_continue = false;

            for h in req.headers {
                if eq_ic(h.name.as_bytes(), b"host") {
                    host = str::from_utf8(h.value)
                        .unwrap_or("")
                        .split(':')
                        .next()
                        .unwrap_or("")
                        .to_lowercase();
                } else if eq_ic(h.name.as_bytes(), b"content-length") {
                    content_length = str::from_utf8(h.value)
                        .ok()
                        .and_then(|s| s.parse().ok());
                } else if eq_ic(h.name.as_bytes(), b"transfer-encoding") {
                    transfer_chunked = h.value.windows(7).any(|w| eq_ic(w, b"chunked"));
                } else if eq_ic(h.name.as_bytes(), b"connection") {
                    connection_close = h.value.windows(5).any(|w| eq_ic(w, b"close"));
                } else if eq_ic(h.name.as_bytes(), b"upgrade") {
                    upgrade = str::from_utf8(h.value)
                        .ok()
                        .map(|s| s.trim().to_lowercase());
                } else if eq_ic(h.name.as_bytes(), b"expect") {
                    expect_continue = h.value.windows(12).any(|w| eq_ic(w, b"100-continue"));
                }
            }

            Ok(Request {
                method,
                path,
                version,
                host,
                content_length,
                transfer_chunked,
                connection_close,
                upgrade,
                expect_continue,
                headers_end: end,
            })
        }
        httparse::Status::Partial => Err(ParseError::Incomplete),
    }
}

pub fn parse_response(buf: &[u8]) -> Result<Response, ParseError> {
    if let Ok(resp) = parse_response_fast(buf) {
        return Ok(resp);
    }
    parse_response_httparse(buf)
}

fn parse_response_fast(buf: &[u8]) -> Result<Response, ParseError> {
    let end = find_headers_end(buf).ok_or(ParseError::Incomplete)?;

    // "HTTP/1.1 200 OK\r\n"
    let status_line_end = memchr::memchr(b'\n', buf).ok_or(ParseError::Incomplete)?;
    let status_line = &buf[..status_line_end];
    // "HTTP/1.1 NNN ..." byte 9
    if status_line.len() < 12 {
        return Err(ParseError::Invalid);
    }
    let status = str::from_utf8(&status_line[9..12])
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .ok_or(ParseError::Invalid)?;

    let mut content_length = None;
    let mut transfer_chunked = false;
    let mut connection_close = false;

    let headers = &buf[status_line_end + 1..end - 4]; // before \r\n\r\n
    for line in headers.split(|&b| b == b'\n') {
        let line = trim_crlf(line);
        if line.is_empty() {
            break;
        }
        let colon = memchr::memchr(b':', line).ok_or(ParseError::Invalid)?;
        let name = &line[..colon];
        let value = ltrim(&line[colon + 1..]);

        if eq_ic(name, b"content-length") {
            content_length = str::from_utf8(value)
                .ok()
                .and_then(|s| s.trim().parse().ok());
        } else if eq_ic(name, b"transfer-encoding") {
            transfer_chunked = value.windows(7).any(|w| eq_ic(w, b"chunked"));
        } else if eq_ic(name, b"connection") {
            connection_close = value.windows(5).any(|w| eq_ic(w, b"close"));
        }
    }

    Ok(Response {
        status,
        content_length,
        transfer_chunked,
        connection_close,
        headers_end: end,
    })
}

fn parse_response_httparse(buf: &[u8]) -> Result<Response, ParseError> {
    let mut headers = [httparse::EMPTY_HEADER; 64];
    let mut resp = httparse::Response::new(&mut headers);

    match resp.parse(buf).map_err(|_| ParseError::Invalid)? {
        httparse::Status::Complete(end) => {
            let status = resp.code.ok_or(ParseError::Invalid)?;

            let mut content_length = None;
            let mut transfer_chunked = false;
            let mut connection_close = false;

            for h in resp.headers {
                if eq_ic(h.name.as_bytes(), b"content-length") {
                    content_length = str::from_utf8(h.value)
                        .ok()
                        .and_then(|s| s.parse().ok());
                } else if eq_ic(h.name.as_bytes(), b"transfer-encoding") {
                    transfer_chunked = h.value.windows(7).any(|w| eq_ic(w, b"chunked"));
                } else if eq_ic(h.name.as_bytes(), b"connection") {
                    connection_close = h.value.windows(5).any(|w| eq_ic(w, b"close"));
                }
            }

            Ok(Response {
                status,
                content_length,
                transfer_chunked,
                connection_close,
                headers_end: end,
            })
        }
        httparse::Status::Partial => Err(ParseError::Incomplete),
    }
}

pub fn parse_chunk_size(buf: &[u8]) -> Result<(usize, usize), ParseError> {
    let lf = memchr::memchr(b'\n', buf).ok_or(ParseError::Incomplete)?;
    let line = trim_crlf(&buf[..lf]);
    let hex = line.split(|&b| b == b';').next().unwrap_or(line);
    let size = usize::from_str_radix(
        str::from_utf8(hex)
            .map_err(|_| ParseError::Invalid)?
            .trim(),
        16,
    )
    .map_err(|_| ParseError::Invalid)?;
    const MAX_CHUNK: usize = 128 * 1024 * 1024;
    if size > MAX_CHUNK {
        return Err(ParseError::Invalid);
    }
    Ok((size, lf + 1))
}

fn find_headers_end(buf: &[u8]) -> Option<usize> {
    memchr::memmem::find(buf, b"\r\n\r\n").map(|i| i + 4)
}

fn trim_crlf(b: &[u8]) -> &[u8] {
    let mut e = b.len();
    if e > 0 && b[e - 1] == b'\n' {
        e -= 1;
    }
    if e > 0 && b[e - 1] == b'\r' {
        e -= 1;
    }
    &b[..e]
}

fn ltrim(b: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < b.len() && (b[i] == b' ' || b[i] == b'\t') {
        i += 1;
    }
    &b[i..]
}

pub fn eq_ic(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_ascii_lowercase() == *y)
}