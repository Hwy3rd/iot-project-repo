#!/bin/sh
# Shared by entrypoint.sh and tunnel-entrypoint.sh (sourced, as root, before
# the broker starts): the Dynamic Security plugin's store and its read-only
# copy on the host.
#
# The store lives in the data volume and only the broker writes it (on every
# account change from the web UI, DeviceMqttAccountService). A copy without
# password hashes is kept in /mosquitto/dynsec-view, a host bind mount
# (mosquitto/tunnel-auth/dynsec-view/accounts.json), so the accounts can be
# read without sudo or docker exec. Editing that copy changes nothing: the
# broker never reads it and the next export overwrites it.

DYNSEC=/mosquitto/data/dynamic-security.json
DYNSEC_VIEW=/mosquitto/dynsec-view/accounts.json

# Created once, then owned by the broker. Everything is denied by default — a
# device account gets only its own topics; the env/devices.txt accounts of
# the password file are unaffected. No dynsec admin: the backend account is
# allowed $CONTROL by the ACL file instead.
dynsec_init() {
  mkdir -p "$(dirname "$DYNSEC")"
  if [ ! -f "$DYNSEC" ]; then
    printf '%s\n' '{"defaultACLAccess":{"publishClientSend":false,"publishClientReceive":false,"subscribe":false,"unsubscribe":true},"clients":[],"groups":[],"roles":[]}' > "$DYNSEC"
  fi
  chown mosquitto:mosquitto "$DYNSEC"
  chmod 600 "$DYNSEC"
}

# The plugin writes one key per line, so dropping the hash lines (and the
# comma they leave dangling when last in an object) keeps valid JSON.
dynsec_export() {
  dir=$(dirname "$DYNSEC_VIEW")
  mkdir -p "$dir" || return 1
  tmp="$dir/.accounts.json.tmp"
  awk '
    /^[[:space:]]*"(encoded_password|password|salt|iterations)":/ {
      if ($0 !~ /,[[:space:]]*$/) sub(/,[[:space:]]*$/, "", prev)
      next
    }
    {
      if (kept++) {
        print prev
        if (!noted && prev == "{") {
          print "\t\"_readonly\":\t\"Exported by mosquitto/dynsec.sh from the broker store; edits here are ignored and overwritten. Password hashes removed.\","
          noted = 1
        }
      }
      prev = $0
    }
    END { if (kept) print prev }
  ' "$DYNSEC" > "$tmp" || { rm -f "$tmp"; return 1; }
  chmod 644 "$tmp"
  mv -f "$tmp" "$dir/$(basename "$DYNSEC_VIEW")"
}

# Polls the store's inode/mtime/size (the plugin replaces the file on every
# save) and re-exports on change; at most ~2 s behind. Runs in the
# background for the life of the container. Never fails the broker.
dynsec_watch() {
  (
    set +e
    last=
    while :; do
      current=$(stat -c '%i %Y %s' "$DYNSEC" 2>/dev/null)
      if [ -n "$current" ] && [ "$current" != "$last" ]; then
        if dynsec_export; then
          last=$current
        else
          printf '%s\n' "dynsec: could not export $DYNSEC_VIEW, will retry" >&2
        fi
      fi
      sleep 2
    done
  ) &
}
