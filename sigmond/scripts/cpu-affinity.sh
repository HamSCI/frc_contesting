#!/bin/bash
# Keep a unit off radiod's cores by reusing sigmond's own "other"-role CPU set.
#
# sigmond writes smd-cpu-affinity.conf drop-ins only for the units listed in
# lib/sigmond/cpu.py AFFINITY_UNITS, which doesn't know about FRC units.  We
# copy the drop-in sigmond generated for a known "other" unit so the CPU list
# always matches this host's radiod placement (never hard-coded).
#   usage: cpu-affinity.sh <unit-name>   e.g. frc-spot-store@.service
set -euo pipefail
UNIT="$1"
for ref in hs-uploader.service 'psk-recorder@.service' 'wspr-recorder@.service' ka9q-web.service; do
  src="/etc/systemd/system/$ref.d/smd-cpu-affinity.conf"
  if [ -f "$src" ]; then
    install -d "/etc/systemd/system/$UNIT.d"
    { echo "# Copied from $src by frc_contesting sigmond/scripts/cpu-affinity.sh"
      echo "# Re-run the FRC install after 'smd admin diag cpu-affinity --apply' changes it."
      grep -v '^# Regenerate' "$src"; } > "/etc/systemd/system/$UNIT.d/smd-cpu-affinity.conf"
    echo "[cpu-affinity] $UNIT pinned like $ref: $(grep -m1 '^CPUAffinity=[0-9]' "$src")"
    exit 0
  fi
done
echo "[cpu-affinity] no sigmond affinity drop-in found; $UNIT left unpinned" >&2
