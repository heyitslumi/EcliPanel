import { Md } from "../_components/md";

const content = `
# Wings Guide

EcliPanel uses patched **wings-rs** (not legacy wings-go).

## Directory model

| Path | Purpose |
|---|---|
| \`wings/source\` | Clean upstream source |
| \`wings/patched\` | Where you edit Wings code |
| \`wings/patches\` | Generated patch files |
| \`wings/output\` | Patched build workspace |

## Patch and build flow

\`\`\`bash
cd /opt/EcliPanel/wings
./manage.sh regen
./manage.sh patch
./manage.sh build
\`\`\`

## Deploy binary

\`\`\`bash
curl -fsSL https://backend.example.com/api/wings/download -o /usr/local/bin/wings
chmod +x /usr/local/bin/wings
systemctl restart wings
\`\`\`

## Security endpoints in patched Wings

- \`/api/servers/:id/security/processes\`
- \`/api/servers/:id/security/connections\`
- \`/api/servers/:id/security/scan-files\`

## Related guides

- [Self-host EcliPanel](/docs/eclipanel)
- [Environment reference](/docs/environment)
`;

export default function Page() {
  return <Md>{content}</Md>;
}
