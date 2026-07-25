use bytes::Bytes;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const TEMPLATE: &str = include_str!("template.html");

pub fn error_page(code: u16) -> Bytes {
    let reason = status_reason(code);
    let msg = status_message(code);
    build(
        &format!("{code} {reason}"),
        &code.to_string(),
        reason,
        msg,
    )
}

pub fn default_page() -> Bytes {
    build(
        "Welcome to EcliHalo < 3",
        "",
        "EcliHalo is running",
        "If you see this page, the proxy is running but no route is configured for this host &#128148;",
    )
}

fn build(title: &str, error: &str, error_title: &str, error_message: &str) -> Bytes {
    let html = TEMPLATE
        .replace("{title}", title)
        .replace("{version}", VERSION)
        .replace("{error}", error)
        .replace("{error_title}", error_title)
        .replace("{error_message}", error_message);
    Bytes::from(html)
}

pub fn status_reason(code: u16) -> &'static str {
    match code {
        100 => "Continue",
        101 => "Switching Protocols",
        102 => "Processing",                       // RFC 2518
        103 => "Early Hints",                      // RFC 8297
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        203 => "Non-Authoritative Information",
        204 => "No Content",
        205 => "Reset Content",
        206 => "Partial Content",
        207 => "Multi-Status",                     // RFC 4918
        208 => "Already Reported",                 // RFC 5842
        226 => "IM Used",                          // RFC 3229
        300 => "Multiple Choices",
        301 => "Moved Permanently",
        302 => "Found",
        303 => "See Other",
        304 => "Not Modified",
        305 => "Use Proxy",
        306 => "Switch Proxy",
        307 => "Temporary Redirect",
        308 => "Permanent Redirect",               // RFC 7538
        400 => "Bad Request",
        401 => "Unauthorized",
        402 => "Payment Required",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        406 => "Not Acceptable",
        407 => "Proxy Authentication Required",
        408 => "Request Timeout",
        409 => "Conflict",
        410 => "Gone",
        411 => "Length Required",
        412 => "Precondition Failed",
        413 => "Content Too Large",                // RFC 9110
        414 => "URI Too Long",
        415 => "Unsupported Media Type",
        416 => "Range Not Satisfiable",
        417 => "Expectation Failed",
        418 => "I'm a teapot",                     // RFC 2324
        421 => "Misdirected Request",              // RFC 7540
        422 => "Unprocessable Content",            // RFC 9110
        423 => "Locked",                           // RFC 4918
        424 => "Failed Dependency",                // RFC 4918
        425 => "Too Early",                        // RFC 8470
        426 => "Upgrade Required",
        428 => "Precondition Required",            // RFC 6585
        429 => "Too Many Requests",                // RFC 6585
        431 => "Request Header Fields Too Large",  // RFC 6585
        451 => "Unavailable For Legal Reasons",    // RFC 7725
        500 => "Internal Server Error",
        501 => "Not Implemented",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        505 => "HTTP Version Not Supported",
        506 => "Variant Also Negotiates",          // RFC 2295
        507 => "Insufficient Storage",             // RFC 4918
        508 => "Loop Detected",                    // RFC 5842
        510 => "Not Extended",                     // RFC 2774
        511 => "Network Authentication Required",  // RFC 6585
        _ => "Error",
    }
}

pub fn status_message(code: u16) -> &'static str {
    match code {
        100 => "The server received the request headers and is waiting for the body.",
        101 => "The server is switching protocols as requested.",
        102 => "The server is processing the request but has no response yet.",
        103 => "Early hints to help the client start preloading resources.",
        200 => "The request succeeded.",
        201 => "A new resource has been successfully created.",
        202 => "The request was accepted for processing but is not completed yet.",
        203 => "The returned metadata is from a transforming proxy, not the origin server.",
        204 => "The request succeeded but there is no content to return.",
        205 => "The client should reset the document view.",
        206 => "The server is returning partial content.",
        207 => "Multiple status values are provided for different parts of the request.",
        208 => "This resource has already been reported earlier in the response.",
        226 => "The server fulfilled the request using delta encoding.",
        300 => "Multiple options are available for the requested resource.",
        301 => "The resource has been permanently moved to a new location.",
        302 => "The resource is temporarily located at a different URI.",
        303 => "The client should retrieve the resource using a GET request.",
        304 => "The resource has not changed since the last request.",
        305 => "The resource must be accessed through a proxy.",
        306 => "Unused code, kept for historical reasons.",
        307 => "The resource is temporarily redirected; method must not change.",
        308 => "The resource is permanently redirected; method must not change.",
        400 => "The server could not understand the request.",
        401 => "Authentication is required to access this resource.",
        402 => "Payment is required to access this resource.",
        403 => "Access to this resource is forbidden.",
        404 => "The requested resource was not found.",
        405 => "The HTTP method is not allowed for this resource.",
        406 => "The resource cannot generate content acceptable to the client.",
        407 => "Proxy authentication is required.",
        408 => "The server timed out waiting for the request.",
        409 => "The request conflicts with the current state of the resource.",
        410 => "The resource is gone and will not return.",
        411 => "The request requires a Content-Length header.",
        412 => "A precondition in the request failed.",
        413 => "The request content is too large for the server to process.",
        414 => "The URI is too long for the server to process.",
        415 => "The server does not support the media type of the request.",
        416 => "The requested range cannot be satisfied.",
        417 => "The server cannot meet the Expect header requirements.",
        418 => "The server refuses to brew coffee in a teapot.",
        421 => "The request was directed to the wrong server.",
        422 => "The server understands the content but cannot process it.",
        423 => "The resource is locked.",
        424 => "The request failed due to a dependency on another failed request.",
        425 => "The server is unwilling to risk processing the request yet.",
        426 => "The client must upgrade to a different protocol.",
        428 => "The request requires preconditions.",
        429 => "Too many requests. Please slow down.",
        431 => "The request headers are too large to process.",
        451 => "The resource is unavailable due to legal restrictions.",
        500 => "The server encountered an internal error.",
        501 => "The server does not support the requested functionality.",
        502 => "The upstream server returned an invalid response.",
        503 => "The server is temporarily unavailable.",
        504 => "The upstream server did not respond in time.",
        505 => "The server does not support the HTTP protocol version.",
        506 => "The server has a negotiation configuration error.",
        507 => "The server has insufficient storage to complete the request.",
        508 => "The server detected an infinite loop while processing the request.",
        510 => "Further extensions are required to fulfill the request.",
        511 => "Network authentication is required to access this resource.",
        _ => "An error occurred while processing your request.",
    }
}