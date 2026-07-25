import { Md } from "../_components/md";

const content = `
![EcliHalo](https://github.com/thenoname-gurl/EcliPanel/blob/main/halo/eclihalo.png?raw=true)

# EcliHalo - Reverse Proxy

EcliHalo is EcliPanels purpose built reverse proxy. It replaces nginx with a
single static binary that handles HTTP/1.1, HTTP/2, HTTP/3, TLS termination,
static file serving, load balancing, WebSocket tunnelling, and gRPC proxying
all with hot-reload via SIGHUP. 

It is designed for high performance and low latency, with a focus on simplicity and ease of use.

## Benchmark
This benchmark compares EcliHalo to Nginx.

You can view how benchmark works here: https://github.com/thenoname-gurl/EcliPanel/blob/main/halo/bench.sh

Anyways here are results, we can see up to 106% improvement in some fields comparing to nginx, higher rps = better.

![Benchmark Results](https://github.com/thenoname-gurl/EcliPanel/blob/main/halo/chart.png?raw=true)


## Quick Start

\`\`\`bash
cp target/release/eclihalo /usr/local/bin/
mkdir -p /etc/eclihalo
eclihalo systemd > /etc/systemd/system/eclihalo.service
systemctl enable --now eclihalo
\`\`\`

## Binary Commands

| Command | What it does |
|---|---|
| \`eclihalo start --config /etc/eclihalo/config.yml\` | Start the proxy |
| \`eclihalo reload\` | Hot reload config |
| \`eclihalo version\` | Print version |
| \`eclihalo systemd\` | Print systemd unit file |

## Config File

EcliHalo is configured via a single YAML file. Every nginx-equivalent directive
is represented. The full reference config lives at
\`/etc/eclihalo/config.example.yml\`.

### Minimal Config

\`\`\`yaml
http:
  port: 80
https:
  port: 443
tls:
  mode: self_signed
  hostname: localhost
routes:
  - domain: localhost
    upstreams:
      - 127.0.0.1:3000
\`\`\`

### Performance Tuning

\`\`\`yaml
performance:
  worker_threads: 8        # Default: all CPU cores
  accept_backlog: 65536    # TCP backlog per listener
  accept_batch: 256        # Multi-accept burst size
  cpu_affinity: true       # Pin workers to cores
  event_interval: 10       # Tokio poll interval (ms)
  global_queue_interval: 61
  thread_stack_size: 2097152
\`\`\`

| Setting | nginx equivalent | Notes |
|---|---|---|
| \`worker_threads\` | \`worker_processes auto\` | Number of tokio worker threads |
| \`accept_backlog\` | \`worker_connections\` + \`somaxconn\` | TCP listen backlog |
| \`accept_batch\` | \`multi_accept on\` | Connections drained per epoll wake |
| \`cpu_affinity\` | \`worker_cpu_affinity auto\` | Pin worker to CPU core |
| \`event_interval\` | — | Tokio poll interval, lower = less latency |
| \`global_queue_interval\` | — | High values disable work-stealing |

### TLS Modes

Three TLS modes are supported:

| Mode | Use case |
|---|---|
| \`provided\` | You supply cert + key PEM files |
| \`lets_encrypt\` | Auto-issue via ACME (Lets Encrypt) |
| \`self_signed\` | Dev/internal, auto-generated |

\`\`\`yaml
# Production with Let's Encrypt
tls:
  mode: lets_encrypt
  acme_email: admin@ecli.app
  acme_domains:
    - ecli.app
    - backend.ecli.app
  acme_cache_dir: /var/lib/eclihalo/acme
\`\`\`

### Per-Domain TLS (SNI)

Each route can override the global TLS cert. The proxy selects the right cert
based on the SNI hostname in the TLS ClientHello.

\`\`\`yaml
routes:
  - domain: cdn.ecli.app
    tls:
      cert_path: /etc/ssl/certs/cdn.ecli.app/fullchain.pem
      key_path: /etc/ssl/private/cdn.ecli.app/privkey.pem
    upstreams: []
    static_files:
      root: /var/www/cdn
\`\`\`

### Load Balancing

Four strategies available per route:

| Strategy | Best for |
|---|---|
| \`round_robin\` | Stateless APIs with similar capacity backends |
| \`least_connections\` | Long-lived connections, gRPC, mixed workloads |
| \`ip_hash\` | Sticky sessions, WebSocket |
| \`random\` | Uniform distribution at very high concurrency |

### Header Manipulation

\`\`\`yaml
header_rules:
  set_request:           # Inject into upstream request
    x-api-version: "v2"
  remove_request:        # Strip from upstream request
    - cookie
  set_response:          # Inject into client response
    strict-transport-security: "max-age=31536000"
    x-content-type-options: "nosniff"
  remove_response:       # Strip from client response
    - server
    - x-powered-by
\`\`\`

### Path Rewrites

Regex-based path rewriting, applied before proxying. Equivalent to nginx's
\`rewrite\` directive.

\`\`\`yaml
rewrites:
  "^/api/v1/(.*)": "/api/v2/$1"
  "^/old-blog/(.*)": "/blog/$1"
\`\`\`

### Response Caching (proxy_cache)

Caches GET and HEAD responses from upstream. Cache key is \`method:path\`.
Uses an in-memory cache per worker with configurable TTL.

\`\`\`yaml
proxy_cache:
  enabled: true
  ttl_secs: 30
  # max_size_bytes: 104857600   # default 100 MiB
\`\`\`

### Static Files

Static file serving with four cache strategies, sendfile zero-copy for files
over 64 KiB, and optional precompressed (.gz/.br) serving.

\`\`\`yaml
static_files:
  root: /var/www/cdn
  index: index.html
  max_age: 31536000
  cache_strategy: smart   # smart | ttl | mtime | none
  cache_enabled: true
  precompressed: true
\`\`\`

| Strategy | Behaviour |
|---|---|
| \`smart\` | Cache small files (≤64 KiB), sendfile large files |
| \`ttl\` | Cache with time-to-live (default 120s) |
| \`mtime\` | Cache until file modification time changes |
| \`none\` | Never cache, always read from disk |

### Custom Error Pages

nginx \`error_page\` equivalent. Map HTTP status codes to local HTML files.

\`\`\`yaml
error_pages:
  404: /var/www/errors/404.html
  502: /var/www/errors/502.html
  503: /var/www/errors/503.html
\`\`\`

### Response Rewriting

\`\`\`yaml
# Rewrite Location headers from upstream
proxy_redirect:
  "http://127.0.0.1:3000": "https://ecli.app"

# Text substitution in response bodies
sub_filter:
  "http://127.0.0.1:3000": "https://ecli.app"
\`\`\`

### WebSocket & gRPC

\`\`\`yaml
# WebSocket tunnelling
routes:
  - domain: ws.ecli.app
    websocket: true
    strategy: ip_hash       # sticky sessions
    upstream_timeout_secs: 300
    upstreams:
      - 127.0.0.1:8080

# gRPC (HTTP/2 upstream, trailer forwarding)
  - domain: grpc.ecli.app
    grpc: true
    strategy: least_connections
    upstream_timeout_secs: 120
    upstreams:
      - 127.0.0.1:50051
\`\`\`

### WebRTC Signalling

CORS headers are auto-injected when \`webrtc.cors: true\` is set — no manual
header configuration needed.

\`\`\`yaml
routes:
  - domain: rtc.ecli.app
    webrtc:
      cors: true
      signalling_paths: [/offer, /answer, /ice]
    upstreams:
      - 127.0.0.1:9090
\`\`\`

### Retry Policies

\`\`\`yaml
retry:
  tries: 2
  timeout_secs: 5
\`\`\`

## Architecture

EcliHalo uses a shared-nothing, thread-per-core architecture matching nginx's
worker model.

- **Per-core listeners** — Each CPU core gets its own \`SO_REUSEPORT\` socket,
  its own upstream connection pool, and its own static file cache. Zero
  cross-core synchronisation.
- **Lock-free connection pool** — Upstream connections are stored in a
  \`crossbeam::SegQueue\` per backend address, popped/pushed without locks.
- **Non-blocking I/O fast path** — On localhost and fast networks,
  \`try_write\`/\`try_read_buf\` complete without yielding to the async
  runtime.
- **kTLS (Kernel TLS)** — TLS record encryption/decryption is offloaded
  to the Linux kernel via \`TCP_ULP tls\`. After the OpenSSL handshake, raw
  socket I/O returns plaintext. \`sendfile()\` works through kTLS — zero
  userspace crypto.
- **sendfile zero-copy** — Static files over 64 KiB use \`sendfile64()\`,
  copying data kernel-space from disk to socket.
- **SIMD header parsing** — \`memchr::memmem::find\` uses AVX2/NEON for
  \`\\r\\n\\r\\n\` scanning.

## Cloudflare Tunnel (cloudflared)

EcliHalo works with cloudflared out of the box. The proxy preserves incoming
\`X-Forwarded-For\` headers sent by cloudflared so your backend sees the real
client IP, not 127.0.0.1. No special configuration needed.

## Prometheus Metrics

Opt-in Prometheus endpoint. Enable in config:

\`\`\`yaml
metrics: true   # default: false
\`\`\`

When enabled, \`/__eclihalo/metrics\` returns Prometheus-format data.

## Hot Reload

Edit \`/etc/eclihalo/config.yml\`, then:

\`\`\`bash
eclihalo reload
# or: systemctl reload eclihalo
# or: kill -SIGHUP $(pgrep eclihalo)
\`\`\`

Routes swap atomically. Existing connections finish on the old config.

## Rate Limiting

Per-IP token bucket throttling, with whitelist support.

\`\`\`yaml
rate_limit:
  enabled: true
  requests_per_sec: 500
  burst: 1000
  whitelist:
    - 10.0.0.
    - 172.16.
\`\`\`
`;

export default function EcliHaloDocs() {
  return <Md>{content}</Md>;
}
