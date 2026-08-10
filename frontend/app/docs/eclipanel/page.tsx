import { Md } from "../_components/md";

const content = `
# Self-host EcliPanel

This guide covers a production-oriented deployment of EcliPanel with backend, frontend, database, Redis, and Wings.

## 1) Requirements

- MariaDB/MySQL/PostgreSQL (MariaDB recommended)
- Redis
- Bun runtime
- At least one Wings node

## 2) Clone and bootstrap

\`\`\`bash
cd /opt
git clone https://github.com/heyitslumi/EcliPanel.git
cd /opt/EcliPanel/backend
bun install
cp .env.example .env
bun run gen:jwt-secret
bun run gen:pq-jwt-seed
bun run gen:default-role

cd /opt/EcliPanel/frontend
bun install
cp .env.example .env
\`\`\`

## 3) Minimum backend configuration

Set these in \`backend/.env\`:

- Database: \`DB_TYPE\`, \`DB_HOST\`, \`DB_PORT\`, \`DB_USER\`, \`DB_PASS\`, \`DB_NAME\`
- Cache: \`REDIS_URL\`
- Auth/encryption: \`JWT_SECRET\`, \`PQ_JWT_SEED\`, \`NODE_ENCRYPTION_KEY\`, \`NODE_PQ_ENCRYPTION_SEED\`
- URL/origin: \`FRONTEND_URL\`, \`PANEL_URL\`, \`BACKEND_URL\`, \`ORIGIN\`, \`RP_ID\`
- SMTP: \`SMTP_HOST\`, \`SMTP_PORT\`, \`SMTP_USER\`, \`SMTP_PASS\`, \`SMTP_FROM\`

## 4) Minimum frontend configuration

Set these in \`frontend/.env\`:

- \`BACKEND_URL\`
- \`NEXT_PUBLIC_API_BASE\`
- \`NEXT_PUBLIC_WINGS_BASE\` (optional)

## 5) Start services

\`\`\`bash
# backend
cd /opt/EcliPanel/backend
bun run dev

# frontend
cd /opt/EcliPanel/frontend
./dev.sh --port 3000
\`\`\`

## 6) Validate deployment

- Backend health endpoint works: \`/health\`
- OpenAPI loads
- DB + Redis connections succeed at boot
- At least one Wings node appears online

## Related guides

- [Wings guide](/docs/wings)
- [Environment reference](/docs/environment)
`;

export default function Page() {
  return <Md>{content}</Md>;
}
