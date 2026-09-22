#!/usr/bin/env bash
#
# init.sh — one command to bootstrap the environment using
# docker-compose.production.yml: build + start datastores, run DB
# migrations (as part of the app container's own startup command), seed the
# admin account, then start app/worker. No host Node/pnpm install required —
# everything runs inside containers.
#
# Usage:
#   ./init.sh
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
COMPOSE_FILE="$ROOT_DIR/docker-compose.production.yml"

log()  { printf '\033[1;34m[init]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$1" >&2; exit 1; }

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed."
}

banner() {
  printf '\033[1;36m%s\033[0m\n' "══════════════════════════════════════════════════════"
  printf '\033[1;36m%s\033[0m\n' "  IoT Cold Storage Management System"
  printf '\033[1;36m%s\033[0m\n' "  init.sh — khởi tạo hệ thống lần đầu"
  printf '\033[1;36m%s\033[0m\n\n' "══════════════════════════════════════════════════════"
}

banner
log "checking prerequisites"
require_cmd docker
docker compose version >/dev/null 2>&1 || die "'docker compose' (v2) is required."

if [[ ! -f "$SERVER_DIR/.env.production" ]]; then
  die "server/.env.production not found. Create it from server/.env.production.example first."
fi
ok "prerequisites present"

# `up` blocks until every service's depends_on condition is satisfied, so by
# the time this returns: mysql/redis/mongo/minio are healthy, `app` has run
# its migration:run step and passed its healthcheck (see the `app` service's
# comment in docker-compose.production.yml), and only then has `worker`
# started too.
log "building and starting stack (datastores -> app [migrate + serve] -> worker)"
compose up -d --build

log "seeding admin account"
compose run --rm app node dist/seeds/account.seed.js
ok "seed complete"

echo
ok "system initialized — app on http://localhost:8080"
