#!/bin/bash
# frc-spot-store installer (standalone-safe; deploy.toml is the source of truth).
#
#   sudo scripts/install.sh               build venv, link binaries/units, render config
#   sudo scripts/install.sh --build-only  just (re)build the venv (sigmond [build] step)
#   sudo scripts/install.sh --enable      ...and enable + start frc-spot-store@default
set -euo pipefail

CLIENT=frc-spot-store
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SHARED="$(cd "$REPO/.." && pwd -P)/scripts"
PY="${PYTHON:-python3}"
BUILD_ONLY=0; ENABLE=0
for a in "$@"; do
  case "$a" in
    --build-only) BUILD_ONLY=1 ;;
    --enable)     ENABLE=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

echo "[$CLIENT] building venv in $REPO/venv"
[ -x "$REPO/venv/bin/python" ] || "$PY" -m venv "$REPO/venv"
"$REPO/venv/bin/pip" install -q --upgrade pip setuptools wheel
"$REPO/venv/bin/pip" install -q -e "$REPO"
[ "$BUILD_ONLY" = 1 ] && exit 0

[ "$(id -u)" = 0 ] || { echo "install needs root (sudo)" >&2; exit 1; }

"$SHARED/ensure-user.sh"
[ -f /etc/frc-contesting/mongodb.env ] || "$SHARED/setup-mongodb.sh"

ln -sfn "$REPO/venv/bin/$CLIENT"              "/usr/local/bin/$CLIENT"
ln -sfn "$REPO/systemd/$CLIENT@.service"     "/etc/systemd/system/$CLIENT@.service"
ln -sfn "$REPO/systemd/$CLIENT.service"      "/etc/systemd/system/$CLIENT.service"

install -d -m 0755 "/etc/$CLIENT" "/etc/$CLIENT/env"
# CLIENT-CONTRACT s5.1: env/<instance>.env is what makes `default` a
# *configured* instance for smd start/stop/status.  Per-instance overrides
# (e.g. FRC_LOG_LEVEL=DEBUG) go in this file.
if [ ! -f "/etc/$CLIENT/env/default.env" ]; then
  echo "# Per-instance environment for $CLIENT@default (sigmond CLIENT-CONTRACT s4/s5.1)" \
    > "/etc/$CLIENT/env/default.env"
fi
# Named <client>-config.toml: sigmond treats any other /etc/<client>/*.toml
# as a per-instance config and would invent a phantom <client>@<stem> unit.
CONF="/etc/$CLIENT/$CLIENT-config.toml"
if [ -f "/etc/$CLIENT/$CLIENT.toml" ] && [ ! -f "$CONF" ]; then
  mv "/etc/$CLIENT/$CLIENT.toml" "$CONF"          # migrate pre-0.1.0 name
  echo "[$CLIENT] migrated config to $CONF"
fi
if [ ! -f "$CONF" ]; then
  install -m 0644 -o root -g frc "$REPO/config/$CLIENT-config.toml.template" "$CONF"
  echo "[$CLIENT] rendered $CONF"
fi

"$SHARED/cpu-affinity.sh" "$CLIENT@.service"

systemctl daemon-reload
if [ "$ENABLE" = 1 ]; then
  systemctl enable "$CLIENT.service" "$CLIENT@default.service"
  systemctl restart "$CLIENT@default.service"
fi
echo "[$CLIENT] installed.  Start: sudo systemctl enable --now $CLIENT@default"
