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

**Before you start**, the station needs:

* sigmond with radiod, `wspr-recorder` and `psk-recorder` running and writing
  spots to `/var/lib/sigmond/sink.db`.
* `STATION_REPORTER_ID` and `STATION_GRID` in `/etc/sigmond/coordination.env`.
  Both services take the receiver call and grid from there.
* Debian bookworm or trixie, with internet access during the first install.
  `setup-mongodb.sh` downloads MongoDB 8.0 from repo.mongodb.org. After that the
  station runs offline.

The sigmond modules, the Waterfall tab and click-to-listen are on the
`waterfall-displays` branch. They are not merged to `main` yet.

```bash
# 1. Put this repo where sigmond discovers clients, and link the two clients
sudo -u sigmond git clone -b waterfall-displays https://github.com/HamSCI/frc_contesting.git \
  /opt/git/sigmond/frc-contesting
sudo ln -sfn /opt/git/sigmond/frc-contesting/sigmond/frc-spot-store /opt/git/sigmond/frc-spot-store
sudo ln -sfn /opt/git/sigmond/frc-contesting/sigmond/frc-dashboard  /opt/git/sigmond/frc-dashboard

# 2. Install (creates the `frc` user, installs + secures MongoDB on first run,
#    builds venvs, links units/binaries, renders configs, pins CPUs off radiod)
sudo /opt/git/sigmond/frc-spot-store/scripts/install.sh --enable
sudo /opt/git/sigmond/frc-dashboard/scripts/install.sh --enable

# 3. Optional: add both to /etc/sigmond/topology.toml so `smd status` lists them
sudo smd component enable frc-spot-store frc-dashboard

# 4. Check
frc-spot-store validate --json && frc-spot-store status --json
frc-dashboard  validate --json && frc-dashboard  status --json
```

Then open `http://<station>:5000/`. Spots show up on the Map and Table tabs
within one decode cycle.

The dashboard venv installs ka9q-python from `/opt/git/sigmond/ka9q-python`
when that checkout exists. Otherwise it installs it from PyPI. The Waterfall
tab and click-to-listen need it.

**On a new station**, watch radiod while the Waterfall tab is open. The
defaults were measured on W3USR-06 (see [radiod cost](#radiod-cost-read-before-changing-waterfall)).
Click-to-listen also needs radiod's `usb`, `lsb`, `cwu` and `am` presets.

### Updating

```bash
cd /opt/git/sigmond/frc-contesting && sudo -u sigmond git pull
sudo /opt/git/sigmond/frc-spot-store/scripts/install.sh --enable
sudo /opt/git/sigmond/frc-dashboard/scripts/install.sh --enable
```

The installers never overwrite existing configs in `/etc/frc-*/` or the
credentials in `/etc/frc-contesting/`. A section added in a newer release, such
as `[listen]`, won't appear in an old config file. The code uses that section's
defaults until you add it from `config/frc-dashboard-config.toml.template`.

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

## Waterfall tab

The dashboard's **Waterfall** tab shows a live waterfall of each contest band
(10/15/20/40/80/160 m, highest first), newest row at the top, with a UTC time
axis and a 5-60 min span. The **Bands** tab's mini waterfalls read the same
channels (no extra radiod channels).

```
radiod ──spectrum channels (status mcast)──▶ frc-dashboard supervisor (ka9q-python SpectrumStream)
                                                   │  /x/frc-dashboard/waterfall  (control socket)
browser ◀── /api/waterfall (Flask relay) ◀─────────┘
```

* **Source.** One radiod *spectrum* channel per band, through
  ka9q-python's `SpectrumStream`. These are spectrum-only, with no audio
  demodulator, unlike embedding ka9q-web, which opens an audio channel per
  session. The supervisor owns the channels because gunicorn runs several workers.
* **Only while watched.** The tab's iframe loads on first click and stops
  polling when hidden. The supervisor removes the channels 60 s after the last
  request (`idle_timeout_sec`). `frc-dashboard status --json` shows the
  current `waterfall.state`.
* **Browser side.** Rows are uint8 values over -150 to -60 dB. Contrast
  (auto noise floor or manual), palette and layout are applied in the browser.
  Rows are drawn at their own timestamps, so gaps (Pause, restarts, an earlier
  viewing session still in the history) show as black, not as compressed time.
  Hover shows frequency, level and UTC time. The FT8, FT4 and WSPR dial
  frequencies are marked on each axis. Each viewer can reorder, hide and zoom
  bands (Full / CW / SSB / RTTY segments or custom); zoom crops the full-band
  row, so it costs radiod nothing.
* **History.** `history_rows` (default 1800 = 60 min at one row per 2 s) is
  memory only (~1.4 MB per band at 800 bins) and adds no radiod load. It is
  kept across idle stop/start of the channels until the service restarts.
  `/api/waterfall?span=<s>` returns only the last `span` seconds, so a first
  request doesn't download the whole hour.
* **Noise history (#74).** While the channels run, the supervisor keeps the
  median dB of each band's rows, one point per minute for 24 h, at
  `/x/frc-dashboard/noise` (shown in the dashboard's Local PSWS panel).

### radiod cost: read before changing `[waterfall]`

Measured on W3USR-06 (RX-888 at 129.6 MS/s, radiod about 90% of one core).
"Drops" means radiod `filter_drops` summed over **all** of its channels,
including WSPR, FT8 and hf-timestd.

| Configuration (6 bands unless noted) | radiod drops |
|---|---|
| idle (no spectrum channels) | 0 |
| 1,600–2,000 bins, 0.5 s, aligned polls | about 120 gaps in hf-timestd's 10-min sidecars |
| 800 bins, avg 4, 1 s, aligned polls, 20 m at 437.5 Hz bins | **+33,582 in 2.8 min** |
| 20 m alone at 437.5 Hz bins (296,228.57-point FFT) | +7,022 / min |
| 20 m alone at 400 Hz bins (324,000-point FFT) | 0 |
| FFT-friendly bins, avg 4, 1 s, aligned polls | +147 / 72 s |
| FFT-friendly bins, avg 4, 1 s, **staggered** polls | +3 / 72 s |
| FFT-friendly bins, **avg 2, 2 s, staggered** (the defaults) | **0** (2.8 min A/B vs idle; radiod CPU 93% to 94%; hf-timestd sidecars 0 gaps over 30 min) |

Above radiod's 200 Hz crossover, each frame is an FFT of `samprate / rbw`
points over the raw front-end samples. So:

1. **FFT size.** `waterfall.plan_band()` picks the bin width so that
   `samprate / rbw` is a 5-smooth integer (prime factors only 2, 3 and 5).
   The sample rate is read from radiod's status, so this also works at other
   RX-888 rates.
2. **Staggered polls.** The bands start `poll_sec / n_bands` apart, so
   their FFTs never run in the same instant.
3. **Load.** The default is 2 averaged FFTs per row and one row every 2 s.
   Raising `averaging`, `bins` or the band count, or lowering `poll_sec`,
   adds radiod load. Re-measure drops if you change any of them.

### Click to listen

Clicking a waterfall plays that frequency in the browser.

* **Tuning.** In Auto mode, clicks below each band's US phone segment tune
  CW. Above it, the mode is LSB under 10 MHz and USB above. A click near an
  FT8/FT4/WSPR dial frequency tunes that dial in USB. For SSB the click marks
  the middle of the signal, so the dial is set 1.5 kHz to the side and rounded
  to 100 Hz. Use the ±100 Hz / ±1 kHz buttons or ←/→ (Shift = 1 kHz) to adjust.
* **Path.** Each listener gets one radiod audio channel through ka9q-python
  `ensure_channel` (preset `usb`/`lsb`/`cwu`/`am`, 12 kHz, AGC on). This is the
  same kind of channel the WSPR/FT8 recorders run, not a spectrum channel.
  A frequency change retunes the channel in place. A mode change replaces it,
  because radiod stops delivering a channel's audio after a preset change.
  `ensure_channel` sends a gain, which turns AGC off in radiod, so the
  supervisor turns AGC back on. It also reads the output encoding back from
  radiod rather than trusting `ensure_channel`'s first report.
  `RadiodStream` receives it in the supervisor, which streams s16le PCM over
  the control socket (`/x/frc-dashboard/listen/audio`). Flask relays that at
  `/api/listen/audio`, and the browser resamples it with a ScriptProcessor,
  because AudioWorklet needs HTTPS and the dashboard is plain HTTP on the LAN.
* **Limits and cleanup.** At most `[listen] max_listeners` (default 2)
  channels exist at once. Each audio stream also holds one gunicorn thread.
  A channel is removed when you press Stop, close the page (`sendBeacon`), or
  after 15 s with no audio reader or keepalive. Each channel also carries a
  radiod LIFETIME refreshed every 10 s, so it self-destructs if the supervisor dies.
* **Bandwidth.** About 24 kB/s per listener. Latency is about 0.5–1 s
  (0.4 s jitter buffer, capped at 2 s).
* **Live decoding** (browser only, nothing on the station). The listen bar
  decodes what you hear: CW in CW mode, RTTY in a band's RTTY segment, and
  FT8/FT4 on their dial frequencies (Auto), or one forced from the menu.
  FT8/FT4 (`static/js/ft8.js`) is a port of ft8_lib, the library behind the
  station's own `decode_ft8`. On real 20 m slots recorded through this path
  it gives exactly the same messages (169 FT8 + 47 FT4). It decodes each
  15 s / 7.5 s UTC slot as it ends, adds SNR (2500 Hz) and DT, and fills in
  hashed calls (`<...>`) once their full call has been heard. Slots are timed
  against the server's clock (`/api/time`), because a browser's clock can be
  seconds off; any remaining audio delay is measured from the decodes and
  removed.

To turn it off: `[listen] enabled = false`, then `smd restart frc-dashboard`.

To turn the tab off: `[waterfall] enabled = false` in
`/etc/frc-dashboard/frc-dashboard-config.toml`, then `smd restart frc-dashboard`.

## CW skimmer (`/cws`)

Decodes every CW signal in the bottom 70 kHz of one band at once (the band
is chosen on the page), and spots callsigns that call CQ, in Reverse Beacon
Network format. It is reached at `http://<station>:5000/cws`. It is not a
dashboard tab yet (the tab code is in place, but its button was removed
from `templates/both.html` for now), and spots are not on the map or table.

* **Path.** One radiod IQ channel (preset `iq`, 96 kHz, ±46 kHz) through
  ka9q-python, received by a `RadiodStream` in the supervisor and passed over
  a pipe to a separate engine process (`skimmer.py`, `cwskim.py`). In the
  supervisor's own process the DSP starved the receive thread and the kernel
  dropped about 8 % of the packets. IQ packets carry 180 complex samples
  each, which is also the RTP timestamp step.
* **radiod cost.** An ordinary channel like the recorders' channels, not a
  spectrum channel. Measured on W3USR-06: 0 `filter_drops` summed over all
  45 channels before, during and after. The engine takes about 12 % of one
  core.
* **Decoder.** After VE3NEA's advice on CW Skimmer's design (keep
  probabilities, not hard decisions, all the way to the word stage):
  1. An STFT filter bank: 16 ms Hann window, 31.25 Hz bins, 4 ms hop.
  2. Per signal, a coherent average over about a third of a dit.
  3. A key-down vs key-up likelihood ratio per frame (Rician vs Rayleigh) and
     a two-state Viterbi.
  4. Dit/dah and gap probabilities from log-normal timing models, with
     D. L. Mills' priors.
  5. A beam search over the Morse tree.
  6. Word priors: common CW words, callsign shapes, and calls this station has
     heard.

  Details are in the `cwskim.py` docstring.
* **Spots.** A call within three words after CQ / TEST / DE / TU (or just
  before TEST) is a spot. It is *confirmed* when the call has been heard by
  this station on WSPR/FT8/FT4 (MongoDB, about 28,000 calls on W3USR-06) or
  is in `scp_file`, or when it was copied twice on that frequency.
  Unconfirmed spots are shown greyed out and never go to the feed. A call is
  spotted again only after 10 minutes, or 1 kHz away.
* **RBN feed (off).** With `telnet_port` set, confirmed spots are served as a
  DX-cluster telnet feed in the CW Skimmer / RBN layout:
  `DX de W3USR-#:   14025.0  K1ABC        CW    23 dB  25 WPM  CQ      1928Z`.
  This is the interface the RBN Aggregator reads. The dashboard uploads
  nothing itself. Before feeding RBN:
  * set `always_on = true`;
  * check that the SNR scale suits RBN (ours is dB over the noise in a ~94 Hz
    bin);
  * leave `telnet_bind` on 127.0.0.1 unless the Aggregator runs elsewhere.
* **What it does today** (W3USR-06, 16 Nov 2026, evening):
  * Machine-sent and strong signals copy well, e.g. "VA3AR VA3AR VA3AR",
    "W5HVV W5HVV W5HVV W5HVV", "CQ ... DE KF9VV", "UR 5NN 5NN".
  * Hand-sent rag-chew copies partly.
  * Signals below about −6 dB in 2.5 kHz (about 8 dB per bin) are mostly
    lost.
  * Synthetic tests: clean copy at 18–40 WPM down to about −5 dB, and two
    stations 120 Hz apart both decoded.
* **Try it without the dashboard:**
  `cd .../sigmond/frc-dashboard/src && ../venv/bin/python -m frc_dashboard.skimmer live --band 40m --seconds 120`
  prints spots, then each signal's text.

To turn it off: `[skimmer] enabled = false`, then `smd restart frc-dashboard`.

## Files

```
sigmond/
├── scripts/            setup-mongodb.sh, ensure-user.sh, cpu-affinity.sh (shared)
├── frc-spot-store/     deploy.toml, pyproject.toml, src/frc_spot_store/, systemd/, config/, tests/
└── frc-dashboard/      deploy.toml, pyproject.toml, src/frc_dashboard/ (incl. waterfall.py, listen.py,
                        skimmer.py, cwskim.py), systemd/, config/, tests/
```

Waterfall front end (repo root): `routes/waterfall.py`, `templates/waterfall.html`,
`static/js/waterfall.js`, the `.wf-*` styles in `static/css/style.css`, and the
tab in `templates/both.html` + `static/js/dashboard.js`.

Credentials: `/etc/frc-contesting/mongodb.env` (`frc` user, readWrite on
`wspr_db`, mode 0640 root:frc) and `/etc/frc-contesting/mongodb-admin.env`
(`mongoadmin` root account, mode 0600). Both are generated on the host and are
never committed.
