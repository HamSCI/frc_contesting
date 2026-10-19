#!/bin/bash
# Create the `frc` service account shared by frc-spot-store and frc-dashboard.
# Member of `sigmond` so it can read /var/lib/sigmond/sink.db (WAL -shm needs
# group write) and bind control sockets with group sigmond.
set -euo pipefail
getent group frc >/dev/null || groupadd --system frc
if ! id frc >/dev/null 2>&1; then
  useradd --system --gid frc --home-dir /nonexistent --no-create-home \
          --shell /usr/sbin/nologin frc
fi
getent group sigmond >/dev/null && usermod -aG sigmond frc
# Let the operator account read the shared MongoDB credentials.
if id sigmond >/dev/null 2>&1; then usermod -aG frc sigmond; fi
exit 0
