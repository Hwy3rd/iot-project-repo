#!/usr/bin/env bash
#
# run.sh — stop/start the stack that init.sh already set up, without
# re-running seed (images are only rebuilt by `rebuild`). `start` still re-runs `app`'s
# migration:run step as part of its own startup command (harmless — no-ops
# when nothing is pending) before `app` is considered healthy and `worker`
# is allowed to start.
#
# Usage:
#   ./run.sh start            resume all stopped containers
#   ./run.sh stop             stop all containers (keeps data/volumes)
#   ./run.sh restart [svc]    restart everything, or just one service
#   ./run.sh status           show container status
#   ./run.sh logs [svc]       follow logs (all services, or just one)
#   ./run.sh down             remove containers (keeps volumes/data)
#   ./run.sh rebuild [svc]    rebuild the backend image from ./server and
#                             replace app + worker (or just app / worker)
#
# Services: app, worker, redis, mysql, mongo, minio, mosquitto, cloudflared
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.production.yml"
SERVICES=(app worker redis mysql mongo minio mosquitto cloudflared)
# Services built from ./server (same image, different command).
BACKEND_SERVICES=(app worker)
REBUILD_WAIT_SECONDS=300

log()  { printf '\033[1;34m[run]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[ ok ]\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$1" >&2; exit 1; }

banner() {
  printf '\033[1;36m%s\033[0m\n' "══════════════════════════════════════════════════════"
  printf '\033[1;36m%s\033[0m\n' "  IoT Cold Storage Management System"
  printf '\033[1;36m%s\033[0m\n' "  run.sh — điều khiển hệ thống đã khởi tạo"
  printf '\033[1;36m%s\033[0m\n\n' "══════════════════════════════════════════════════════"
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

require_stack_exists() {
  local existing
  existing="$(compose ps -a --services 2>/dev/null || true)"
  [[ -n "$existing" ]] || die "no containers found for this stack — run ./init.sh first."
}

banner
cmd="${1:-}"
shift || true

case "$cmd" in
  start)
    existing="$(compose ps -a --services 2>/dev/null || true)"
    if [[ -z "$existing" ]]; then
      log "no containers found (likely after 'docker compose down') — recreating from existing volumes"
      compose up -d "${SERVICES[@]}"
    else
      log "starting containers: ${SERVICES[*]}"
      compose start "${SERVICES[@]}"
    fi
    ok "stack is up"
    compose ps
    ;;

  stop)
    require_stack_exists
    log "stopping containers (data/volumes untouched)"
    compose stop
    ok "stack is stopped"
    ;;

  restart)
    require_stack_exists
    if [[ $# -gt 0 ]]; then
      log "restarting: $*"
      compose restart "$@"
    else
      log "restarting all services"
      compose restart
    fi
    ok "restart complete"
    ;;

  status)
    compose ps -a
    ;;

  logs)
    compose logs -f --tail=200 "$@"
    ;;

  down)
    require_stack_exists
    log "removing containers (volumes/data are kept)"
    compose down
    ok "containers removed — volumes preserved. Run ./init.sh to recreate them."
    ;;

  rebuild)
    require_stack_exists
    targets=("$@")
    [[ ${#targets[@]} -gt 0 ]] || targets=("${BACKEND_SERVICES[@]}")
    for svc in "${targets[@]}"; do
      [[ " ${BACKEND_SERVICES[*]} " == *" $svc "* ]] \
        || die "'$svc' is not built from ./server — rebuild only takes: ${BACKEND_SERVICES[*]}"
    done
    log "building backend image and replacing: ${targets[*]}"
    # --no-deps: only the backend containers are recreated. Without it,
    # compose would also recreate any dependency whose definition changed
    # (e.g. a new datastore image) — that must stay a deliberate step.
    # --wait: returns once the new containers are healthy (app runs its
    # migrations first), and fails if they don't get there in time.
    compose up -d --build --no-deps --wait --wait-timeout "$REBUILD_WAIT_SECONDS" "${targets[@]}" \
      || die "rebuilt containers did not become healthy — check: ./run.sh logs ${targets[0]}"
    ok "backend rebuilt and running"
    compose ps "${targets[@]}"
    ;;

  -h|--help|"")
    usage
    ;;

  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
