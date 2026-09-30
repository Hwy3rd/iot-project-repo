#!/bin/sh
# Builds the broker's password file and ACL from env on every start, then
# hands off to the image's own entrypoint. Generated at runtime (inside the
# container, never on the host or in git) so the only place credentials live
# is the .env file compose reads.
#
# Two accounts:
#   - MQTT_USERNAME: the backend (libs/mqtt/mqtt.module.ts). Reads telemetry
#     and $SYS (the compose healthcheck logs in as it). Add a write rule here
#     once CommandsService starts publishing commands to devices.
#   - MQTT_DEVICE_USERNAME: shared by every device (ESP32 firmware). May only
#     publish telemetry, so a leaked device credential can't read other
#     devices' data or impersonate the server.
set -eu

: "${MQTT_USERNAME:?MQTT_USERNAME is required}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required}"
: "${MQTT_DEVICE_USERNAME:?MQTT_DEVICE_USERNAME is required}"
: "${MQTT_DEVICE_PASSWORD:?MQTT_DEVICE_PASSWORD is required}"

AUTH_DIR=/mosquitto/auth
mkdir -p "$AUTH_DIR"

# -c recreates the file, so removed/renamed accounts don't linger.
mosquitto_passwd -c -b "$AUTH_DIR/passwd" "$MQTT_USERNAME" "$MQTT_PASSWORD"
mosquitto_passwd -b "$AUTH_DIR/passwd" "$MQTT_DEVICE_USERNAME" "$MQTT_DEVICE_PASSWORD"

cat > "$AUTH_DIR/acl" <<EOF
user $MQTT_USERNAME
topic read devices/+/telemetry
topic read \$SYS/#

user $MQTT_DEVICE_USERNAME
topic write devices/+/telemetry
EOF

# Mosquitto 2 warns (and future versions refuse) when these files are
# readable by anyone but the broker's own user.
chown -R mosquitto:mosquitto "$AUTH_DIR"
chmod 700 "$AUTH_DIR"
chmod 600 "$AUTH_DIR/passwd" "$AUTH_DIR/acl"

exec /docker-entrypoint.sh "$@"
