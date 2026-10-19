#!/bin/bash
# Install and secure a local MongoDB for the FRC spot store + dashboard.
# Idempotent: safe to re-run; never regenerates existing credentials.
#
#  * MongoDB 8.0 from repo.mongodb.org (Debian 13 has no server package for
#    8.0 in MongoDB's trixie tree, so the bookworm build is used; it runs on
#    trixie's libssl3t64/libcurl4t64).
#  * bindIp 127.0.0.1, WiredTiger cache capped at 0.5 GB, authorization on.
#  * Users: mongoadmin (root, /etc/frc-contesting/mongodb-admin.env, 0600)
#           frc        (readWrite on wspr_db, /etc/frc-contesting/mongodb.env,
#                       0640 root:frc — read by both FRC services)
#  * mongod pinned like sigmond's other background units (off radiod cores).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "needs root" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ENV_DIR=/etc/frc-contesting
MONGO_SERIES=8.0

"$HERE/ensure-user.sh"

if ! command -v mongod >/dev/null; then
  . /etc/os-release
  case "$VERSION_CODENAME" in bookworm|trixie) SUITE=bookworm ;; *) SUITE="$VERSION_CODENAME" ;; esac
  curl -fsSL "https://pgp.mongodb.com/server-$MONGO_SERIES.asc" \
    -o "/usr/share/keyrings/mongodb-server-$MONGO_SERIES.asc"
  echo "deb [ arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/mongodb-server-$MONGO_SERIES.asc ] https://repo.mongodb.org/apt/debian $SUITE/mongodb-org/$MONGO_SERIES main" \
    > "/etc/apt/sources.list.d/mongodb-org-$MONGO_SERIES.list"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q mongodb-org-server mongodb-mongosh
fi

write_conf() {  # $1 = "#" to leave auth commented, "" to enable it
  [ -f /etc/mongod.conf.orig ] || cp /etc/mongod.conf /etc/mongod.conf.orig 2>/dev/null || true
  cat > /etc/mongod.conf <<CONF
# mongod.conf — FRC contesting dashboard spot store
# Localhost only; capped cache so radiod/decoders keep their memory.
storage:
  dbPath: /var/lib/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 0.5

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 127.0.0.1

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

${1}security:
${1}  authorization: enabled
CONF
}

install -d -m 0755 /etc/systemd/system/mongod.service.d
cat > /etc/systemd/system/mongod.service.d/10-frc-limits.conf <<'CONF'
# FRC dashboard: keep mongod a polite neighbour of radiod.
[Service]
Nice=5
MemoryMax=1500M
CONF
"$HERE/cpu-affinity.sh" mongod.service
systemctl daemon-reload

install -d -m 0755 "$ENV_DIR"
# Credentials are generated and SAVED before any user exists, so a failure
# part-way can be fixed by simply re-running this script.
if [ ! -f "$ENV_DIR/mongodb.env" ] || [ ! -f "$ENV_DIR/mongodb-admin.env" ]; then
  umask 077
  if [ ! -f "$ENV_DIR/mongodb-admin.env" ]; then
    printf 'MONGODB_ADMIN_USERNAME=mongoadmin\nMONGODB_ADMIN_PASSWORD=%s\n' \
      "$(openssl rand -hex 16)" > "$ENV_DIR/mongodb-admin.env"
  fi
  if [ ! -f "$ENV_DIR/mongodb.env" ]; then
    printf '%s\n' '# MongoDB connection for frc-spot-store + frc-dashboard' \
      'MONGODB_HOST=127.0.0.1' 'MONGODB_PORT=27017' 'MONGODB_USERNAME=frc' \
      "MONGODB_PASSWORD=$(openssl rand -hex 16)" 'MONGODB_DATABASE=wspr_db' \
      > "$ENV_DIR/mongodb.env"
  fi
  umask 022
fi
chown root:frc "$ENV_DIR/mongodb.env"; chmod 0640 "$ENV_DIR/mongodb.env"
chmod 0600 "$ENV_DIR/mongodb-admin.env"
FRC_PW=$(sed -n 's/^MONGODB_PASSWORD=//p' "$ENV_DIR/mongodb.env")
ADMIN_PW=$(sed -n 's/^MONGODB_ADMIN_PASSWORD=//p' "$ENV_DIR/mongodb-admin.env")

wait_mongod() {
  for _ in $(seq 60); do mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1 && return 0; sleep 1; done
  echo "[setup-mongodb] mongod did not come up" >&2; return 1
}

systemctl enable mongod
if [ -f /etc/mongod.conf ] && grep -q '^  authorization: enabled' /etc/mongod.conf \
   && systemctl is-active -q mongod \
   && mongosh --quiet -u frc -p "$FRC_PW" --authenticationDatabase admin --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; then
  echo "[setup-mongodb] auth already configured; credentials verified"
else
  # (Re)create users with auth temporarily off; the trap guarantees auth is
  # switched back on even if anything below fails.
  trap 'write_conf ""; systemctl restart mongod' EXIT
  write_conf "#"
  systemctl restart mongod
  wait_mongod
  mongosh --quiet admin --eval "
    function upsert(u, p, r) {
      if (db.getUser(u)) { db.updateUser(u, {pwd: p, roles: r}); }
      else { db.createUser({user: u, pwd: p, roles: r}); }
    }
    upsert('mongoadmin', '$ADMIN_PW', ['root']);
    upsert('frc', '$FRC_PW', [{role: 'readWrite', db: 'wspr_db'}]);"
fi
trap - EXIT
write_conf ""
systemctl restart mongod
wait_mongod
mongosh --quiet -u frc -p "$FRC_PW" --authenticationDatabase admin --eval 'db.runCommand({ping:1}).ok' >/dev/null
echo "[setup-mongodb] mongod $(mongod --version | head -1 | awk '{print $3}') running with auth on 127.0.0.1:27017"
