#!/usr/bin/env bash
# Shared by init.sh/run.sh. Select local, cloud (EMQX), or tunnel (Mosquitto/WS).
# Every mode reads the single root .env: each overlay maps its own
# MQTT_CLOUD_* / MQTT_TUNNEL_* variables onto what the containers expect, so
# switching modes only changes MQTT_MODE, never the .env file.
# MQTT_MODE comes from the shell, else from MQTT_MODE= in .env, else local.
if [[ -z "${MQTT_MODE:-}" && -f "$ROOT_DIR/.env" ]]; then
  MQTT_MODE="$(sed -n 's/^MQTT_MODE=//p' "$ROOT_DIR/.env" | tail -n 1 | tr -d "\r\"' ")"
fi
COMPOSE_ARGS=(--project-directory "$ROOT_DIR" -f "$COMPOSE_FILE")
case "${MQTT_MODE:-local}" in
  local) ;;
  cloud)
    COMPOSE_ARGS+=(-f "$ROOT_DIR/docker-compose.cloud-mqtt.yml")
    ;;
  tunnel)
    COMPOSE_ARGS+=(-f "$ROOT_DIR/docker-compose.tunnel-mqtt.yml")
    ;;
  *)
    printf '%s\n' 'MQTT_MODE must be local, cloud or tunnel.' >&2
    exit 1
    ;;
esac

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}
