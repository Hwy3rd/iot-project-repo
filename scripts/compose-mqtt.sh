#!/usr/bin/env bash
# Shared by init.sh/run.sh. Select local, cloud (EMQX), or tunnel (Mosquitto/WS).
COMPOSE_ARGS=(--project-directory "$ROOT_DIR" -f "$COMPOSE_FILE")
case "${MQTT_MODE:-local}" in
  local) ;;
  cloud)
    [[ -f "$ROOT_DIR/.env.cloud-mqtt" ]] || {
      printf '%s\n' 'Missing .env.cloud-mqtt; copy .env.cloud-mqtt.example first.' >&2
      exit 1
    }
    COMPOSE_ARGS=(
      --project-directory "$ROOT_DIR"
      --env-file "$ROOT_DIR/.env"
      --env-file "$ROOT_DIR/.env.cloud-mqtt"
      -f "$COMPOSE_FILE"
      -f "$ROOT_DIR/docker-compose.cloud-mqtt.yml"
    )
    ;;
  tunnel)
    [[ -f "$ROOT_DIR/.env.tunnel-mqtt" ]] || {
      printf '%s\n' 'Missing .env.tunnel-mqtt; copy .env.tunnel-mqtt.example first.' >&2
      exit 1
    }
    COMPOSE_ARGS=(
      --project-directory "$ROOT_DIR"
      --env-file "$ROOT_DIR/.env"
      --env-file "$ROOT_DIR/.env.tunnel-mqtt"
      -f "$COMPOSE_FILE"
      -f "$ROOT_DIR/docker-compose.tunnel-mqtt.yml"
    )
    ;;
  *)
    printf '%s\n' 'MQTT_MODE must be local, cloud or tunnel.' >&2
    exit 1
    ;;
esac

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}
