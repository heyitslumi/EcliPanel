import { Md } from "../_components/md";

const content = `
# Environment Variables (.env)

This reference documents the backend and frontend environment variables used by EcliPanel.

## Backend: required core

- \`DB_TYPE\`, \`DB_HOST\`, \`DB_PORT\`, \`DB_USER\`, \`DB_PASS\`, \`DB_NAME\`
- \`REDIS_URL\`
- \`PORT\`
- \`JWT_SECRET\`, \`PQ_JWT_SEED\`
- \`NODE_ENCRYPTION_KEY\`, \`NODE_PQ_ENCRYPTION_SEED\`
- \`FRONTEND_URL\`, \`PANEL_URL\`, \`BACKEND_URL\`

## Backend: auth and WebAuthn

- \`ORIGIN\` — passkey/WebAuthn origin
- \`RP_ID\` — passkey/WebAuthn relying party id
- \`JWT_COOKIE_NAME\`, \`JWT_COOKIE_DOMAIN\`, \`JWT_COOKIE_SECURE\`, \`JWT_COOKIE_MAX_AGE\`

## Backend: mail and mailbox

- \`SMTP_HOST\`, \`SMTP_PORT\`, \`SMTP_USER\`, \`SMTP_PASS\`, \`SMTP_SECURE\`, \`SMTP_FROM\`
- \`MAILBOX_DOMAIN\`, \`MAIL_DOMAIN\`, \`MAILBOX_INBOUND_SECRET\`
- \`MAILCOW_API_URL\`, \`MAILCOW_API_KEY\`, \`MAILCOW_API_SECRET\`

## Backend: provider integration

- \`CLOUDFLARE_API_TOKEN\`, \`CLOUDFLARE_ACCOUNT_ID\`, \`CLOUDFLARE_BASE_ZONE\`, \`CLOUDFLARE_CREATE_SUBZONE\`
- \`PDNS_BASE_URL\`, \`PDNS_API_KEY\`
- \`WINGS_ALLOW_INVALID_CERT\`

## Backend: SOC and abuse

- \`ANTIABUSE_AI_ENABLED\`, \`ABUSE_REPORT_EMAIL\`
- \`SOC_ABUSEIPDB_API_KEY\`, \`SOC_ALERT_EMAIL\`, \`SOC_ALERT_WEBHOOK_URL\`, \`SOC_ALERT_EMAIL_SEVERITIES\`

## Frontend: commonly used

- \`BACKEND_URL\`
- \`NEXT_PUBLIC_API_BASE\`
- \`NEXT_PUBLIC_WINGS_BASE\`
- \`NEXT_PUBLIC_SITE_URL\`
- \`NEXT_PUBLIC_COMMIT_SHA\`, \`NEXT_PUBLIC_REPO_URL\`
- \`NEXT_PUBLIC_HACKCLUB_STUDENT_ENABLED\`, \`NEXT_PUBLIC_GITHUB_STUDENT_ENABLED\`

## Notes

- Keep \`PQ_JWT_SEED\` and \`JWT_SECRET\` stable to avoid breaking active sessions.
- Keep \`NODE_ENCRYPTION_KEY\` and \`NODE_PQ_ENCRYPTION_SEED\` stable across restarts.
- Use secret managers or environment injection for production secrets.
`;

export default function Page() {
  return <Md>{content}</Md>;
}
