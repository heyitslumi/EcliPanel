<p align="center">
  <img src="./eclipanel.png" alt="EcliPanel" width="640" />
</p>

# EcliPanel v3

EcliPanel is an in-house game/server hosting platform with:
- Panel backend API (Bun + Elysia)
- Modern frontend dashboard
- Wings-based node orchestration
- Built-in SOC/security workflows
- Optional mail, proxy, and tunneling subsystems

## Why v3?

v3 is a full rewrite of the original EcliPanel stack to provide a cleaner architecture, better performance, and fully in-house control over backend + frontend + infrastructure integrations.

## Repository structure

- `/backend` — API, auth, billing, orchestration, SOC, jobs
- `/frontend` — user/admin dashboard UI
- `/wings` — patched wings-rs source + patch/build workflow
- `/halo` — EcliHalo reverse proxy
- `/tunnel` — EcliTunnel client/server agents
- `/systemd` — service examples
- `/eggs` — example templates/eggs

## Documentation quick links

- Main showcase: [`/SHOWCASE.md`](/SHOWCASE.md)
- Security policy: [`/SECURITY.md`](/SECURITY.md)
- Wings patch/build guide: [`/wings/README.md`](/wings/README.md)
- EcliTunnel guide: [`/tunnel/README.md`](/tunnel/README.md)
- EcliHalo guide: [`/halo/README.md`](/halo/README.md)

---

## Self-hosting guide (full stack)

This section is the recommended production-oriented setup order for self-hosting EcliPanel with dependencies like Wings, Dockerized Mailcow, EcliHalo, and EcliTunnel.

## 1) Deployment topology

Use separate hostnames at minimum:
- `panel.example.com` → frontend
- `backend.example.com` → backend API
- `tunnel.example.com` (or node FQDN) → EcliTunnel public host

Core dependencies:
- MariaDB/MySQL/PostgreSQL (MariaDB recommended)
- Redis
- Bun (backend runtime)
- Bun + frontend build/runtime requirements
- One or more Wings nodes

Optional but common in production:
- Dockerized Mailcow (mailbox provisioning + mail workflows)
- EcliHalo (TLS termination/reverse proxy)
- EcliTunnel server agent (public tunnel ingress)

## 2) Host prerequisites

Install base tools on your panel host:

```bash
sudo apt update
sudo apt install -y curl git unzip ca-certificates ffmpeg espeak redis-server mariadb-server
curl -fsSL https://bun.sh/install | bash
```

> If DB/Redis run on other hosts or containers, skip local package install and use remote endpoints in `.env`.

## 3) Clone and bootstrap

```bash
cd /opt
git clone https://github.com/heyitslumi/EcliPanel.git
cd /opt/EcliPanel
```

### Backend install

```bash
cd /opt/EcliPanel/backend
bun install
cp .env.example .env
bun run gen:jwt-secret
bun run gen:pq-jwt-seed
bun run gen:default-role
```

Generate `NODE_PQ_ENCRYPTION_SEED`:

```bash
bun -e "console.log((await import('crypto')).randomBytes(64).toString('base64'))"
```

### Frontend install

```bash
cd /opt/EcliPanel/frontend
bun install
cp .env.example .env
```

## 4) Configure backend environment

Edit `/opt/EcliPanel/backend/.env` and set at least:

- Database: `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`
- Redis: `REDIS_URL`
- Auth/security: `JWT_SECRET`, `PQ_JWT_SEED`, `NODE_ENCRYPTION_KEY`, `NODE_PQ_ENCRYPTION_SEED`
- URL/CORS: `FRONTEND_URL`, `PANEL_URL`, `BACKEND_URL`, `ORIGIN`, `RP_ID`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`

Recommended for tunnels:
- `TUNNEL_PUBLIC_HOST=tunnel.example.com`
- `TUNNEL_PORT_RANGE=20000-29999`

## 5) Configure frontend environment

Edit `/opt/EcliPanel/frontend/.env`:

- `BACKEND_URL=https://backend.example.com`
- `NEXT_PUBLIC_API_BASE=https://backend.example.com`
- `NEXT_PUBLIC_WINGS_BASE=` (optional direct wings base)

## 6) Start backend + frontend

### Development mode

```bash
cd /opt/EcliPanel/backend
bun run dev

cd /opt/EcliPanel/frontend
./dev.sh --port 3000
```

### Production mode

```bash
cd /opt/EcliPanel/backend
./start.sh

cd /opt/EcliPanel/frontend
bun run build
./start.sh
```

## 7) Wings setup (required for server orchestration)

EcliPanel requires **wings-rs** (not wings-go).

### Build patched wings in-repo

```bash
cd /opt/EcliPanel/wings
./manage.sh patch
./manage.sh build
```

### Deploy wings binary to nodes

Option A (from your panel API once deployed):

```bash
curl -fsSL https://backend.example.com/api/wings/download -o /usr/local/bin/wings
chmod +x /usr/local/bin/wings
```

Option B: copy built binary from `wings/target/release/wings-rs`.

Then install/configure a systemd service on each node and register node credentials in EcliPanel admin.

## 8) Dockerized Mailcow integration (recommended)

Mailcow is used for mailbox automation/features in EcliPanel.

### Deploy Mailcow

```bash
cd /opt
git clone https://github.com/mailcow/mailcow-dockerized
cd mailcow-dockerized
./generate_config.sh

docker compose pull
docker compose up -d
```

### Create Mailcow API key

In Mailcow UI, create an API key with mailbox/domain management access.

### Wire Mailcow to EcliPanel

Set in `/opt/EcliPanel/backend/.env`:

- `MAILCOW_API_URL=https://mail.example.com`
- `MAILCOW_API_KEY=<mailcow-api-key>`
- `MAILBOX_DOMAIN=example.com`
- `MAIL_DOMAIN=example.com`
- `MAILBOX_INBOUND_SECRET=<long-random-secret>`
- `MAILBOX_SMTP_HOST=mail.example.com`
- `MAILBOX_SMTP_PORT=587`
- `MAILBOX_IMAP_HOST=mail.example.com`
- `MAILBOX_IMAP_PORT=993`

If using Dovecot master auth for sync/fetch:
- `DOVECOT_MASTER_USER`, `DOVECOT_MASTER_PASS`, `DOVECOT_MASTER_DOMAIN`

## 9) EcliHalo reverse proxy (recommended)

EcliHalo can terminate TLS and route panel/backend traffic.

```bash
cd /opt/EcliPanel/halo
cargo build --release
sudo cp target/release/eclihalo /usr/local/bin/
sudo mkdir -p /etc/eclihalo
sudo cp config.example.yml /etc/eclihalo/config.yml
```

Generate service unit:

```bash
sudo sh -c 'eclihalo systemd > /etc/systemd/system/eclihalo.service'
sudo systemctl daemon-reload
sudo systemctl enable --now eclihalo
```

Update `/etc/eclihalo/config.yml` routes for your domains and upstreams (frontend/backend hosts + ports), then reload:

```bash
sudo systemctl reload eclihalo
```

## 10) EcliTunnel setup (optional public tunneling)

### Tunnel server agent (public ingress host)

```bash
curl -fsSL https://backend.example.com/api/tunnel/deploy.sh | bash -s -- server-service --token <server-device-token> --backend https://backend.example.com --domain tunnel.example.com
```

Open firewall range for tunnel ports (default):
- `20000-29999/tcp`

### Tunnel client usage

```bash
curl -fsSL https://backend.example.com/api/tunnel/deploy.sh | bash -s -- enroll --backend https://backend.example.com
curl -fsSL https://backend.example.com/api/tunnel/deploy.sh | bash -s -- run --port 8080 --backend https://backend.example.com
```

## 11) Systemd for panel services

This repo includes baseline units in `/systemd`:
- `eclipanel-backend.service`
- `eclipanel-frontend.service`

Copy, adjust `WorkingDirectory`, user, and startup commands to your environment before enabling.

## 12) Validation checklist

After setup, verify:

- Frontend loads at `https://panel.example.com`
- Backend health endpoint returns OK: `https://backend.example.com/health`
- OpenAPI is reachable: `https://backend.example.com/openapi`
- Backend can connect to DB + Redis (no boot errors)
- At least one Wings node is online in admin
- Mailcow API actions succeed (if enabled)
- Tunnel server is connected (if enabled)

## 13) Troubleshooting

- **Auth sessions invalid after restart**: ensure stable `PQ_JWT_SEED` and `JWT_SECRET` in backend `.env`.
- **CORS/login issues**: validate `FRONTEND_URL`, `PANEL_URL`, `BACKEND_URL`, `ORIGIN`, `RP_ID`.
- **Mail features not working**: verify `MAILCOW_API_URL` + API key permissions.
- **Wings actions failing**: confirm you are using wings-rs and correct node URL/cert settings.
- **Tunnel allocation failures**: set `TUNNEL_PUBLIC_HOST`, open tunnel port range, and confirm server agent is connected.

---

If you want to contribute or evaluate the UI/features before deployment, check the showcase: [SHOWCASE.md](/SHOWCASE.md).
