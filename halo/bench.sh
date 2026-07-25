#!/usr/bin/env bash
# This benchmark was made by Claude Opus to test EcliHalo against nginx

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
find_root() {
    local d="$1"
    while [[ "$d" != "/" ]]; do
        [[ -f "$d/Cargo.toml" ]] && { echo "$d"; return 0; }
        d="$(dirname "$d")"
    done
    return 1
}
ROOT_DIR="$(find_root "$SCRIPT_DIR")" \
    || { echo "ERROR: Cargo.toml not found above $SCRIPT_DIR"; exit 1; }
cd "$ROOT_DIR"

BACKEND_PORT=9001
HALO_HTTP_PORT=8081
HALO_HTTPS_PORT=8443
NGINX_HTTP_PORT=8090
NGINX_HTTPS_PORT=8444
DURATION=30
MAX_CONNS=200
OUT_DIR="$ROOT_DIR/bench-results"
SKIP_BUILD=0
THREADS=$(nproc 2>/dev/null || echo 4)

declare -a OWNED_PIDS=()

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()   { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()    { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $*"; }
warn()  { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC}  $*"; }
fail()  { echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $*" >&2; exit 1; }
title() { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}\n"; }

cleanup() {
    echo ""
    log "Shutting down..."
    for pid in "${OWNED_PIDS[@]:-}"; do
        kill "$pid" 2>/dev/null || true
    done
    
    # Stop nginx instances
    for conf in /tmp/nginx-bench.conf /tmp/backend-bench.conf; do
        if [[ -f "$conf" ]]; then
            nginx -c "$conf" -s stop 2>/dev/null || true
        fi
    done
    
    sleep 0.3
    for pid in "${OWNED_PIDS[@]:-}"; do
        kill -9 "$pid" 2>/dev/null || true
    done
    
    rm -f /tmp/eclihalo-bench.yml /tmp/nginx-bench.conf \
          /tmp/backend-bench.conf /tmp/*.pid
}
trap cleanup EXIT

wait_port() {
    local host=$1 port=$2 name=$3 tries=60
    log "Waiting for $name on $host:$port..."
    for i in $(seq 1 "$tries"); do
        if (echo >/dev/tcp/"$host"/"$port") 2>/dev/null; then
            ok "$name up (attempt $i)"
            return 0
        fi
        sleep 0.5
    done
    fail "$name did not start"
}

check_deps() {
    local miss=()
    for c in wrk nginx openssl curl python3; do
        command -v "$c" &>/dev/null || miss+=("$c")
    done
    [[ ${#miss[@]} -eq 0 ]] || fail "Missing: ${miss[*]}"
    
    # Check if wrk supports HTTPS (it doesn't on your system)
    if wrk 2>&1 | grep -q "https://"; then
        HAS_HTTPS_WRK=1
    else
        HAS_HTTPS_WRK=0
        warn "wrk doesn't support HTTPS - using HTTP for tests"
    fi
    
    command -v gnuplot &>/dev/null && HAS_GNUPLOT=1 || HAS_GNUPLOT=0
    ok "Deps OK"
}

while getopts "d:w:o:sh" opt; do
    case $opt in
        d) DURATION=$OPTARG  ;;
        w) MAX_CONNS=$OPTARG ;;
        o) OUT_DIR=$OPTARG   ;;
        s) SKIP_BUILD=1      ;;
        *) exit 0 ;;
    esac
done

title "Setup"
mkdir -p "$OUT_DIR"
check_deps
ulimit -n 65535 2>/dev/null || warn "Could not raise ulimit -n"

if [[ $SKIP_BUILD -eq 0 ]]; then
    log "cargo build --release ..."
    if ! cargo build --release 2>&1 | tee "$OUT_DIR/build.log" | grep -qE '(error|warning\[|Compiling|Finished)'; then
        fail "Build failed - check $OUT_DIR/build.log"
    fi
    ok "Build done"
fi

HALO_BIN="$ROOT_DIR/target/release/eclihalo"
[[ -x "$HALO_BIN" ]] || fail "Binary missing: $HALO_BIN"

# =============================================================================
title "Backend — nginx (HTTP/1.1 keep-alive)"
# =============================================================================
BACKEND_STATIC="/tmp/eclihalo-bench-backend"
rm -rf "$BACKEND_STATIC" && mkdir -p "$BACKEND_STATIC"

python3 - "$BACKEND_STATIC" <<'PY'
import os, sys, json
root = sys.argv[1]

with open(f"{root}/index.html","w") as f:
    f.write("<html><body>bench</body></html>")

with open(f"{root}/json","w") as f:
    json.dump({"status": "ok"}, f)

for name, sz in [("kb",1024),("10kb",10240),("100kb",102400)]:
    with open(f"{root}/{name}","wb") as f:
        f.write(b"x" * sz)

with open(f"{root}/slow","w") as f:
    f.write("slow ok\n")
PY

BACKEND_PREFIX="/tmp/nginx-backend"
mkdir -p "$BACKEND_PREFIX"/{logs,tmp,client_body}

cat > /tmp/backend-bench.conf <<NGINX
worker_processes  auto;
error_log  $BACKEND_PREFIX/logs/error.log warn;
pid        $BACKEND_PREFIX/nginx.pid;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
    multi_accept       on;
}

http {
    sendfile           on;
    tcp_nopush         on;
    tcp_nodelay        on;
    keepalive_timeout  65;
    keepalive_requests 1000000;
    access_log         off;

    types {
        text/html html;
        application/json json;
    }
    default_type text/plain;

    server {
        listen 127.0.0.1:$BACKEND_PORT;
        root $BACKEND_STATIC;

        location = / {
            return 200 "ok\\n";
        }
        
        location = /json {
            default_type application/json;
            if (\$request_method = POST) {
                return 200 '{"received":true}';
            }
            try_files /json =404;
        }
        
        location = /slow {
            return 200 "slow ok\\n";
        }
        
        location / {
            try_files \$uri =404;
        }
    }
}
NGINX

nginx -c /tmp/backend-bench.conf -p "$BACKEND_PREFIX" || fail "backend nginx failed"
sleep 1
wait_port 127.0.0.1 "$BACKEND_PORT" "backend-nginx"

BACKEND_PID=$(cat "$BACKEND_PREFIX/nginx.pid")
OWNED_PIDS+=("$BACKEND_PID")

curl -sf "http://127.0.0.1:$BACKEND_PORT/" | grep -q ok || fail "Backend check failed"
ok "Backend ready (pid=$BACKEND_PID)"

# =============================================================================
title "Static files"
# =============================================================================
STATIC_ROOT="/tmp/eclihalo-bench-static"
rm -rf "$STATIC_ROOT" && mkdir -p "$STATIC_ROOT"

python3 - "$STATIC_ROOT" <<'PY'
import os, sys
root = sys.argv[1]
with open(f"{root}/index.html","w") as f:
    f.write("<html><body>static</body></html>")
for name, sz in [("1kb.bin",1024),("10kb.bin",10240),
                 ("100kb.bin",102400),("1mb.bin",1048576)]:
    with open(f"{root}/{name}","wb") as f:
        f.write(os.urandom(sz))
PY

ok "Static root: $STATIC_ROOT"

# =============================================================================
title "EcliHalo"
# =============================================================================
cat > /tmp/eclihalo-bench.yml <<YAML
http:
  port: $HALO_HTTP_PORT
https:
  port: $HALO_HTTPS_PORT
tls:
  mode: self_signed
  hostname: localhost
rate_limit:
  enabled: false
routes:
  - domain: localhost
    strategy: round_robin
    upstreams:
      - 127.0.0.1:$BACKEND_PORT
    static_files:
      root: $STATIC_ROOT
      index: index.html
      max_age: 3600
      cache_enabled: true

  - domain: nocache.localhost
    strategy: round_robin
    upstreams:
      - 127.0.0.1:$BACKEND_PORT
    static_files:
      root: $STATIC_ROOT
      cache_enabled: false
YAML

log "Starting eclihalo..."
"$HALO_BIN" start --config /tmp/eclihalo-bench.yml \
    >"$OUT_DIR/eclihalo.log" 2>&1 &
HALO_PID=$!
OWNED_PIDS+=("$HALO_PID")

wait_port 127.0.0.1 "$HALO_HTTP_PORT" "eclihalo-http"

# Warmup
for i in $(seq 1 20); do
    curl -sf "http://localhost:$HALO_HTTP_PORT/" -o /dev/null || true
done
ok "eclihalo ready (pid=$HALO_PID)"

# =============================================================================
title "nginx proxy"
# =============================================================================
NGINX_PREFIX="/tmp/nginx-bench"
mkdir -p "$NGINX_PREFIX"/{logs,tmp,client_body}

cat > /tmp/nginx-bench.conf <<NGINX
worker_processes  auto;
error_log  $NGINX_PREFIX/logs/error.log warn;
pid        $NGINX_PREFIX/nginx.pid;
worker_rlimit_nofile 65535;

events {
    worker_connections  4096;
    multi_accept        on;
}

http {
    sendfile            on;
    tcp_nopush          on;
    tcp_nodelay         on;
    keepalive_timeout   65;
    keepalive_requests  1000000;
    access_log          off;

    upstream backend {
        server 127.0.0.1:$BACKEND_PORT;
        keepalive 256;
        keepalive_requests 1000000;
        keepalive_timeout 90s;
    }

    server {
        listen $NGINX_HTTP_PORT;
        
        location / {
            proxy_pass          http://backend;
            proxy_http_version  1.1;
            proxy_set_header    Connection "";
            proxy_set_header    Host \$host;
        }

        location ~* ^/.*\.(bin|html)$ {
            root $STATIC_ROOT;
            expires 1h;
        }
    }
}
NGINX

nginx -c /tmp/nginx-bench.conf -p "$NGINX_PREFIX" || fail "nginx failed"
sleep 1
wait_port 127.0.0.1 "$NGINX_HTTP_PORT" "nginx"

NGINX_PID=$(cat "$NGINX_PREFIX/nginx.pid")
OWNED_PIDS+=("$NGINX_PID")

for i in $(seq 1 20); do
    curl -sf "http://localhost:$NGINX_HTTP_PORT/" -o /dev/null || true
done
ok "nginx ready (pid=$NGINX_PID)"

# =============================================================================
title "Sanity checks"
# =============================================================================
log "Connection reuse check..."
for name in "eclihalo:$HALO_HTTP_PORT" "nginx:$NGINX_HTTP_PORT"; do
    proxy="${name%%:*}"
    port="${name##*:}"
    
    before=$(ss -tn dst "127.0.0.1:$BACKEND_PORT" | grep -c ESTAB || echo 0)
    for i in $(seq 1 10); do
        curl -sf "http://localhost:$port/" -o /dev/null
    done
    sleep 0.2
    after=$(ss -tn dst "127.0.0.1:$BACKEND_PORT" | grep -c ESTAB || echo 0)
    
    log "  $proxy: connections before=$before after=$after"
    if [[ $((after - before)) -gt 5 ]]; then
        warn "$proxy may not be reusing connections"
    fi
done

# =============================================================================
# Helpers
# =============================================================================
parse_rps()    { grep -oP 'Requests/sec:\s+\K[\d.]+' "$1" 2>/dev/null || echo 0; }
parse_p99()    { grep -oP '^\s+99%\s+\K\S+' "$1" 2>/dev/null || echo "?"; }
parse_errors() { grep -oP 'Non-2xx or 3xx responses:\s+\K\d+' "$1" 2>/dev/null || echo 0; }

winner() {
    python3 -c "
a=float('${1}' or 0); b=float('${2}' or 0)
if a==0 and b==0:   print('n/a')
elif b==0:          print('eclihalo')
elif a==0:          print('nginx')
elif a>b*1.05:      print('eclihalo (+{:.0f}%)'.format((a-b)/b*100))
elif b>a*1.05:      print('nginx (+{:.0f}%)'.format((b-a)/a*100))
else:               print('≈ tie')
" 2>/dev/null || echo "?"
}

run_pair() {
    local label=$1 hurl=$2 nurl=$3 conns=$4 thr=$5 dur=$6
    shift 6
    local extra=("$@")
    local hf="$OUT_DIR/${label}_halo.txt"
    local nf="$OUT_DIR/${label}_nginx.txt"

    (( thr > conns )) && thr=$conns
    (( thr < 1 ))     && thr=1

    log "  [$label] c=$conns t=$thr d=${dur}s"

    wrk -t"$thr" -c"$conns" -d"${dur}s" --latency \
        "${extra[@]}" "$hurl" >"$hf" 2>&1 || true
    sleep 1

    wrk -t"$thr" -c"$conns" -d"${dur}s" --latency \
        "${extra[@]}" "$nurl" >"$nf" 2>&1 || true
    sleep 1

    local hr nr
    hr=$(parse_rps "$hf"); nr=$(parse_rps "$nf")
    printf "    → eclihalo=%8.0f rps   nginx=%8.0f rps   %s\n" \
        "$hr" "$nr" "$(winner "$hr" "$nr")"
}

# =============================================================================
title "Benchmarks"
# =============================================================================
HALO_URL="http://localhost:$HALO_HTTP_PORT"
NGINX_URL="http://localhost:$NGINX_HTTP_PORT"
T=$THREADS

thr() { local t=$(( $1 < T ? $1 : T )); (( t < 1 )) && t=1; echo $t; }

log "1/4  Concurrency ramp (10s)"
echo "conns,halo_rps,nginx_rps" > "$OUT_DIR/ramp.csv"
for c in 1 10 50 100 "$MAX_CONNS"; do
    run_pair "ramp_c${c}" "$HALO_URL/" "$NGINX_URL/" "$c" "$(thr "$c")" 10
    echo "$c,$(parse_rps "$OUT_DIR/ramp_c${c}_halo.txt"),$(parse_rps "$OUT_DIR/ramp_c${c}_nginx.txt")" \
        >> "$OUT_DIR/ramp.csv"
done

log "2/4  Payload sizes (c=50, 10s)"
echo "path,halo_rps,nginx_rps" > "$OUT_DIR/payload.csv"
for path in "/" "/json" "/kb" "/10kb" "/100kb"; do
    safe="payload$(echo "$path" | tr '/' '_')"
    [[ "$safe" == "payload_" ]] && safe="payload_root"
    run_pair "$safe" "$HALO_URL$path" "$NGINX_URL$path" 50 "$(thr 50)" 10
    echo "$path,$(parse_rps "$OUT_DIR/${safe}_halo.txt"),$(parse_rps "$OUT_DIR/${safe}_nginx.txt")" \
        >> "$OUT_DIR/payload.csv"
done

log "3/4  Full suite (${DURATION}s, c=100)"
t=$(thr 100)
run_pair "get"  "$HALO_URL/"     "$NGINX_URL/"     100 "$t" "$DURATION"
run_pair "json" "$HALO_URL/json" "$NGINX_URL/json" 100 "$t" "$DURATION"

log "4/4  Static files (c=50, 10s)"
echo "file,halo_rps,nginx_rps" > "$OUT_DIR/static.csv"
for f in index.html 1kb.bin 10kb.bin 100kb.bin 1mb.bin; do
    safe="static_$(echo "$f" | tr '.' '_')"
    run_pair "$safe" "$HALO_URL/$f" "$NGINX_URL/$f" 50 "$(thr 50)" 10
    hr=$(parse_rps "$OUT_DIR/${safe}_halo.txt")
    nr=$(parse_rps "$OUT_DIR/${safe}_nginx.txt")
    echo "$f,$hr,$nr" >> "$OUT_DIR/static.csv"
done

# =============================================================================
title "Report"
# =============================================================================
REPORT="$OUT_DIR/report.txt"

{
cat <<HDR
╔══════════════════════════════════════════════════════════════╗
║       EcliHalo  vs  nginx  —  Benchmark Report               ║
║  $(printf '%-56s' "$(date)")  ║
╚══════════════════════════════════════════════════════════════╝

System: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs) ($THREADS cores)
wrk:    $(wrk --version 2>&1 | head -1)
nginx:  $(nginx -v 2>&1)

════════════════════════════════════════════════════════════════
 CONCURRENCY RAMP
════════════════════════════════════════════════════════════════
$(printf "%-10s %12s %12s %s\n" "Conns" "Halo RPS" "nginx RPS" "Winner")
HDR

while IFS=',' read -r c h n; do
    [[ "$c" == "conns" ]] && continue
    printf "%-10s %12.0f %12.0f %s\n" "$c" "$h" "$n" "$(winner "$h" "$n")"
done < "$OUT_DIR/ramp.csv"

cat <<MID

════════════════════════════════════════════════════════════════
 PAYLOAD SIZE
════════════════════════════════════════════════════════════════
$(printf "%-10s %12s %12s %s\n" "Path" "Halo RPS" "nginx RPS" "Winner")
MID

while IFS=',' read -r path h n; do
    [[ "$path" == "path" ]] && continue
    printf "%-10s %12.0f %12.0f %s\n" "$path" "$h" "$n" "$(winner "$h" "$n")"
done < "$OUT_DIR/payload.csv"

cat <<END

════════════════════════════════════════════════════════════════
 STATIC FILES
════════════════════════════════════════════════════════════════
$(printf "%-15s %12s %12s %s\n" "File" "Halo RPS" "nginx RPS" "Winner")
END

while IFS=',' read -r f h n; do
    [[ "$f" == "file" ]] && continue
    printf "%-15s %12.0f %12.0f %s\n" "$f" "$h" "$n" "$(winner "$h" "$n")"
done < "$OUT_DIR/static.csv"

echo ""
echo "Full data: $OUT_DIR/"
} | tee "$REPORT"

# =============================================================================
title "Chart"
# =============================================================================

if [[ ${HAS_GNUPLOT:-0} -eq 1 ]]; then
    GP="$OUT_DIR/chart.gnuplot"
    cat > "$GP" <<'GNUPLOT'
set terminal pngcairo size 1800,700 font "system-ui,11" enhanced
set output '__OUTDIR__/chart.png'

set style data histograms
set style histogram cluster gap 1.2
set style fill solid 0.85 border -1
set boxwidth 0.8

GNUPLOT

    {
        # ramp_halo (col 2)
        printf '$ramp_halo << EOD\n'
        tail -n+2 "$OUT_DIR/ramp.csv" | while IFS=',' read -r c h n; do printf '"%s" %s\n' "$c" "$h"; done
        printf 'EOD\n'

        # ramp_nginx (col 3)
        printf '$ramp_nginx << EOD\n'
        tail -n+2 "$OUT_DIR/ramp.csv" | while IFS=',' read -r c h n; do printf '"%s" %s\n' "$c" "$n"; done
        printf 'EOD\n'

        # payload_halo
        printf '$payload_halo << EOD\n'
        tail -n+2 "$OUT_DIR/payload.csv" | while IFS=',' read -r p h n; do printf '"%s" %s\n' "$p" "$h"; done
        printf 'EOD\n'

        # payload_nginx
        printf '$payload_nginx << EOD\n'
        tail -n+2 "$OUT_DIR/payload.csv" | while IFS=',' read -r p h n; do printf '"%s" %s\n' "$p" "$n"; done
        printf 'EOD\n'

        # static_halo
        printf '$static_halo << EOD\n'
        tail -n+2 "$OUT_DIR/static.csv" | while IFS=',' read -r f h n; do printf '"%s" %s\n' "$f" "$h"; done
        printf 'EOD\n'

        # static_nginx
        printf '$static_nginx << EOD\n'
        tail -n+2 "$OUT_DIR/static.csv" | while IFS=',' read -r f h n; do printf '"%s" %s\n' "$f" "$n"; done
        printf 'EOD\n'
    } >> "$GP"

    cat >> "$GP" <<'GNUPLOT'
set multiplot layout 1,3 title "EcliHalo vs nginx — Requests/sec\n__CPU__ · wrk · __DUR__s runs" font ",14"

set title "Concurrency Ramp (root /)" font ",12"
set ylabel "Requests/sec" font ",10"
set xlabel "Connections" font ",10" offset 0,0.3
set yrange [0:*]
set ytics autofreq
set key top left font ",10" spacing 1.2
set grid ytics ls -1 lc rgb "#d0d0d0"
set xtics font ",10"
set tmargin 4
plot $ramp_halo using 2:xtic(1) title 'EcliHalo' lc rgb '#2a78d6', \
     $ramp_nginx using 2:xtic(1) title 'nginx' lc rgb '#eb6834'

set title "Payload Size (c=50)" font ",12"
set ylabel "" font ",10"
set xlabel "Path" font ",10" offset 0,0.3
set yrange [0:*]
set ytics autofreq
set key off
set tmargin 4
plot $payload_halo using 2:xtic(1) title '' lc rgb '#2a78d6', \
     $payload_nginx using 2:xtic(1) title '' lc rgb '#eb6834'

set title "Static Files (c=50)" font ",12"
set ylabel "" font ",10"
set xlabel "File" font ",10" offset 0,0.3
set yrange [0:*]
set ytics autofreq
set key off
set tmargin 4
plot $static_halo using 2:xtic(1) title '' lc rgb '#2a78d6', \
     $static_nginx using 2:xtic(1) title '' lc rgb '#eb6834'

unset multiplot
set output
GNUPLOT

    cpu_name=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs | head -c 40)
    sed -i \
        -e "s|__OUTDIR__|$OUT_DIR|g" \
        -e "s|__CPU__|$cpu_name ($THREADS cores)|g" \
        -e "s|__DUR__|$DURATION|g" \
        "$GP"

    log "Running gnuplot..."
    gnuplot "$GP" && ok "chart.png generated" || warn "gnuplot failed"
else
    warn "gnuplot not found — skipping chart"
fi

title "Done  →  $REPORT"