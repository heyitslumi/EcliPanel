#!/usr/bin/env bash
# build frontend
set -euo pipefail

export NODE_ENV=production

export PUBLIC_COMMIT_SHA="${NEXT_PUBLIC_COMMIT_SHA:-${PUBLIC_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo 'unknown')}}"
export PUBLIC_REPO_URL="${NEXT_PUBLIC_REPO_URL:-${PUBLIC_REPO_URL:-$(git remote get-url origin 2>/dev/null || echo '')}}"
export PUBLIC_API_BASE="${NEXT_PUBLIC_API_BASE:-${PUBLIC_API_BASE:-}}"
export PUBLIC_WINGS_BASE="${NEXT_PUBLIC_WINGS_BASE:-${PUBLIC_WINGS_BASE:-}}"
export PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-${PUBLIC_SITE_URL:-}}"
export NEXT_PUBLIC_COMMIT_SHA="${PUBLIC_COMMIT_SHA}"
export NEXT_PUBLIC_REPO_URL="${PUBLIC_REPO_URL}"
export NEXT_PUBLIC_API_BASE="${PUBLIC_API_BASE}"
export NEXT_PUBLIC_WINGS_BASE="${PUBLIC_WINGS_BASE}"
export NEXT_PUBLIC_SITE_URL="${PUBLIC_SITE_URL}"

bun install
bun run build