# HamSCI Contesting and DXing Dashboard

**Authors:** Owen Ruzanski (KD3ALD), Liam Miller (KD3BVX), Nathaniel Frissell (W2NAF)
**Organization:** University of Scranton (W3USR), Frankford Radio Club
**Project:** HamSCI Personal Space Weather Station Dashboard Development
**Last Updated:** March 2026

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [API Documentation](#api-documentation)
6. [Frontend Components](#frontend-components)
7. [Database Schema](#database-schema)
8. [Development Guide](#development-guide)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)

---

## Project Overview

### Purpose

The HamSCI Contesting and DXing Dashboard is a real-time web application designed to help amateur radio operators optimize their HF transmissions during contests and DX operations. The dashboard visualizes propagation data from the HamSCI Personal Space Weather Station (PSWS) network, which collects WSPR, FT8, and FT4 digital mode spots.

### Key Features

- **Real-time propagation visualization** on an interactive map: a great-circle (azimuthal equidistant) map centred on the station by default, or Mercator
- **Band chips**: any combination of bands (All / Contest / Clear presets), labelled by frequency (`14 MHz`) with the ham name secondary, highest band first everywhere
- **Mode shapes**: colour = band, shape = mode (WSPR circle, FT8 square, FT4 triangle); mode filters generated from one mode table
- **Geographic filtering** by country, continent, CQ zone, and ITU zone
- **Gray line**: solar terminator with civil/nautical/astronomical twilight, computed locally
- **Tabular view** showing band openings by geographic region
- **Bands view**: one card per band with a station-centred direction map, an Open/Marginal/Closed status, a 60-min spot-rate sparkline and a mini waterfall
- **States view**: US states and Canadian provinces heard per band, and which are missing (ARRL Sweepstakes)
- **Live band waterfalls** of the 6 contest bands, from radiod (ka9q-radio) on sigmond stations, with a UTC time axis, 5-60 min span, per-viewer band order/zoom (CW/SSB/RTTY segments); click one to listen (USB/LSB/CW/AM), with live **CW, RTTY, FT8 and FT4 decoding** in the browser
- **CW skimmer** (Skimmer tab): every CW signal in the bottom 70 kHz of a chosen band decoded at once, CQ calls spotted in Reverse Beacon Network format (telnet feed available, off by default; nothing is uploaded)
- **Space weather** (optional, needs internet at the server): NOAA SWPC X-ray, solar wind, IMF, Kp, SFI, protons, R/S/G scales and alerts on every tab, plus an aurora overlay
- **Local PSWS**: this station's own WWV/WWVH Doppler (hf-timestd), farthest spot per band and band noise floors; no internet needed
- **Auto-reload** every 5 min by default, without reloading the page
- **Shareable links**: every setting, and the open tab, is kept in the URL

### Project Goals

1. Enable amateur radio operators to optimize transmissions based on real-time ionospheric conditions
2. Provide local propagation insights to individual PSWS stations
3. Contribute to understanding of both localized and global HF conditions
4. Answer key questions operators ask:
   - What bands are open and where?
   - When did they open/close?
   - What is the current Maximum Usable Frequency (MUF)?
   - Which band has the most activity?
   - What direction are signals coming from?

---

## System Architecture

### Technology Stack

**Backend:**
- Python 3.x
- Flask 2.x (web framework)
- MongoDB (database)
- PyMongo (database driver)
- Additional libraries: maidenhead, geopandas, shapely, geopy

**Frontend:**
- HTML5/CSS3
- JavaScript (ES6+)
- Leaflet.js 1.9.4 (interactive maps, vendored locally in `static/vendor/leaflet/`)
- [Leaflet.ExtraMarkers](https://github.com/coryasilva/Leaflet.ExtraMarkers) (custom marker icons)
- Turf.js (geospatial analysis, vendored locally)

**Data Sources:**
- MongoDB database running WSPRDaemon
- GeoJSON boundary files (countries, continents, CQ zones, ITU zones)

### Architecture Diagram

```
┌─────────────────────────────────────────────┐
│         Your PSWS Receiver                  │
│  RX-888 SDR + KA9Q-radio + WSPRDaemon      │
│  Decodes WSPR/FT8/FT4 on all HF bands      │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│        MongoDB Database Server              │
│              wspr_db.spots                  │
│  Stores: callsign, grid, frequency, SNR,    │
│          date, time, mode, drift            │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│       Flask Backend (app.py)                │
│  routes/views.py:                           │
│    /          → both.html (combined view)   │
│    /map       → index_ft.html (map)         │
│    /table     → table_ft.html (table)       │
│  routes/api.py:                             │
│    /config    → JSON receiver config        │
│    /spots     → JSON API (map data)         │
│    /tbspots   → JSON API (table data)       │
│  services/spots.py  — DB queries            │
│  services/geo.py    — CQ zone lookups       │
│  utils/bands.py     — frequency→band        │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│         Frontend JavaScript                 │
│  ┌──────────────┐  ┌───────────────┐       │
│  │  map_ft.js   │  │  table_ft.js  │       │
│  │  (735 lines) │  │  (223 lines)  │       │
│  │  - Leaflet   │  │  - Regional   │       │
│  │  - Filtering │  │    aggregation│       │
│  │  - Markers   │  │  - Band matrix│       │
│  └──────────────┘  └───────────────┘       │
└─────────────────────────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│        User's Web Browser                   │
│  Interactive map or table view with         │
│  real-time spot updates every 2-30 min      │
└─────────────────────────────────────────────┘
```

### Data Flow

1. **Data Collection:** PSWS receiver decodes WSPR/FT8/FT4 spots continuously
2. **Ingestion:** WSPRDaemon calls `storedb/storedb.sh` after each decode cycle, which upserts spots into MongoDB
3. **API Request:** Frontend requests spots via `/spots?lastInterval=15`
4. **Processing:** Backend queries MongoDB for spots in time window, converts grids to coordinates
5. **Client Filtering:** JavaScript applies band/country/zone/mode filters
6. **Visualization:** Spots rendered on map with colored markers or in table by region

---

## Security Notice

**✅ Security Update (January 2026):** This repository's git history has been cleaned to remove all previously exposed credentials. All passwords and IP addresses have been redacted from historical commits.

**Important security practices:**
1. **Environment variables required:** This application uses `.env` files for credential management (never commit `.env` to git)
2. **Change default passwords:** If you're deploying this, always use unique, strong passwords
3. **Review `.env.example`:** Copy it to `.env` and configure with your credentials
4. **Git history is clean:** All sensitive data has been replaced with `***REDACTED***` in past commits

---

## Installation

### Prerequisites

- Python 3.8 or higher
- MongoDB 4.x or higher
- Modern web browser (Chrome, Firefox, Safari, Edge)
- PSWS receiver system (RX-888 + KA9Q-radio + WSPRDaemon)

### Python Dependencies

Create a virtual environment and install dependencies:

```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On Linux/Mac:
source venv/bin/activate

# Install dependencies from requirements.txt
pip install -r requirements.txt
```

### Required Dependencies

See [requirements.txt](requirements.txt) for the complete list:
- flask>=2.0.0 - Web framework
- pymongo>=4.0.0 - MongoDB driver
- maidenhead>=1.1.0 - Grid square conversion
- geopandas>=0.10.0 - Geospatial data
- shapely>=1.8.0 - Geometric operations
- geopy>=2.2.0 - Geocoding
- python-dotenv>=0.19.0 - Environment variable management

### Static Data Files

All required static data files are included in the repository — no separate downloads needed:

- **GeoJSON boundary files** (`static/js/`) — country, continent, CQ zone, and ITU zone polygons used for client-side filtering
- **Offline basemap** (`static/vendor/basemap/`) — Natural Earth land, country border, and state/province GeoJSON files for the offline map background
- **Leaflet 1.9.4** (`static/vendor/leaflet/`) — map library and marker images, vendored locally so no CDN is required

---

## Configuration

### Database Connection

The application uses environment variables for secure credential management.

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set your MongoDB credentials:
   ```bash
   MONGODB_HOST=your_mongodb_host
   MONGODB_PORT=27017
   MONGODB_USERNAME=your_username
   MONGODB_PASSWORD=your_password
   MONGODB_DATABASE=wspr_db
   ```

**IMPORTANT:** Never commit the `.env` file to git! It's already in `.gitignore`.

### MongoDB Authentication Setup

If your MongoDB instance does not yet have a user configured, create one before running the app:

```bash
mongosh
```

```js
use wspr_db
db.createUser({
  user: "wspr_user",
  pwd: "choose_a_strong_password",
  roles: [{ role: "readWrite", db: "wspr_db" }]
})
```

Then set the matching credentials in your `.env` file:

```bash
MONGODB_USERNAME=wspr_user
MONGODB_PASSWORD=choose_a_strong_password
```

> **Note:** By default, MongoDB on a fresh install has no authentication enabled. It is strongly recommended to enable authentication, especially if the machine is network-accessible. See the [MongoDB security checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/) for details.

### Receiver Station Configuration

Set the receiver callsign and Maidenhead grid square in your `.env` file:

```bash
RECEIVER_CALLSIGN=W1ABC
RECEIVER_GRIDSQUARE=FN42hx
```

Replace `W1ABC` with your station callsign and `FN42hx` with your Maidenhead grid square. The grid square can be 4-character (e.g., `FN42`) or 6-character (e.g., `FN42hx`). The backend reads these values at startup and serves them to the frontend via the `/config` API endpoint.

### Bands and Modes

Every band is defined once, in `CONFIG.bands` in [static/js/config.js](static/js/config.js): its edges, the
frequency and wavelength labels, its colour, whether it is a contest/HF band, the FT8/FT4/WSPR dial
frequencies marked on the waterfalls, and the CW/SSB/RTTY contest segments used by the waterfall zoom
presets. The map legend, band chips, table columns, waterfall titles and popups are all generated from it,
highest frequency first.

```javascript
{ id: "20m", lo: 14.0, hi: 14.35, freq: "14 MHz", wl: "20 m", color: "#008B38", hf: true, contest: true,
  dials: { FT8: 14.074, FT4: 14.080, WSPR: 14.0956 },
  segments: { cw: [14.000, 14.150], ssb: [14.150, 14.350], rtty: [14.080, 14.150] } },
```

Modes are defined once in `CONFIG.modes` (label and map symbol shape). A mode that shows up in the data but
isn't listed gets a filter pill and a default shape automatically.

### Optional Settings (.env)

- `SPACEWX_ENABLED=0` turns off the NOAA SWPC space-weather fetching entirely (the strip and the aurora
  overlay then disappear). With it on but no internet, the values simply show as stale or unavailable.
- `TIMESTD_DB` points the Local PSWS panel at hf-timestd's database
  (default `/var/lib/timestd/phase2/timestd.db`). If the file is missing or its schema differs, that part is hidden.

### Shareable Links

The address bar always describes what is on screen, so a view can be bookmarked or shared. For example:

```
/?view=table&last=60&thr=3&band=40m,20m&tmodes=ft8
/?view=map&band=contest&cont=EU&cqo=1&modes=ft8,ft4&proj=merc
/?view=waterfall&seg=ssb&span=30&wfb=20m,40m,80m
/?view=bands&last=30&dist=t
/?view=states&ssort=missing
```

Settings equal to their defaults are left out. A link wins over the recipient's own saved settings. `last`,
`reload` and `band` are shared by all views; each view has its own mode filter (`modes` on the Map, `tmodes`,
`smodes`, `bmodes` on Table, States and Bands), but a plain `modes=` in a link applies to every view. The
**Copy link** button in the header copies the current URL.

---

## API Documentation

### REST Endpoints

#### GET /spots

Fetch spots for map display with full propagation details.

**Query Parameters:**
- `lastInterval` (string, default: "15") - Minutes to look back from current time

**Response Format:**
```json
[
  {
    "tx_sign": "W1ABC",
    "tx_lat": 42.3601,
    "tx_lon": -71.0589,
    "rx_sign": "W3USR",
    "rx_lat": 40.7589,
    "rx_lon": -74.2215,
    "frequency": 14.097,
    "band": "20m",
    "mode": "wspr",
    "snr": -12,
    "drift": 0,
    "time": "260107 1430"
  }
]
```

**Example Request:**
```bash
curl "http://localhost:5000/spots?lastInterval=30"
```

#### GET /tbspots

Fetch spots for table display with regional aggregation data.

**Query Parameters:**
- `lastInterval` (string, default: "15") - Minutes to look back

**Response Format:**
```json
[
  {
    "id": "$507f1f77bcf86cd799439011",
    "band": "20m",
    "grid": "FN42hx",
    "time": "260107 1430",
    "cq_zone": 5,
    "mode": "wspr"
  }
]
```

#### GET /config

Serve receiver station configuration to the frontend.

**Response Format:**
```json
{
  "receiver_callsign": "W3USR",
  "receiver_grid": "FN21ej"
}
```

**Example Request:**
```bash
curl "http://localhost:5000/config"
```

#### GET /api/waterfall

Live spectrum rows for the Waterfall tab. These come from radiod spectrum
channels opened by the `frc-dashboard` sigmond service, which this route
relays to over its control socket. Without that service, for example under
`python web-ft.py`, the route returns 503. See
[sigmond/README.md](sigmond/README.md#waterfall-tab).

**Query Parameters:**
- `since` (int): last row sequence number already received (default: 0 = all history)
- `span` (float): only rows from the last `span` seconds (used on a first request)

**Response Format:**
```json
{
  "running": true, "seq": 1234, "db_min": -150.0, "db_max": -60.0, "poll_sec": 2.0,
  "bands": {
    "20m": {"lo_hz": 14000000, "hi_hz": 14350282, "bins": 798, "rbw_hz": 438.957,
             "rows": [[1233, 1792437000.12, "<base64 uint8 row>"]]}
  }
}
```
While the channels are starting, the response is `{"running": false, "starting": true}`.

#### POST /api/listen/open, /tune, /keepalive, /close and GET /api/listen/audio

Click-to-listen for the Waterfall tab. These also relay to the `frc-dashboard`
sigmond service.

- `POST /api/listen/open` with `{"freq_hz": 14225000, "mode": "usb"}` (modes `usb`, `lsb`, `cw`, `am`) returns `{"sid", "freq_hz", "mode", "sample_rate": 12000}`. It returns 503 when all listening slots are in use.
- `POST /api/listen/tune` takes `{"sid", "freq_hz", "mode"}`. `/keepalive` and `/close` take `{"sid"}`.
- `GET /api/listen/audio?sid=…` streams raw signed 16-bit little-endian mono PCM at 12 kHz until closed.

#### GET /api/skimmer and POST /api/skimmer/band

The Skimmer tab. `GET /api/skimmer?since=<seq>` starts the skimmer if it isn't running. It returns
the band and range, every tracked signal (`freq_khz`, `snr_db`, `wpm`, decoded `text`, `call`),
spots newer than `seq` (`call`, `freq_khz`, `snr_db`, `wpm`, `type`, `confirmed`, `reason` and the
RBN-format line `rbn`), a spectrum of the range and stats. `POST /api/skimmer/band` with
`{"band": "40m"}` moves it. Both relay to the `frc-dashboard` sigmond service.

#### GET /api/time

`{"t_ms": <server UTC time in ms>}`, uncached. The browser's FT8/FT4 decoder times its slots against
this instead of the browser's own clock (best of five round trips).

#### GET /api/spacewx and GET /api/aurora

Space-weather context (optional; the server fetches NOAA SWPC products and caches them, browsers never
contact SWPC). `/api/spacewx` returns the GOES X-ray class and 6-h series, protons and S scale, Kp and G scale,
solar wind speed/density, IMF Bt/Bz (with 24-h Bz history), F10.7, the R/S/G scales and alerts from the last
24 h; every value has its own timestamp. `/api/aurora` returns the OVATION forecast cells
(`[lon, lat, percent]`, cells of 5 % or more). Both return `{"enabled": false}` when `SPACEWX_ENABLED=0`.

#### GET /api/psws

This station's own measurements: `timestd` (hf-timestd WWV/WWVH Doppler and SNR per frequency, 6 h),
`spots` (per band per 15 min: spot count and farthest transmitter in km, 6 h) and `noise` (per-band noise
floor kept by the `frc-dashboard` supervisor while the waterfall runs). Each part has `"available": false`
when its source is missing.

#### GET /map, /table, /bands, /states, /waterfall

The views (each also works on its own, outside the tabbed dashboard at `/`). All accept the setting
parameters described under [Shareable Links](#shareable-links).

---

## Frontend Components

### Map View (index_ft.html + map_ft.js)

**Files:** [templates/index_ft.html](templates/index_ft.html), [static/js/map_ft.js](static/js/map_ft.js)

**Features:**
- **Great-circle map** (default): azimuthal equidistant, centred on the receiver grid ([static/js/aeqd.js](static/js/aeqd.js)), so direction = beam heading and distance = great-circle distance; range rings every 2,500 km, bearing spokes, N/E/S/W. **Mercator** is the alternative (Projection control).
- **Fully offline basemap**: land fill, country borders, and state/province borders rendered from local Natural Earth GeoJSON (no tile server required)
- Canvas-drawn spot symbols ([static/js/spot_symbols.js](static/js/spot_symbols.js)): colour = band, shape = mode
- Popups with spot details plus short- and long-path bearing and distance
- Spot counter by band and mode (bottom-right); click a band to hide it, Shift-click to show only it
- Gray line with twilight bands and the subsolar point ([static/js/solar.js](static/js/solar.js))
- Optional OVATION aurora overlay
- CQ zone and ITU zone outline overlays with labels
- Connection status indicator and last-updated timestamp in header

**Filtering Controls:**
- Time interval (last N minutes)
- Band chips: any combination; All / Contest / Clear presets
- Country filter (including "Non-US" option), continent, CQ zone (1-40), ITU zone (1-90)
- Mode pills (generated from `CONFIG.modes`)
- CQ / ITU zone outlines, Gray line, Aurora, Projection
- Auto-reload interval (default every 5 min; refreshes the data, not the page)

**Performance Notes:**
- Spots are drawn on canvas, and a refresh builds the new layer before removing the old one, so the map never blanks
- Country/continent/zone lookups use a bounding-box prefilter and a per-location cache: on 18,163 spots, 82 s of lookups became 0.38 s on first load and 18 ms on refresh
- Client-side filtering prevents excessive server load

### Bands View (bands.html + bands.js)

One card per band (the Map's band selection, or the six contest bands): Open / Marginal / Closed status
(the last 10 min against the band's busiest 10 min of the past hour), spot count and rate, a 60-min
spot-rate sparkline, the busiest heading and trend, a station-centred direction map (compressed or true
distance; rim bars = spots per heading), and a mini waterfall from the same spectrum channels as the
Waterfall tab, with a CW / DIGI / PHONE strip.

### States View (states.html + states.js)

US states and Canadian provinces heard per band (columns follow the Map's band selection), grouped by call
area, with the missing ones listed and highlighted and a "try <band>" hint (the busiest band toward that
call area). For ARRL Sweepstakes. DC counts with Maryland; full ARRL/RAC sections are not in yet.

### Table View (table_ft.html + table_ft.js)

**Files:** [templates/table_ft.html](templates/table_ft.html), [static/js/table_ft.js](static/js/table_ft.js)

**Features:**
- Matrix display: Regions (rows) × Bands (columns)
- Columns follow the Map's band selection; the six contest bands by default, highest frequency first
- Green highlighting for bands meeting threshold
- Dual-column layout (16 regions in 8 rows)
- Total spot counter

**Region Mapping:**
- Maps CQ zones to 14 geographic regions
- Examples: Europe (zones 14-16,20), North America (zones 1-7,40)
- Optimized for contest operations

**Key Functions:**

- `loadSpots()` - Fetches data from `/tbspots` endpoint
- `buildTable(counts, bands, threshold)` - Generates HTML table
- `getRegionFromCQ(zone)` - Maps CQ zone to region name
- `parseTableTime(t)` - Parses timestamp strings

**Configuration:**
- Threshold: Minimum spots to highlight (default: 1)
- Interval: Last N minutes to display (default: 15)

---

## Database Schema

### MongoDB Collection: `wspr_db.spots`

Each document represents one decoded WSPR/FT8/FT4 spot.

**Schema:**
```javascript
{
  _id: ObjectId("..."),
  callsign: "W1ABC",           // Transmitter callsign
  rx_callsign: "W3USR",        // Receiver callsign
  grid: "FN42hx",              // 6-character Maidenhead grid square
  frequency: 14.097062,        // Frequency in MHz
  band: "20m",                 // Band designation
  mode: "wspr",                // Mode: "wspr", "ft8", or "ft4"
  snr: -15,                    // Signal-to-noise ratio in dB
  drift: 0,                    // Frequency drift in Hz
  date: "260107",              // Date in YYMMDD format
  time: "1430"                 // Time in HHMM UTC format
}
```

**Indexes:**
- Compound index on `(date, time)` for efficient time-based queries
- Index on `mode` for mode-specific queries

**Data Source:**
- Spots are inserted by WSPRDaemon software running on the PSWS receiver
- Typical rate: 10-100 spots per 2-minute WSPR/FT8 cycle
- Database retention: Configurable (typically 30-90 days)

---

## Development Guide

### Project Structure

```
frc_contesting/
├── _archive/                  # Legacy/deprecated code
│   ├── legacy_python/         # Old Flask variants
│   ├── legacy_javascript/     # Old JS implementations
│   └── legacy_templates/      # Old HTML templates
├── routes/                    # Flask route blueprints
│   ├── views.py               # HTML page routes (/, /map, /table, /bands, /states)
│   ├── api.py                 # JSON API routes (/spots, /tbspots, /config, /api/time, /api/spacewx, /api/aurora, /api/psws)
│   ├── waterfall.py           # /waterfall, /api/waterfall and /api/listen/* (relay to the sigmond supervisor)
│   └── skimmer.py             # /skimmer, /api/skimmer, /api/skimmer/band (relay to the sigmond supervisor)
├── services/                  # Backend business logic
│   ├── spots.py               # MongoDB queries & spot processing
│   ├── geo.py                 # CQ zone point-in-polygon lookups
│   ├── spacewx.py             # NOAA SWPC space-weather fetch/cache (optional)
│   └── psws.py                # Local PSWS: hf-timestd Doppler, spot indicators
├── tests/                     # pytest: spacewx and psws services; node: CW/RTTY and FT8/FT4 decoders (no network)
├── utils/                     # Shared utilities
│   └── bands.py               # Frequency → band name conversion
├── static/                    # Frontend assets
│   ├── css/
│   │   └── style.css          # Central dashboard stylesheet
│   ├── img/                   # Marker images
│   ├── js/
│   │   ├── config.js          # Shared JS configuration (band table, modes, regions)
│   │   ├── utils.js           # Shared JS utilities (geo lookups, grids, mode pills, band selection)
│   │   ├── viewstate.js       # Settings in the URL / session (shareable links)
│   │   ├── spot_symbols.js    # Canvas spot symbols (shape = mode)
│   │   ├── solar.js           # Sun position, terminator, twilight
│   │   ├── aeqd.js            # Great-circle (azimuthal equidistant) map projection
│   │   ├── map_ft.js          # Map visualization (Leaflet, symbols, overlays)
│   │   ├── table_ft.js        # Table view (regional band matrix)
│   │   ├── bands.js           # Bands view (per-band cards)
│   │   ├── states.js          # States / provinces view
│   │   ├── waterfall.js       # Waterfall view
│   │   ├── listen.js          # Click-to-listen audio
│   │   ├── decoders.js        # CW and RTTY decoders (pure DSP, browser + Node)
│   │   ├── ft8.js             # FT8/FT4 decoder: port of ft8_lib (MIT), plus live UTC slot slicing
│   │   ├── decode_ui.js       # Live decode panel in the listen bar
│   │   ├── skimmer.js         # Skimmer view (CW skimmer: spectrum, signals, spots)
│   │   ├── spacewx.js         # Space-weather + Local PSWS strip (dashboard header)
│   │   ├── dashboard.js       # Tabs and the address bar
│   │   ├── countries.geojson  # Country boundaries (14MB, for filtering)
│   │   ├── continents.geojson # Continent boundaries (4KB)
│   │   ├── cqzones.geojson    # CQ zones (2.7MB)
│   │   ├── ituzones.geojson   # ITU zones (1.5MB)
│   │   └── turf.min.js        # Geospatial library (591KB)
│   └── vendor/                # Third-party libraries (git-tracked)
│       ├── leaflet/           # Leaflet 1.9.4
│       │   ├── leaflet.js
│       │   ├── leaflet.css
│       │   └── images/        # Marker icons
│       └── basemap/           # Natural Earth offline basemap
│           ├── ne_50m_land.json           # Land mass fill (2.7MB)
│           ├── ne_50m_admin_0_countries.json  # Country borders (4.5MB)
│           └── states-50m.json            # State/province borders (1.6MB)
├── storedb/                   # WSPRDaemon → MongoDB ingestion
│   ├── storedb.sh             # Shell wrapper called by WSPR_LOGGING_CMD
│   └── storedb.py             # Reads decoded spots and upserts into MongoDB
├── templates/                 # Flask HTML templates
│   ├── both.html              # Tabbed dashboard (Map, Table, Bands, States, Waterfall, Skimmer)
│   ├── index_ft.html          # Map view
│   ├── table_ft.html          # Table view
│   ├── bands.html             # Bands view
│   ├── states.html            # States / provinces view
│   ├── waterfall.html         # Waterfall view
│   └── skimmer.html           # Skimmer view
├── app.py                     # Flask application factory (create_app)
├── web-ft.py                  # Thin shim for backwards-compatible startup
├── .env.example               # Environment variable template (copy to .env)
├── CONTRIBUTING.md            # Contribution guidelines
├── OPERATOR_GUIDE.md          # User guide for operators
└── README.md                  # This file
```

### WSPRDaemon Integration

The dashboard receives spot data via a script called by WSPRDaemon after each decode cycle. This is configured with the `WSPR_LOGGING_CMD` variable in `wsprdaemon.conf`.

#### Setup

1. Add the following line to `~/wsprdaemon/wsprdaemon.conf` (in the site-specific section near the top), replacing the path with the actual location of your cloned repo:

   ```bash
   WSPR_LOGGING_CMD="/path/to/frc_contesting/storedb/storedb.sh"
   ```

   For example, if the repo is cloned to `/home/w3usr/frc_contesting`:
   ```bash
   WSPR_LOGGING_CMD="/home/w3usr/frc_contesting/storedb/storedb.sh"
   ```

2. Restart WSPRDaemon to pick up the change:

   ```bash
   wsprdaemon -z && wsprdaemon -A
   ```

#### How it works

After each decode cycle, WSPRDaemon calls [storedb/storedb.sh](storedb/storedb.sh), which activates the virtual environment and runs [storedb/storedb.py](storedb/storedb.py). The Python script reads the decoded spots from `/dev/shm/wsprdaemon/uploads/wsprnet/spots.txt` and upserts them into the `wspr_db.spots` MongoDB collection. Upsert is used to avoid duplicates if the script is called more than once for the same cycle.

Credentials and receiver configuration are read from `.env` — no hardcoded values.

#### Manual test

To verify the integration before restarting WSPRDaemon:

```bash
/path/to/frc_contesting/storedb/storedb.sh
mongosh "mongodb://YOUR_USER:YOUR_PASSWORD@localhost:27017/admin" --eval "db.getSiblingDB('wspr_db').spots.countDocuments()" --quiet
```

### Running the Development Server

```bash
# Activate virtual environment
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Run Flask development server
python web-ft.py

# Server will start at http://localhost:5000
# Debug mode is enabled by default
```

**Access Points:**
- http://localhost:5000/ - Combined view (map + table)
- http://localhost:5000/map - Map view only
- http://localhost:5000/table - Table view only
- http://localhost:5000/spots?lastInterval=15 - Raw JSON data

### Making Code Changes

**Backend Changes (Python):**
- Routes: edit [routes/api.py](routes/api.py) or [routes/views.py](routes/views.py)
- DB queries / spot processing: edit [services/spots.py](services/spots.py)
- App configuration: edit [app.py](app.py)
- Flask auto-reloads in debug mode
- Test API endpoints with curl or browser

**Frontend Changes (JavaScript/HTML):**
- Edit files in `static/` or `templates/`
- Hard refresh browser (Ctrl+F5) to clear cache
- Use browser DevTools Console to debug JavaScript

**Database Changes:**
- Connect to MongoDB: `mongosh "mongodb://$MONGODB_USERNAME:$MONGODB_PASSWORD@$MONGODB_HOST:$MONGODB_PORT"`
- Query spots: `db.spots.find().sort({date: -1, time: -1}).limit(10)`

### Adding New Filters

To add a new client-side filter:

1. **Add UI control** in [templates/index_ft.html](templates/index_ft.html):
   ```html
   <select id="myNewFilter">
     <option value="">All</option>
     <option value="value1">Option 1</option>
   </select>
   ```

2. **Read filter value** in [static/js/map_ft.js](static/js/map_ft.js) `loadSpots()`:
   ```javascript
   const myFilter = document.getElementById("myNewFilter").value;
   ```

3. **Apply filter logic** in the spot rendering loop:
   ```javascript
   if (myFilter && spot.property !== myFilter) {
     return; // Skip this spot
   }
   ```

4. **Persist in session storage** (optional):
   ```javascript
   sessionStorage.setItem("myFilter", myFilter);
   const saved = sessionStorage.getItem("myFilter");
   ```

---

## Deployment

### On a HamSCI sigmond / ka9q-radio station (recommended)

On a station managed by [sigmond](https://github.com/HamSCI/sigmond)
(radiod + wspr-recorder + psk-recorder), two sigmond clients replace the
WSPRDaemon + `storedb` path. `frc-spot-store` copies WSPR/FT8/FT4 spots from
sigmond's sink into MongoDB, and `frc-dashboard` serves this app on port 5000.
MongoDB is installed and secured automatically. See
[sigmond/README.md](sigmond/README.md) for install steps, the field mapping
and operating notes.

### Production Deployment with Gunicorn

Install gunicorn into the virtual environment and run with 4 worker processes, binding to all interfaces:

```bash
source venv/bin/activate
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 "app:create_app()"
```

The dashboard will be accessible at `http://YOUR_IP:5000` from any machine on the network.

### Systemd Service File (autostart on boot)

Create `/etc/systemd/system/frc-dashboard.service`, replacing `YOUR_USER` and `/path/to/frc_contesting` with your actual username and repo path:

```ini
[Unit]
Description=FRC Contesting Dashboard
After=network.target mongod.service

[Service]
User=YOUR_USER
Group=YOUR_USER
WorkingDirectory=/path/to/frc_contesting
Environment="PATH=/path/to/frc_contesting/venv/bin"
ExecStart=/path/to/frc_contesting/venv/bin/gunicorn -w 4 -b 0.0.0.0:5000 "app:create_app()"
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable frc-dashboard
sudo systemctl start frc-dashboard
sudo systemctl status frc-dashboard
```

### Nginx Reverse Proxy

If you want to serve the dashboard on port 80 (or with HTTPS), use nginx as a reverse proxy. Replace `your.hostname.com` with your actual hostname or IP:

```nginx
server {
    listen 80;
    server_name your.hostname.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /static {
        alias /path/to/frc_contesting/static;
        expires 1h;
    }
}
```

### Security Considerations

- **MongoDB Authentication:** Use strong passwords and restrict network access
- **HTTPS:** Use Let's Encrypt certificates for production
- **CORS:** Configure if frontend is served from different domain
- **Rate Limiting:** Implement to prevent API abuse
- **Input Validation:** All user inputs are currently strings, consider validation

---

## Troubleshooting

### Common Issues

#### MongoDB Connection Failed

**Error:** `ServerSelectionTimeoutError: <host>:<port>`

**Solutions:**
- Check MongoDB server is running: `systemctl status mongod`
- Verify network connectivity: `ping $MONGODB_HOST`
- Check firewall rules allow the configured port
- Verify credentials in your `.env` file match the MongoDB server configuration
- Ensure `MONGODB_PASSWORD` environment variable is set

#### No Spots Displayed

**Symptoms:** Map or table shows "Found 0 spots"

**Debugging:**
1. Check raw API response: `curl http://localhost:5000/spots?lastInterval=60`
2. Verify spots exist in database:
   ```javascript
   db.spots.find().sort({date: -1, time: -1}).limit(5)
   ```
3. Check time filtering - database stores UTC times
4. Verify receiver is actively decoding (check WSPRDaemon logs)

#### GeoJSON Files Not Loading

**Error (Console):** `Failed to load countries.geojson`

**Solutions:**
- Verify files exist in `static/js/` directory
- Check file permissions (readable by web server)
- Look for CORS errors in browser console
- Verify Flask static folder is configured correctly

#### Markers Not Appearing

**Symptoms:** Map loads but no TX star markers visible

**Debugging:**
1. Check browser console for JavaScript errors
2. Verify Leaflet.ExtraMarkers library loaded: `L.ExtraMarkers`
3. Check marker image files exist in `static/img/`
4. Verify band color mapping includes all bands in data

#### Invalid Grid Squares

**Error:** `maidenhead.to_location() exception`

**Cause:** Database contains malformed grid squares

**Solutions:**
- Backend catches exception and defaults to (0, 0)
- To identify bad grids:
  ```python
  import maidenhead
  for doc in collection.find():
      try:
          maidenhead.to_location(doc['grid'])
      except:
          print(f"Invalid grid: {doc['grid']} from {doc['callsign']}")
  ```

#### lastInterval Not Syncing Between Map and Table

**Symptoms:** Changing the time interval in the map view doesn't update the table, or vice versa

**Cause:** The map (`/map`) and table (`/table`) run in separate iframes — each iframe has isolated `sessionStorage`. Changes in one are not automatically visible to the other.

**Solution (implemented):** Both views write `lastInterval` to `localStorage` in addition to `sessionStorage`. A `storage` event listener in each view detects changes made by the other frame and immediately updates its input and reloads data. This is bidirectional — either view can drive the other.

#### Session Storage Not Persisting

**Symptoms:** Filters reset on page reload

**Solutions:**
- Check browser allows session storage (not in incognito mode)
- Verify JavaScript console for storage quota errors
- Clear browser cache and try again
- Check session storage in DevTools → Application → Session Storage

### Performance Optimization

**Slow Map Loading:**
- GeoJSON files are large (~18MB total)
- Consider using CDN for GeoJSON files
- Implement caching headers in nginx
- Use compressed versions (.geojson.gz)

**High Memory Usage:**
- Leaflet keeps all markers in memory
- For >1000 spots, consider marker clustering:
  ```javascript
  var markers = L.markerClusterGroup();
  ```

**Slow Database Queries:**
- Add compound index on (date, time):
  ```javascript
  db.spots.createIndex({date: -1, time: -1})
  ```
- Consider materialized views for table data

---

## Additional Resources

### Related Documentation

- [Requirements Document](docs/REQUIREMENTS.md) - Formal requirements specification
- [Claude AI Assistance Documentation](CLAUDE.md) - AI contribution history and guidelines
- [Operator Guide](OPERATOR_GUIDE.md) - User guide for radio operators
- [Contributing Guide](CONTRIBUTING.md) - Developer contribution guidelines
- [Archive Documentation](_archive/README.md) - Legacy code reference
- [HamSCI Workshop 2025 Poster](docs/references/Ruzankski,%20Owen%20-%20FRC_W3USR_POSTER%20-%20HamSCI%20Workshop%202025.pdf) - Project overview and goals
- [FRC Proposal](docs/references/20250123%20FRC%20Proposal.pdf) - Detailed project proposal

### External Documentation

- [WSPRDaemon Documentation](http://wsprdaemon.org/) - PSWS software
- [Leaflet Documentation](https://leafletjs.com/reference.html) - Map library API
- [Turf.js Documentation](https://turfjs.org/) - Geospatial analysis library

### Amateur Radio Resources

- **CQ Zones Map:** http://www.cqmaps.com/zones.htm
- **ITU Zones Map:** http://www.dxmaps.com/ituzone.html
- **WSPR Activity:** https://wsprnet.org/
- **PSK Reporter:** https://pskreporter.info/
- **Reverse Beacon Network:** http://reversebeacon.net/

### Development Resources

- **Maidenhead Grid Converter:** https://www.levinecentral.com/ham/grid_square.php
- **Amateur Radio Band Plan:** http://www.arrl.org/band-plan
- **HamSCI Community:** https://hamsci.org/
- **TAPR (Tucson Amateur Packet Radio):** https://www.tapr.org/

---

## License and Acknowledgments

### Funding and Support

This project is supported by:
- Frankford Radio Club (FRC)
- NSF Grants AGS-2432822, AGS-2432824, and AGS-2432823
- Amateur Radio Digital Communications (ARDC)
- HamSCI Community
- WSPRDaemon and TAPR Communities

### Software License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.

### Acknowledgments

Special thanks to:
- Dr. Nathaniel Frissell (W2NAF) - Project advisor
- Ray Sokola (K9RS) - Frankford Radio Club mentor
- Bud Trench (AA3B) - Frankford Radio Club mentor
- Phil Karn (KA9Q) - KA9Q-radio software
- Rob Robinett (AI6VN) - WSPRDaemon software
- University of Scranton W3USR Amateur Radio Club

---

## Contact Information

**Project Authors:**
- Owen Ruzanski (KD3ALD) - owen.ruzanski@scranton.edu
- Liam Miller (KD3BVX)
- Nathaniel Frissell (W2NAF)

**Faculty Advisor:**
Dr. Nathaniel Frissell (W2NAF)
University of Scranton, Department of Physics/Engineering

---

*Last updated March 2026 as part of the HamSCI PSWS Dashboard Development project.*
