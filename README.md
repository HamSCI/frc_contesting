# HamSCI Contesting and DXing Dashboard

**Authors:** Owen Ruzanski (KD3ALD), Liam Miller (KD3BVX), Nathaniel Frissell (W2NAF)
**Organization:** University of Scranton (W3USR), Frankford Radio Club
**Project:** HamSCI Personal Space Weather Station Dashboard Development
**Last Updated:** January 2026

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

- **Real-time propagation visualization** on an interactive world map
- **Band-specific filtering** for all amateur radio HF bands (160m-10m)
- **Geographic filtering** by country, continent, CQ zone, and ITU zone
- **Mode filtering** supporting WSPR, FT8, and FT4
- **Tabular view** showing band openings by geographic region
- **Auto-reload capability** with configurable intervals
- **Contest bands mode** focusing on the 6 primary contest bands
- **Session persistence** for filter settings across page reloads

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
- Leaflet.js (interactive maps)
- [Leaflet.ExtraMarkers](https://github.com/coryasilva/Leaflet.ExtraMarkers) (custom marker icons)
- Turf.js (geospatial analysis)

**Data Sources:**
- MongoDB database running WSPRDaemon
- GeoJSON boundary files (countries, continents, CQ zones, ITU zones)

### Architecture Diagram

```
┌─────────────────────────────────────────────┐
│         PSWS Receiver (KD3ALD)              │
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
│       Flask Backend (web-ft.py)             │
│  Routes:                                     │
│    /          → both.html (combined view)   │
│    /map       → index_ft.html (map)         │
│    /table     → table_ft.html (table)       │
│    /spots     → JSON API (map data)         │
│    /tbspots   → JSON API (table data)       │
└─────────────────┬───────────────────────────┘
                  │
                  ↓
┌─────────────────────────────────────────────┐
│         Frontend JavaScript                 │
│  ┌──────────────┐  ┌───────────────┐       │
│  │  map_ft.js   │  │  table_ft.js  │       │
│  │  (730 lines) │  │  (183 lines)  │       │
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
2. **Storage:** Spots written to MongoDB with metadata (callsign, grid, frequency, SNR, time, mode)
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
- MongoDB 4.x or higher (with WSPRDaemon database)
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

### GeoJSON Data Files

The following GeoJSON files must be present in `static/js/`:

- `countries.geojson` (14MB) - Country boundaries
- `continents.geojson` (4KB) - Continent boundaries
- `cqzones.geojson` (2.7MB) - CQ zone polygons (40 zones)
- `ituzones.geojson` (1.5MB) - ITU zone polygons (90 zones)

These files are included in the repository.

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

### Receiver Station Configuration

Update the receiver callsign and grid square in:

**Backend** ([web-ft.py](web-ft.py#L198)):
```python
rxlat, rxlon = maidenhead.to_location("FN21ni")  # Change to your grid
```

**Frontend Table View** ([static/js/table_ft.js](static/js/table_ft.js#L39)):
```javascript
const call = "KD3ALD"  // Change to your callsign
```

**Frontend Map View** ([static/js/map_ft.js](static/js/map_ft.js#L491)):
```javascript
title.textContent = `WSPR Spots From ${spot.rx_sign} PSWS Receiver`
```

### Band Color Configuration

Band colors are defined in [static/js/map_ft.js](static/js/map_ft.js#L210-L226):

```javascript
const bandColorMap = {
  '160m': 'black',
  '80m': 'red',
  '40m': 'orange',
  '20m': 'green',
  '15m': 'cyan',
  '10m': 'blue-dark',
  // ... etc
};
```

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
    "rx_sign": "KD3ALD",
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

---

## Frontend Components

### Map View (index_ft.html + map_ft.js)

**Files:** [templates/index_ft.html](templates/index_ft.html), [static/js/map_ft.js](static/js/map_ft.js)

**Features:**
- Interactive Leaflet map centered at lat 20°, lon 0°
- Band-specific colored star markers
- Polylines connecting TX and RX stations
- Clickable markers with spot details
- Real-time spot counter by band (bottom-right)
- CQ zone outline overlay with zone labels

**Filtering Controls:**
- Time interval (last N minutes)
- Band selection (all bands or contest bands only)
- Country filter (including "Non-US" option)
- Continent filter
- CQ zone filter (1-40)
- ITU zone filter (1-90)
- Mode checkboxes (WSPR/FT8/FT4)
- CQ zone outline toggle
- Auto-reload interval (2-30 minutes)

**Key Functions:**

- `loadSpots()` - Main function that fetches and renders spots
- `lookupCountry(lat, lon)` - Point-in-polygon country lookup
- `lookupCqZone(lat, lon)` - CQ zone identification
- `frequencyToBand(freq)` - Converts MHz to band name
- `parseWsprTime(str)` - Parses "YYMMDD HHMM" to ISO format

**Performance Notes:**
- Loads large GeoJSON files asynchronously (~18MB total)
- Client-side filtering prevents excessive server load
- Session storage preserves filter state

### Table View (table_ft.html + table_ft.js)

**Files:** [templates/table_ft.html](templates/table_ft.html), [static/js/table_ft.js](static/js/table_ft.js)

**Features:**
- Matrix display: Regions (rows) × Bands (columns)
- Shows spot counts for 6 contest bands only
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
  rx_callsign: "KD3ALD",       // Receiver callsign
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
├── static/                    # Frontend assets
│   ├── css/
│   │   └── style.css          # Custom styles
│   ├── img/                   # Marker images
│   └── js/
│       ├── map_ft.js          # Map visualization (730 lines)
│       ├── table_ft.js        # Table view (183 lines)
│       ├── chart.js           # Spot counting (98 lines)
│       ├── countries.geojson  # Country boundaries (14MB)
│       ├── continents.geojson # Continent boundaries (4KB)
│       ├── cqzones.geojson    # CQ zones (2.7MB)
│       ├── ituzones.geojson   # ITU zones (1.5MB)
│       └── turf.min.js        # Geospatial library (591KB)
├── templates/                 # Flask HTML templates
│   ├── both.html              # Combined map + table view
│   ├── index_ft.html          # Map view
│   ├── table_ft.html          # Table view
│   └── index_wcount.html      # Alternative display with counter
├── web-ft.py                  # Main Flask app (WSPR+FT8+FT4)
├── CONTRIBUTING.md            # Contribution guidelines
├── OPERATOR_GUIDE.md          # User guide for operators
└── README.md                  # This file
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
- Edit [web-ft.py](web-ft.py)
- Flask auto-reloads in debug mode
- Test API endpoints with curl or browser

**Frontend Changes (JavaScript/HTML):**
- Edit files in `static/` or `templates/`
- Hard refresh browser (Ctrl+F5) to clear cache
- Use browser DevTools Console to debug JavaScript

**Database Changes:**
- Connect to MongoDB: `mongo --host $MONGODB_HOST --port $MONGODB_PORT -u $MONGODB_USERNAME -p`
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

### Production Deployment with Gunicorn

```bash
# Install gunicorn
pip install gunicorn

# Run with 4 worker processes
gunicorn -w 4 -b 0.0.0.0:5000 web-ft:app

# Or with systemd service
sudo systemctl start hamsci-dashboard
```

### Systemd Service File

Create `/etc/systemd/system/hamsci-dashboard.service`:

```ini
[Unit]
Description=HamSCI Contesting Dashboard
After=network.target

[Service]
User=hamsci
Group=hamsci
WorkingDirectory=/opt/hamsci-dashboard
Environment="PATH=/opt/hamsci-dashboard/venv/bin"
ExecStart=/opt/hamsci-dashboard/venv/bin/gunicorn -w 4 -b 0.0.0.0:5000 web-ft:app

[Install]
WantedBy=multi-user.target
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name dash.kd3ald.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /static {
        alias /opt/hamsci-dashboard/static;
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

**Symptoms:** Polylines visible but no TX markers

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

**Dashboard URL:**
http://dash.kd3ald.com (when operational)

---

*Last updated January 2026 as part of the HamSCI PSWS Dashboard Development project.*
