import { Md } from "../_components/md";

const content = `
# Self-host EcliPanel

This guide covers a full deployment on a brand new Linux server, including backend, frontend, database, Redis, Wings nodes, and optional EcliHalo, Mailcow, and EcliTunnel.

## 1) Target architecture (recommended)

- \`panel.example.com\` → frontend app
- \`backend.example.com\` → backend API
- \`tunnel.example.com\` → tunnel ingress (optional)
- One or more separate Wings nodes for game server workloads

## 2) Prerequisites

- Ubuntu 24.04 LTS (or Debian 12+) with sudo user
- DNS records for panel/backend (and tunnel if used)
- Open ports: 80/443 for panel/backend, plus tunnel range if enabled
- MariaDB/MySQL/PostgreSQL (MariaDB recommended)
- Redis
- Bun runtime
- Git, curl, unzip, ffmpeg, espeak
- Docker + Docker Compose (if using Mailcow)
- Rust + Cargo (if building EcliHalo)

Example base install:

\`\`\`bash
sudo apt update
sudo apt install -y curl git unzip ca-certificates ffmpeg espeak redis-server mariadb-server
curl -fsSL https://bun.sh/install | bash
\`\`\`

> If DB/Redis are on external hosts, skip local packages and point environment variables to those hosts.

## 3) Clone and bootstrap

\`\`\`bash
cd /opt
git clone https://github.com/heyitslumi/EcliPanel.git
cd /opt/EcliPanel
\`\`\`

### Backend bootstrap

\`\`\`bash
cd /opt/EcliPanel/backend
bun install
cp .env.example .env
bun run gen:jwt-secret
bun run gen:pq-jwt-seed
bun run gen:default-role
\`\`\`

\`\`\`bash
# generate NODE_PQ_ENCRYPTION_SEED
bun -e "console.log((await import('crypto')).randomBytes(64).toString('base64'))"
\`\`\`

### Frontend bootstrap

\`\`\`bash
cd /opt/EcliPanel/frontend
bun install
cp .env.example .env
\`\`\`

## 4) Configure backend (\`/opt/EcliPanel/backend/.env\`)

Required minimum:

- Database: \`DB_TYPE\`, \`DB_HOST\`, \`DB_PORT\`, \`DB_USER\`, \`DB_PASS\`, \`DB_NAME\`
- Redis: \`REDIS_URL\`
- Auth/encryption: \`JWT_SECRET\`, \`PQ_JWT_SEED\`, \`NODE_ENCRYPTION_KEY\`, \`NODE_PQ_ENCRYPTION_SEED\`
- URL/origin: \`FRONTEND_URL\`, \`PANEL_URL\`, \`BACKEND_URL\`, \`ORIGIN\`, \`RP_ID\`
- SMTP: \`SMTP_HOST\`, \`SMTP_PORT\`, \`SMTP_USER\`, \`SMTP_PASS\`, \`SMTP_FROM\` (and optionally \`MAIL_FROM\`)

Recommended for tunnels:

- \`TUNNEL_PUBLIC_HOST=tunnel.example.com\`
- \`TUNNEL_PORT_RANGE=20000-29999\`

## 5) Configure frontend (\`/opt/EcliPanel/frontend/.env\`)

- \`BACKEND_URL=https://backend.example.com\`
- \`NEXT_PUBLIC_API_BASE=https://backend.example.com\`
- \`NEXT_PUBLIC_WINGS_BASE=\` (optional)

## 6) Start panel services

### Development

\`\`\`bash
# backend
cd /opt/EcliPanel/backend
bun run dev

# frontend
cd /opt/EcliPanel/frontend
./dev.sh --port 3000
\`\`\`

### Production

\`\`\`bash
# backend
cd /opt/EcliPanel/backend
./start.sh

# frontend
cd /opt/EcliPanel/frontend
bun run build
./start.sh
\`\`\`

## 7) Configure and deploy Wings (required)

EcliPanel requires **wings-rs** (not wings-go).

Build from this repo:

\`\`\`bash
cd /opt/EcliPanel/wings
./manage.sh patch
./manage.sh build
\`\`\`

Deploy to each node:

\`\`\`bash
curl -fsSL https://backend.example.com/api/wings/download -o /usr/local/bin/wings
chmod +x /usr/local/bin/wings
\`\`\`

Then configure each node service and register node credentials in panel admin.

## 8) Optional: Mailcow (mail subsystem)

\`\`\`bash
cd /opt
git clone https://github.com/mailcow/mailcow-dockerized
cd mailcow-dockerized
./generate_config.sh
docker compose pull
docker compose up -d
\`\`\`

Then set Mailcow-related backend envs:

- \`MAILCOW_API_URL\`
- \`MAILCOW_API_KEY\`
- \`MAILBOX_DOMAIN\`
- \`MAIL_DOMAIN\`
- \`MAILBOX_INBOUND_SECRET\`
- \`MAILBOX_SMTP_HOST\`, \`MAILBOX_SMTP_PORT\`
- \`MAILBOX_IMAP_HOST\`, \`MAILBOX_IMAP_PORT\`

## 9) Optional: EcliHalo reverse proxy

\`\`\`bash
cd /opt/EcliPanel/halo
cargo build --release
sudo cp target/release/eclihalo /usr/local/bin/
sudo mkdir -p /etc/eclihalo
sudo cp config.example.yml /etc/eclihalo/config.yml
sudo sh -c 'eclihalo systemd > /etc/systemd/system/eclihalo.service'
sudo systemctl daemon-reload
sudo systemctl enable --now eclihalo
\`\`\`

Set your panel/backend upstream routes in \`/etc/eclihalo/config.yml\`, then reload service.

## 10) Optional: EcliTunnel

Deploy tunnel server agent:

\`\`\`bash
curl -fsSL https://backend.example.com/api/tunnel/deploy.sh | bash -s -- server-service --token <server-device-token> --backend https://backend.example.com --domain tunnel.example.com
\`\`\`

Open firewall range:

- \`20000-29999/tcp\`

Client examples:

\`\`\`bash
curl -fsSL https://backend.example.com/api/tunnel/deploy.sh | bash -s -- enroll --backend https://backend.example.com
curl -fsSL https://backend.example.com/api/tunnel/deploy.sh | bash -s -- run --port 8080 --backend https://backend.example.com
\`\`\`

## 11) Systemd units for panel

Use baseline unit files in \`/systemd\`:

- \`eclipanel-backend.service\`
- \`eclipanel-frontend.service\`

Copy them, adjust user/paths/commands, then enable with \`systemctl\`.

## 12) Validation checklist

- Backend health endpoint works: \`/health\`
- OpenAPI loads: \`/openapi\`
- DB + Redis connections succeed at boot
- Frontend loads on your panel domain
- At least one Wings node appears online in admin
- Mail features work (if Mailcow enabled)
- Tunnel server connected (if Tunnel enabled)

## 13) Troubleshooting

- Sessions invalid after restart: make sure \`JWT_SECRET\` and \`PQ_JWT_SEED\` are stable and not regenerated.
- CORS/login issues: re-check \`FRONTEND_URL\`, \`PANEL_URL\`, \`BACKEND_URL\`, \`ORIGIN\`, \`RP_ID\`.
- Wings actions fail: confirm node is using wings-rs and reachable from backend.
- Mail errors: validate Mailcow API key scopes and host URLs.
- Tunnel allocations fail: verify open port range + tunnel server connectivity.

## Related guides

- [Wings guide](/docs/wings)
- [EcliHalo guide](/docs/eclihalo)
- [Environment reference](/docs/environment)
- [Support & policies](/docs/support)
`;

export default function Page() {
  return <Md>{content}</Md>;
}
