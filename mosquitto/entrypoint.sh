#!/bin/sh
# Builds the broker's password file and ACL from env on every start, then
# hands off to the image's own entrypoint. Generated at runtime (inside the
# container, never on the host or in git) so the only place credentials live
# is the .env file compose reads.
#
# Two accounts:
#   - MQTT_USERNAME: the backend (libs/mqtt/mqtt.module.ts). Reads telemetry,
#     command acks and $SYS (the compose healthcheck logs in as it); writes
#     commands and each device's room config (retained).
#   - MQTT_DEVICE_USERNAME: shared by every device (ESP32 firmware). Publishes
#     telemetry; reads commands and its room config, and writes acks, only on
#     its own topics, so a leaked device credential can't read other devices'
#     commands or impersonate the server.
set -eu

: "${MQTT_USERNAME:?MQTT_USERNAME is required}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required}"
: "${MQTT_DEVICE_USERNAME:?MQTT_DEVICE_USERNAME is required}"
: "${MQTT_DEVICE_PASSWORD:?MQTT_DEVICE_PASSWORD is required}"

AUTH_DIR=/mosquitto/auth
mkdir -p "$AUTH_DIR"

# Start from an empty file, so removed/renamed accounts don't linger. The rm
# matters on `docker restart`: the container keeps its old passwd, and
# mosquitto_passwd 2.1 refuses `-c` on an existing file — the broker would
# then crash-loop.
rm -f "$AUTH_DIR/passwd"
mosquitto_passwd -c -b "$AUTH_DIR/passwd" "$MQTT_USERNAME" "$MQTT_PASSWORD"
mosquitto_passwd -b "$AUTH_DIR/passwd" "$MQTT_DEVICE_USERNAME" "$MQTT_DEVICE_PASSWORD"

# `pattern` rules apply to every client, with %c = its client id — the
# firmware connects with client id = its unique_id, so a board can only read
# its own commands and config and ack on its own topic. (The server's random
# client id matches no device, so these grant it nothing.)
cat > "$AUTH_DIR/acl" <<EOF
user $MQTT_USERNAME
topic read devices/+/telemetry
topic read devices/+/ack
topic write devices/+/commands
topic write devices/+/config
topic read \$SYS/#

user $MQTT_DEVICE_USERNAME
topic write devices/+/telemetry

pattern read devices/%c/commands
pattern read devices/%c/config
pattern write devices/%c/ack
EOF

# Mosquitto 2 warns (and future versions refuse) when these files are
# readable by anyone but the broker's own user.
chown -R mosquitto:mosquitto "$AUTH_DIR"
chmod 700 "$AUTH_DIR"
chmod 600 "$AUTH_DIR/passwd" "$AUTH_DIR/acl"

exec /docker-entrypoint.sh "$@"
