#!/usr/bin/env bash
# Shared by init.sh/run.sh. Cloud selection is explicit: MQTT_MODE=cloud.
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
  *)
    printf '%s\n' 'MQTT_MODE must be local or cloud.' >&2
    exit 1
    ;;
esac

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}
