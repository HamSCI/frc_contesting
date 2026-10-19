# sigmond modules for the FRC Contesting Dashboard

Two [sigmond](https://github.com/HamSCI/sigmond) clients that run this
dashboard on a ka9q-radio / sigmond station (e.g. W3USR-06), replacing the
WSPRDaemon + `storedb/storedb.py` cron path.

```
RX-888 → radiod (ka9q-radio) ─┬─ wspr-recorder (WSPR)  ─┐
                              └─ psk-recorder (FT8/FT4) ─┴→ /var/lib/sigmond/sink.db
                                                              │  (shared sigmond sink;
                                                              │   hs-uploader reads it too)
                                       frc-spot-store ◀───────┘  read-only tail by row id
                                              │
                                              ▼
                                   MongoDB wspr_db.spots   (127.0.0.1, auth on)
                                              │
                                       frc-dashboard  →  http://<station>:5000/
                                   (this repo's Flask app under gunicorn, unchanged)
```

| Client | What it does | Unit | Config |
|---|---|---|---|
| `frc-spot-store` | Tails `sink.db` for `wspr.spots` and `psk.spots` rows, converts them to the dashboard's `wspr_db.spots` schema, and upserts them into MongoDB | `frc-spot-store@default` | `/etc/frc-spot-store/frc-spot-store-config.toml` |
| `frc-dashboard` | Runs the existing Flask dashboard (`web-ft:app`) under gunicorn, with receiver call/grid taken from sigmond's station identity | `frc-dashboard@default` | `/etc/frc-dashboard/frc-dashboard-config.toml` |

Both clients follow sigmond CLIENT-CONTRACT v0.8:
`version|inventory|validate --json`, `config show|init|edit|apply`, `daemon`,
a templated `@.service` plus a single-instance alias, `deploy.toml`, and a §13
control socket (`curl --unix-socket /run/frc-spot-store/control.sock http://./status`).
`smd admin diag drop-in frc-spot-store` and `smd admin diag drop-in frc-dashboard`
both pass.

## Install on a sigmond host

```bash
# 1. Put this repo where sigmond discovers clients, and link the two clients
sudo -u sigmond git clone <this repo> /opt/git/sigmond/frc-contesting
ln -sfn /opt/git/sigmond/frc-contesting/sigmond/frc-spot-store /opt/git/sigmond/frc-spot-store
ln -sfn /opt/git/sigmond/frc-contesting/sigmond/frc-dashboard  /opt/git/sigmond/frc-dashboard

# 2. Install (creates the `frc` user, installs + secures MongoDB on first run,
#    builds venvs, links units/binaries, renders configs, pins CPUs off radiod)
sudo /opt/git/sigmond/frc-spot-store/scripts/install.sh --enable
sudo /opt/git/sigmond/frc-dashboard/scripts/install.sh --enable

# 3. Check
frc-spot-store validate --json && frc-spot-store status --json
frc-dashboard  validate --json && frc-dashboard  status --json
```

Optional: `sudo smd component enable frc-spot-store frc-dashboard` adds them
to `/etc/sigmond/topology.toml` so `smd status` lists them.

## Data mapping (sink → `wspr_db.spots`)

| Dashboard field | WSPR (`wspr.spots`) | FT8/FT4 (`psk.spots`) |
|---|---|---|
| `callsign` | `callsign` (`<...>` hashes skipped) | `tx_call` (not `rx_call`, which is the message addressee) |
| `rx_callsign` | sigmond `STATION_REPORTER_ID` (e.g. `W3USR/06`) | same |
| `grid` | `grid` | `grid` |
| `frequency` (MHz) | `frequency_hz / 1e6` | `frequency / 1e6` |
| `band`, `mode` | from frequency; `W2` → `wspr` | from frequency; `ft8` / `ft4` |
| `date`, `time` | `time` → `YYMMDD`, `HHMM` (UTC) | same |
| `snr` | `snr_db` | `snr_db` — **null with the `decode_ft8` decoder** (see below) |
| `drift` (Hz/min) | `drift_hz_per_s × 60` | null |
| `power`, `dt`, `sync` | `pwr_dbm`, `dt`, `sync_quality` | null, `dt`, null |

Extra fields that the dashboard ignores: `ts` (BSON UTC datetime, used by the
TTL index), `spot_key` (unique key `mode|slot|call|band`), `reporter_id`,
`radiod_id`, `decoder`, `source`, plus `score`/`message` for FT8/FT4.

Skipped rows, which `frc-spot-store status --json` counts by reason:
no usable grid (blank, or `RR73` sign-offs), unresolved callsign hash,
FST4W (`F2/F5/F15/F30`), MSK144 (meteor-scatter rows also land in `psk.spots`),
and duplicate decodes (the strongest SNR is kept).

## Behaviour notes

* **Read-only on the sink.** Opened `mode=ro` and never deleted from.
  `hs-uploader` keeps its own cursor (`delete_on_commit = false`), so
  the two never interfere. `smd admin storage trim` ages rows out (about 1 h for psk
  and 24 h for wspr on W3USR-06). If frc-spot-store is down longer than that, the
  rows it missed are gone, and it logs the gap.
* **No loss when MongoDB is down.** The cursor only advances after MongoDB
  acknowledges a batch. The service reports `degraded` and retries with backoff.
* **Robust to bad input.** A malformed sink row is counted as `translate_error`
  and skipped, so it can't stall the cursor. If `sink.db` is rebuilt
  (the ids restart), the cursor resets and re-reads it; upserts are idempotent.
* **Duplicates:** within a batch the strongest-SNR decode wins. Across batches
  the first stored copy wins (`$setOnInsert`).
* **Gap warnings** (`gap_psk` / `gap_wspr` counters) assume the producer was
  writing continuously. If psk-recorder itself was stopped, the warning can be
  a false positive.
* **First start** backfills everything still in the sink (`start_at = "oldest"`).
* **Retention:** 30-day TTL on `ts` (`[mongodb] retention_days`).
* **FT8/FT4 SNR:** psk-recorder's default `decode_ft8` decoder (ft8_lib) emits
  an uncalibrated score, not dB, so `snr` is null. The map popup then leaves out
  the SNR line (and the Drift line, for the same reason). Switching psk-recorder to `decoder_kind = "jt9"` gives calibrated
  SNR with no change needed here. The score is kept in the `score` field.
  **jt9 trial on W3USR-06 (2026-10-08) was rolled back:**
  1. **Sandbox bug.** Under the psk-recorder unit's `ProtectSystem=strict`, every
     `jt9_decode` exits at once because `/tmp` and its working directory are
     read-only. The drop-in `psk-recorder@.service.d/20-frc-jt9-sandbox.conf`
     fixes this by setting `TMPDIR` and the working directory to
     `/var/lib/psk-recorder/tmp`.
  2. **Memory.** With that fixed, jt9 gave real SNR at about 1.1 cores, but it
     costs about 874 MB of shared memory (19 × 48 MB) and its anonymous memory
     grew about 29 MB/min. The host hit a global OOM that killed
     `timestd-core-recorder`, which systemd restarted after about 22 s.
  3. **Leaked segments.** Killed `jt9_decode` processes leave their SysV shm
     segments behind, which need `ipcrm` cleanup.
  Don't retry it without more RAM, fewer jt9 channels, and an upstream fix for
  the growth.
  **Drift** is not reported for FT8/FT4 by either decoder.
* **Resources:** mongod is capped at a 0.5 GB WiredTiger cache and
  `MemoryMax=1500M`. All three services are pinned to sigmond's "other" CPU set
  (copied from its own `smd-cpu-affinity.conf` drop-ins), so they stay off
  radiod's cores. Re-run the installers after `smd admin diag cpu-affinity --apply`.

## Files

```
sigmond/
├── scripts/            setup-mongodb.sh, ensure-user.sh, cpu-affinity.sh (shared)
├── frc-spot-store/     deploy.toml, pyproject.toml, src/frc_spot_store/, systemd/, config/, tests/
└── frc-dashboard/      deploy.toml, pyproject.toml, src/frc_dashboard/,  systemd/, config/
```

Credentials: `/etc/frc-contesting/mongodb.env` (`frc` user, readWrite on
`wspr_db`, mode 0640 root:frc) and `/etc/frc-contesting/mongodb-admin.env`
(`mongoadmin` root account, mode 0600). Both are generated on the host and are
never committed.
