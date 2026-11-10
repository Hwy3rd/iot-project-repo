#!/bin/sh
# Provision exact per-account topics before starting the private TCP/WS broker.
# Device accounts: one deviceId|username|password per line in the private
# file tunnel-auth/devices.txt (the only place they are configured). It may
# be missing or empty when every board uses an account issued from the web
# UI (Dynamic Security, see mosquitto/dynsec.sh).
set -eu

fail() { printf '%s\n' "Tunnel MQTT: $1" >&2; exit 1; }
identifier() {
  case "$2" in
    ''|*[!a-zA-Z0-9_.-]*) fail "$1 must contain only letters, digits, dot, underscore or hyphen" ;;
  esac
}
password() {
  [ -n "$2" ] || fail "$1 must not be empty"
  case "$2" in '<'*) fail "$1 still contains a placeholder" ;; esac
  [ "$(printf '%s' "$2" | wc -l)" -eq 0 ] || fail "$1 must not contain a newline"
  cr=$(printf '\r')
  case "$2" in *"$cr"*) fail "$1 must not contain a carriage return" ;; esac
}

identifier MQTT_USERNAME "${MQTT_USERNAME:-}"
password MQTT_PASSWORD "${MQTT_PASSWORD:-}"

AUTH_DIR=/mosquitto/auth-tunnel
mkdir -p "$AUTH_DIR"
umask 077
work=$(mktemp -d "$AUTH_DIR/.provision.XXXXXX")
cleanup() { rm -f "$work/passwd" "$work/acl"; rmdir "$work"; }
trap cleanup EXIT

mosquitto_passwd -c -b "$work/passwd" "$MQTT_USERNAME" "$MQTT_PASSWORD"
cat > "$work/acl" <<EOF
user $MQTT_USERNAME
topic read devices/+/telemetry
topic read devices/+/ack
topic write devices/+/commands
topic write devices/+/config
topic write devices/+/telemetry-ack
topic read \$SYS/#
topic write \$CONTROL/dynamic-security/v1
topic read \$CONTROL/dynamic-security/v1/response
EOF

seen_users="|$MQTT_USERNAME|"
seen_ids='|'
add_device() {
  device_id=$1
  device_user=$2
  device_password=$3
  identifier deviceId "$device_id"
  identifier deviceUsername "$device_user"
  password devicePassword "$device_password"
  case "$seen_users" in *"|$device_user|"*) fail "duplicate MQTT username in provisioning" ;; esac
  case "$seen_ids" in *"|$device_id|"*) fail "duplicate device ID in provisioning" ;; esac
  seen_users="$seen_users$device_user|"
  seen_ids="$seen_ids$device_id|"
  mosquitto_passwd -b "$work/passwd" "$device_user" "$device_password"
  cat >> "$work/acl" <<EOF

user $device_user
topic write devices/$device_id/telemetry
topic write devices/$device_id/ack
topic read devices/$device_id/commands
topic read devices/$device_id/config
topic read devices/$device_id/telemetry-ack
EOF
}

accounts=/mosquitto/tunnel-auth/devices.txt
if [ -f "$accounts" ]; then
  # IFS is only '|'; spaces and further '|' characters stay in the password.
  # Read before any credential expansion, and never print credentials.
  while IFS='|' read -r device_id device_user device_password || [ -n "$device_id$device_user$device_password" ]; do
    case "$device_id" in ''|'#'*) continue ;; esac
    add_device "$device_id" "$device_user" "$device_password"
  done < "$accounts"
fi
[ "$seen_ids" != '|' ] || printf '%s\n' "Tunnel MQTT: no accounts in tunnel-auth/devices.txt; only web-issued device accounts can connect" >&2

mv -f "$work/passwd" "$AUTH_DIR/passwd"
mv -f "$work/acl" "$AUTH_DIR/acl"
chown -R mosquitto:mosquitto "$AUTH_DIR"
chmod 700 "$AUTH_DIR"
chmod 600 "$AUTH_DIR/passwd" "$AUTH_DIR/acl"
cleanup
trap - EXIT
# Web-issued device accounts (Dynamic Security): the store, plus its
# read-only copy on the host kept up to date in the background.
. /mosquitto-dynsec.sh
dynsec_init
dynsec_watch

exec /docker-entrypoint.sh "$@"
