# HamSCI Contesting and DXing Dashboard
## Requirements Document

**Version:** 1.0
**Date:** January 22, 2026
**Status:** Initial Draft

---

## 1. Introduction

### 1.1 Purpose

This document defines the requirements for a real-time web-based dashboard for amateur radio HF contesting, DXing, and general operations using data from the HamSCI Personal Space Weather Station (PSWS). The dashboard will enable amateur radio operators to optimize their transmissions based on real-time ionospheric conditions by visualizing propagation data from WSPR, FT8, and FT4 digital mode reception.

### 1.2 Background

The HamSCI Personal Space Weather Station is a multi-instrument system designed to measure space weather for both scientific research and amateur radio operations. While most PSWS development efforts have focused on scientific objectives, this project aims to make the data available and useful in real time for amateur radio operators. The core of the system is the RX-888/KA9Q-radio WSPRDaemon-Grape HF software-defined radio (SDR), capable of capturing and analyzing signals across the 0.3-30 MHz range simultaneously.

**Key References:**
- [HamSCI Workshop 2025 Poster](docs/references/Ruzankski,%20Owen%20-%20FRC_W3USR_POSTER%20-%20HamSCI%20Workshop%202025.pdf) - Project overview and goals
- [FRC Proposal](docs/references/20250123%20FRC%20Proposal.pdf) - Detailed project proposal
- [HamSCI PSWS Project](https://hamsci.org/) - Community and scientific background
- [WSPRDaemon Database](http://wsprdaemon.org/) - Data aggregation system

### 1.3 Scope

This requirements document covers the web-based dashboard component for displaying and analyzing HF propagation data. It does not cover:
- Hardware modifications to the PSWS receiver system
- Changes to WSPRDaemon or KA9Q-radio software
- Modifications to the MongoDB database schema (inherited from WSPRDaemon)
- Central network aggregation infrastructure (future consideration)

**Critical Design Requirement:** The dashboard must operate entirely on a local area network (LAN) without requiring internet connectivity. This is essential for deployments at remote contest stations, field operations, and emergency communications where internet access is unavailable or unreliable. All assets, libraries, and data files must be self-contained within the deployment.

---

## 2. System Overview

### 2.1 Current Architecture

```
┌─────────────────────────────────────────────┐
│            PSWS Receiver Node               │
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

### 2.2 Data Format

MongoDB `wspr_db.spots` collection stores each decoded spot:

```javascript
{
  _id: ObjectId("..."),
  callsign: "W1ABC",           // Transmitter callsign
  rx_callsign: "W2XYZ",        // Receiver callsign
  grid: "FN42hx",              // 6-character Maidenhead grid
  frequency: 14.097062,        // Frequency in MHz
  band: "20m",                 // Band designation
  mode: "wspr",                // Mode: "wspr", "ft8", or "ft4"
  snr: -15,                    // Signal-to-noise ratio in dB
  drift: 0,                    // Frequency drift in Hz
  date: "260107",              // Date in YYMMDD format
  time: "1430"                 // Time in HHMM UTC format
}
```

### 2.3 System Specifications

| Parameter | Value |
|-----------|-------|
| Frequency Range | 0.3-30 MHz (all HF bands) |
| Sample Rate | 30 MHz bandwidth (simultaneous) |
| Supported Modes | WSPR, FT8, FT4 |
| Update Cycles | WSPR: 2 min, FT8: 15 sec, FT4: 7.5 sec |
| Typical Spot Rate | 10-100 spots per 2-minute cycle |
| Geographic Coverage | Worldwide (ionospheric propagation dependent) |

---

## 3. Functional Requirements

### Requirement Levels

This document uses the following keywords to indicate requirement levels, as defined in RFC 2119:

- **SHALL** (Priority: Must) - Indicates an absolute requirement. The feature must be implemented for the system to be considered complete.
- **SHOULD** (Priority: Should) - Indicates a recommended requirement. The feature is highly desirable and should be implemented unless there are compelling reasons not to do so.
- **MAY** (Priority: May) - Indicates an optional requirement. The feature is truly optional and may be included or omitted at the implementer's discretion.

### 3.1 Core Operator Questions

The dashboard SHALL answer the following key questions that amateur radio operators need:

| ID | Question | Priority |
|----|----------|----------|
| FR-Q-01 | What bands are open and where are they open to? | Must |
| FR-Q-02 | When did they open/close? | Must |
| FR-Q-03 | What is the current Maximum Usable Frequency (MUF)? | Should |
| FR-Q-04 | Which band has the most activity? | Must |
| FR-Q-05 | What direction are signals coming from? | Must |
| FR-Q-06 | Is [specific band] open to [specific region]? | Must |

### 3.2 Data Visualization - Map View

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-MAP-01 | The system SHALL display an interactive world map showing propagation paths | Must |
| FR-MAP-02 | The system SHALL render transmitter locations as colored star markers where color indicates band | Must |
| FR-MAP-03 | The system SHALL draw lines connecting transmitter and receiver locations | Must |
| FR-MAP-04 | The system SHALL display receiver location with distinctive marker | Must |
| FR-MAP-05 | The system SHALL support zoom and pan operations on the map | Must |
| FR-MAP-06 | The system SHALL display clickable markers with spot details (callsign, SNR, frequency, time, mode) | Must |
| FR-MAP-07 | The system SHALL display a real-time spot counter by band | Must |
| FR-MAP-08 | The system SHOULD display CQ zone boundaries with zone numbers as an optional overlay | Should |
| FR-MAP-09 | The system MAY display ITU zone boundaries as an optional overlay | May |

### 3.3 Data Visualization - Table View

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-TBL-01 | The system SHALL display a matrix of regions (rows) by bands (columns) | Must |
| FR-TBL-02 | The system SHALL show spot counts for each region-band combination | Must |
| FR-TBL-03 | The system SHALL highlight cells with active propagation (threshold-based) | Must |
| FR-TBL-04 | The system SHALL focus on the 6 contest bands (160m, 80m, 40m, 20m, 15m, 10m) by default | Must |
| FR-TBL-05 | The system SHALL map CQ zones to geographic regions | Must |
| FR-TBL-06 | The system SHALL display total spot counter | Must |
| FR-TBL-07 | The system SHOULD use dual-column layout for compact display | Should |

### 3.4 Filtering and Search

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-FLT-01 | The system SHALL support time-based filtering (last N minutes) | Must |
| FR-FLT-02 | The system SHALL support band filtering (all bands, individual bands, contest bands) | Must |
| FR-FLT-03 | The system SHALL support country filtering including "Non-US" option | Must |
| FR-FLT-04 | The system SHALL support continent filtering | Must |
| FR-FLT-05 | The system SHALL support CQ zone filtering (zones 1-40) | Must |
| FR-FLT-06 | The system SHALL support ITU zone filtering (zones 1-90) | Must |
| FR-FLT-07 | The system SHALL support mode filtering (WSPR/FT8/FT4 checkboxes) | Must |
| FR-FLT-08 | The system SHALL persist filter settings using session storage | Must |
| FR-FLT-09 | The system SHALL perform filtering client-side for performance | Must |

### 3.5 Real-Time Updates

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-RT-01 | The system SHALL support configurable auto-reload intervals (2-30 minutes) | Must |
| FR-RT-02 | The system SHALL display last update timestamp | Must |
| FR-RT-03 | The system SHALL query only spots within the specified time window | Must |
| FR-RT-04 | The system SHOULD preserve user filter settings across reloads | Should |

### 3.6 Geographic Data Processing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-GEO-01 | The system SHALL convert Maidenhead grid squares to latitude/longitude coordinates | Must |
| FR-GEO-02 | The system SHALL perform point-in-polygon lookups for country identification | Must |
| FR-GEO-03 | The system SHALL perform point-in-polygon lookups for CQ zone identification | Must |
| FR-GEO-04 | The system SHALL perform point-in-polygon lookups for ITU zone identification | Must |
| FR-GEO-05 | The system SHALL load GeoJSON boundary files for countries, continents, CQ zones, and ITU zones | Must |
| FR-GEO-06 | The system SHALL handle invalid or malformed grid squares gracefully | Must |

### 3.7 Data Export and Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-EXP-01 | The system SHALL provide JSON API endpoints for programmatic access | Must |
| FR-EXP-02 | The system SHALL support raw JSON data export via browser | Must |
| FR-EXP-03 | The system SHOULD support CSV export for analysis tools | Should |
| FR-EXP-04 | The system SHOULD support integration with external data sources (Reverse Beacon Network, PSK Reporter, DX Cluster) | Should |
| FR-EXP-05 | The system MAY support N1MM+ Logger integration via UDP or external dashboard program | May |

### 3.8 User Interface

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-UI-01 | The system SHALL provide three view modes: map-only, table-only, and combined | Must |
| FR-UI-02 | The system SHALL use consistent band color coding across all views | Must |
| FR-UI-03 | The system SHALL display connection status indicators | Must |
| FR-UI-04 | The system SHOULD provide clear visual feedback for filter changes | Should |
| FR-UI-05 | The system SHOULD be usable on tablets and desktop browsers | Should |
| FR-UI-06 | The system MAY support light and dark themes | May |

### 3.9 Offline and Local Network Operation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-OFF-01 | The system SHALL function completely without internet access | Must |
| FR-OFF-02 | The system SHALL support local-network-only deployments (LAN-only operation) | Must |
| FR-OFF-03 | The system SHALL vendor all JavaScript libraries locally (no CDN dependencies) | Must |
| FR-OFF-04 | The system SHALL vendor all CSS frameworks and stylesheets locally | Must |
| FR-OFF-05 | The system SHALL include all GeoJSON boundary files in the repository | Must |
| FR-OFF-06 | The system SHALL include all icon and image assets locally | Must |
| FR-OFF-07 | The system SHALL NOT require external API calls for core functionality | Must |
| FR-OFF-08 | The system SHALL operate when only MongoDB and Flask server are accessible | Must |

**Rationale:** The dashboard must be deployable at remote ham radio contest stations, field day sites, or emergency operations centers where internet access may be unreliable, restricted, or unavailable. All functionality must work with only local network connectivity between the browser, Flask server, and MongoDB database.

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-PERF-01 | The system SHALL render map updates within 2 seconds of data receipt | Must |
| NFR-PERF-02 | The system SHALL handle at least 1000 spots without performance degradation | Must |
| NFR-PERF-03 | The system SHALL load GeoJSON files asynchronously to prevent UI blocking | Must |
| NFR-PERF-04 | Client-side filtering SHOULD complete within 500ms for typical datasets | Should |
| NFR-PERF-05 | Initial page load SHOULD complete within 5 seconds on broadband connection | Should |

### 4.2 Scalability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-SCALE-01 | The system SHOULD support multiple concurrent users | Should |
| NFR-SCALE-02 | The system SHOULD handle database queries with date/time indexes for efficiency | Should |
| NFR-SCALE-03 | The system MAY support database retention policies (30-90 days) | May |

### 4.3 Compatibility

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-COMPAT-01 | The system SHALL support modern versions of Chrome, Firefox, Safari, and Edge | Must |
| NFR-COMPAT-02 | The system SHALL run on Linux x86 servers (Mini PC hardware) | Must |
| NFR-COMPAT-03 | The system SHALL support Python 3.8 or higher | Must |
| NFR-COMPAT-04 | The system SHALL work with MongoDB 4.x or higher | Must |

### 4.4 Security

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-SEC-01 | The system SHALL use environment variables for credential management | Must |
| NFR-SEC-02 | The system SHALL never commit credentials to version control | Must |
| NFR-SEC-03 | The system SHOULD support HTTPS for internet-facing deployments | Should |
| NFR-SEC-04 | The system SHOULD implement CORS policies if frontend is served from different domain | Should |
| NFR-SEC-05 | The system MAY implement rate limiting to prevent API abuse | May |
| NFR-SEC-06 | The system MAY support optional authentication for remote access | May |

### 4.5 Maintainability

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-MAINT-01 | Code SHALL include inline comments explaining complex logic | Must |
| NFR-MAINT-02 | The system SHALL use standard, widely-adopted technologies | Must |
| NFR-MAINT-03 | The system SHALL follow consistent coding style | Must |
| NFR-MAINT-04 | The system SHOULD include operator and developer documentation | Should |
| NFR-MAINT-05 | The system MAY include automated tests for critical functionality | May |

### 4.6 Deployment

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-DEPLOY-01 | The system SHALL be deployable via simple command-line invocation | Must |
| NFR-DEPLOY-02 | The system SHALL include clear installation documentation | Must |
| NFR-DEPLOY-03 | The system SHALL provide example environment configuration (.env.example) | Must |
| NFR-DEPLOY-04 | The system SHOULD support systemd service deployment | Should |
| NFR-DEPLOY-05 | The system SHOULD support nginx reverse proxy configuration | Should |
| NFR-DEPLOY-06 | The system MAY support containerized deployment (Docker) | May |

---

## 5. Technical Constraints

### 5.1 Inherited System Components

The dashboard must integrate with existing PSWS infrastructure:

**Hardware:**
- RX-888 MkII HF SDR Receiver (30 MHz bandwidth)
- Leo Bodnar Mini GPS Disciplined Oscillator
- Linux x86 Mini PC Server

**Software:**
- KA9Q-radio (multichannel SDR software)
- WSPRDaemon (WSPR/FT8/FT4 decoder and database uploader)
- MongoDB (database with existing schema)

**Data Format:**
- MongoDB schema defined by WSPRDaemon (cannot be modified)
- Time format: YYMMDD HHMM UTC
- Grid format: 6-character Maidenhead

### 5.2 Technology Stack

**Backend:**
- Python 3.x
- Flask 2.x (web framework)
- PyMongo 4.x (MongoDB driver)
- Supporting libraries: maidenhead, geopandas, shapely, geopy

**Frontend:**
- HTML5/CSS3
- JavaScript (ES6+)
- Leaflet.js (interactive maps)
- Leaflet.ExtraMarkers (custom markers)
- Turf.js (geospatial analysis)

**Data Files:**
- GeoJSON boundary files (~18MB total)
- All assets SHALL be vendored locally (no external CDN dependencies)
- All JavaScript libraries SHALL be included in the repository (Leaflet.js, Turf.js, etc.)
- All CSS stylesheets SHALL be included locally
- All marker icons and images SHALL be included locally

**Critical Constraint:** The system MUST operate without any internet connectivity beyond the local LAN. No external network requests of any kind are permitted for core functionality.

### 5.3 Geographic Data Requirements

The system requires the following GeoJSON files:
- `countries.geojson` (14MB) - Country boundaries for filtering
- `continents.geojson` (4KB) - Continent boundaries
- `cqzones.geojson` (2.7MB) - CQ zone polygons (40 zones)
- `ituzones.geojson` (1.5MB) - ITU zone polygons (90 zones)

---

## 6. User Stories

### 6.1 Contest Operator

> **As a** contest operator during CQWW DX Contest,
> **I want to** see which bands are currently open to Europe,
> **so that** I can maximize my rate and work new multipliers.

### 6.2 DX Chaser

> **As a** DX enthusiast,
> **I want to** monitor propagation to specific countries in real-time,
> **so that** I can catch band openings to rare entities.

### 6.3 Band Activity Monitor

> **As a** casual operator,
> **I want to** see which band has the most activity right now,
> **so that** I can decide where to call CQ.

### 6.4 Propagation Researcher

> **As a** space weather enthusiast,
> **I want to** observe how propagation changes throughout the day,
> **so that** I can understand ionospheric behavior and plan future operations.

### 6.5 Multi-Station Coordinator

> **As a** multi-operator contest station captain,
> **I want to** display the dashboard on monitors visible to all operators,
> **so that** band change decisions can be made collaboratively based on real data.

### 6.6 Regional Propagation Analyst

> **As an** operator in a specific geographic region,
> **I want to** see propagation from my local PSWS receiver,
> **so that** I have site-specific propagation information rather than global averages.

---

## 7. Future Considerations

The following features are explicitly out of scope for the initial implementation but should be considered for future development:

### 7.1 Network Features

1. **Multi-Station Aggregation:** Display data from multiple PSWS receivers
2. **Network Map View:** Geographic visualization of all active PSWS nodes
3. **Station Comparison:** Compare propagation between different receiver locations
4. **Central Database Integration:** Connection to HamSCI PSWS Database (http://psws.hamsci.org)

### 7.2 Advanced Analysis

5. **MUF Calculation:** Automatic Maximum Usable Frequency estimation from spot data
6. **Opening/Closing Detection:** Alert system for band opening and closing events
7. **Historical Trends:** Display propagation patterns over days/weeks
8. **Spectral Analysis:** FFT spectrograms for HF Doppler monitoring
9. **Machine Learning Predictions:** Train models on historical data to predict openings

### 7.3 External Integrations

**Note:** All external integrations must be optional features that gracefully degrade when internet access is unavailable. Core dashboard functionality must never depend on external network connectivity.

10. **Reverse Beacon Network (RBN):** Integrate CW skimmer data (optional, internet required)
11. **PSK Reporter:** Merge with global digital mode reports (optional, internet required)
12. **DX Cluster:** Real-time DX spot integration (optional, internet required)
13. **Space Weather Data:** Solar flux, K-index, aurora alerts (optional, internet required)
14. **VOACAP Integration:** Compare predictions with actual measurements (optional, internet required)
15. **HFDL/WWV Doppler:** Integrate with other PSWS instruments (local network, no internet required)

### 7.4 Operator Tools

16. **N1MM+ Logger Plugin:** Direct integration with contest logging software
17. **Band Recommendation Engine:** Suggest best band for target location
18. **Alert System:** Browser notifications for specific conditions
19. **Mobile App:** Native iOS/Android applications
20. **Antenna Diversity:** Support for multiple receive antennas for azimuth/elevation data

---

## 8. Acceptance Criteria

The dashboard will be considered complete when:

- [ ] Real-time map view displays WSPR/FT8/FT4 spots with colored band markers
- [ ] Table view shows spot counts by region and contest band
- [ ] All filtering options work correctly (time, band, country, continent, CQ zone, ITU zone, mode)
- [ ] Filter settings persist across page reloads using session storage
- [ ] Geographic lookups correctly identify country, continent, CQ zone, and ITU zone
- [ ] Auto-reload functionality works at configurable intervals (2-30 minutes)
- [ ] JSON API endpoints provide programmatic access to spot data
- [ ] System handles at least 1000 spots without performance issues
- [ ] **System operates completely offline with only LAN connectivity (no internet required)**
- [ ] **All JavaScript libraries, CSS, GeoJSON files, and assets are vendored locally**
- [ ] **Browser network inspection confirms zero external HTTP/HTTPS requests**
- [ ] Documentation includes installation guide, operator guide, and API reference
- [ ] System runs successfully on Linux Mini PC with PSWS
- [ ] Credentials are managed via environment variables (never committed to git)
- [ ] Dashboard tested during at least one major contest (ARRL DX, CQWW, etc.)

---

## 9. Open Questions

The following items require team discussion and decisions:

### 9.1 Technical Decisions

1. **Database Retention:** What is the optimal retention period for spot data? (30 days? 90 days?)
2. **Query Optimization:** Should we create additional MongoDB indexes beyond date/time?
3. **Caching Strategy:** Should we implement Redis or similar for API response caching?
4. **WebSocket Support:** Would WebSocket connections improve real-time updates vs. polling?

### 9.2 Feature Priorities

5. **MUF Calculation:** What algorithm should be used for automatic MUF estimation?
6. **Alert System:** What triggers should be configurable (band opening, specific country spotted, SNR threshold)?
7. **External Data:** Which external data source is highest priority (RBN, PSK Reporter, or DX Cluster)? Note: All external data integrations MUST be optional features that gracefully degrade when internet is unavailable.
8. **N1MM+ Integration:** Should this be a plugin, UDP broadcast, or external dashboard program?

### 9.3 User Experience

9. **Default View:** Should the default landing page be map, table, or combined view?
10. **Mobile Optimization:** Should we prioritize tablet/mobile layout or focus on desktop-only?
11. **Theme Support:** Is dark mode important for contest operators (often operating at night)?
12. **Audio Alerts:** Should the dashboard play sounds for band openings or specific conditions?

### 9.4 Deployment

13. **Multi-Station Support:** Should a single dashboard instance support multiple receiver configurations?
14. **Authentication:** Is authentication needed for local station use, or only for internet-facing deployments?
15. **Bandwidth Concerns:** Are the 18MB GeoJSON files acceptable, or should we pre-process to smaller formats?

---

## 10. References

### 10.1 Project Documents

1. Ruzanski, O., Frissell, N., Sokola, R., & Trench, B. (2025). "Development of a Contesting and DXing Dashboard for the HamSCI Personal Space Weather Station." HamSCI Workshop 2025 Poster. [PDF](docs/references/Ruzankski,%20Owen%20-%20FRC_W3USR_POSTER%20-%20HamSCI%20Workshop%202025.pdf)

2. Frissell, N. A. (2025). "Development of a Contesting and DXing Dashboard for the HamSCI Personal Space Weather Station: Project Proposal to the Frankford Radio Club." [PDF](docs/references/20250123%20FRC%20Proposal.pdf)

### 10.2 PSWS and HamSCI Publications

3. Collins, K., Gibbons, J., Frissell, N., et al. (2023). "Crowdsourced doppler measurements of time standard stations demonstrating ionospheric variability." *Earth System Science Data*, 15(3), 1403–1418. https://doi.org/10.5194/essd-15-1403-2023

4. Frissell, N. A., Ackermann, J. R., Alexander, J. N., et al. (2023). "Heliophysics and amateur radio: citizen science collaborations for atmospheric, ionospheric, and space physics research and operations." *Frontiers in Astronomy and Space Sciences*, 10. https://doi.org/10.3389/fspas.2023.1184171

5. Gibbons, J., Collins, K., Kazdan, D., & Frissell, N. (2022). "Grape Version 1: First prototype of the low-cost personal space weather station receiver." *HardwareX*, 11, e00289. https://doi.org/10.1016/J.OHX.2022.E00289

6. Kim, H., Witten, D., Madey, J., Frissell, N., et al. (2024). "Citizen science: Development of a low-cost magnetometer system for a coordinated space weather monitoring." *HardwareX*, 20, e00580. https://doi.org/10.1016/j.ohx.2024.e00580

### 10.3 External Resources

7. HamSCI Community: https://hamsci.org/
8. WSPRDaemon Database: http://wsprdaemon.org/
9. KA9Q-radio Software: https://github.com/ka9q/ka9q-radio
10. Leaflet Documentation: https://leafletjs.com/reference.html
11. Turf.js Documentation: https://turfjs.org/
12. WSPR.rocks Mapping Website: https://wspr.rocks/
13. PSK Reporter: https://pskreporter.info/
14. Reverse Beacon Network: http://reversebeacon.net/

---

## 11. Document History

| Version | Date | Timestamp | Author | LLM Model | Changes |
|---------|------|-----------|--------|-----------|---------|
| 1.0 | January 22, 2026 | 2026-01-22T20:00:00Z | Nathaniel Frissell | Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) | Initial requirements document created from existing README, operator guide, workshop poster, and FRC proposal |

---

## 12. Acknowledgments

This requirements document was prepared with assistance from Claude (Anthropic) using Claude Sonnet 4.5 (model: claude-sonnet-4-5-20250929), which helped synthesize information from the existing codebase, HamSCI Workshop 2025 poster, FRC proposal, and operator documentation into a structured requirements format.

**Project Support:**
- Frankford Radio Club (FRC) - Funding and mentorship
- NSF Grants AGS-2432822, AGS-2432824, and AGS-2432823
- Amateur Radio Digital Communications (ARDC)
- HamSCI Community
- WSPRDaemon and TAPR Communities

**Key Contributors:**
- Owen Ruzanski (KD3ALD) - Lead developer
- Liam Miller (KD3BVX) - Co-developer
- Dr. Nathaniel Frissell (W2NAF) - Faculty advisor
- Ray Sokola (K9RS) - FRC mentor
- Bud Trench (AA3B) - FRC mentor
- Phil Karn (KA9Q) - KA9Q-radio software
- Rob Robinett (AI6VN) - WSPRDaemon software

---

*This document is intended as a foundation for continued development. All requirements should be reviewed and prioritized by the development team and stakeholders before implementation begins.*
