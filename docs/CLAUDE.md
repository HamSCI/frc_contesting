# Claude AI Assistance Documentation

## Overview

This document tracks the use of Claude AI (Anthropic) in the development of the HamSCI Contesting and DXing Dashboard project. It serves as both a historical record and a guide for future AI-assisted development sessions.

---

## Purpose

This documentation serves to:

1. **Maintain Transparency**: Record all AI contributions to the project
2. **Ensure Continuity**: Help future Claude sessions understand the project context
3. **Provide Guidelines**: Establish best practices for AI-assisted development
4. **Track Model Usage**: Document which LLM models were used and when
5. **Enable Reproducibility**: Allow others to understand how AI was used in development

---

## LLM Models Used

### Model History

| Date | Model Name | Model ID | Used For | Primary Developer |
|------|------------|----------|----------|------------------|
| January 7, 2026 | Claude (unknown) | unknown | Security fixes, environment variable configuration, documentation | Nathaniel Frissell |
| January 12, 2026 | Claude (unknown) | unknown | API performance optimization attempts | Nathaniel Frissell |
| January 22, 2026 | Claude Sonnet 4.5 | claude-sonnet-4-5-20250929 | Requirements document creation and refinement | Nathaniel Frissell |
| February 2, 2026 | Claude Opus 4.5 | claude-opus-4-5-20251101 | Project planning, gap analysis, issue board setup | Nathaniel Frissell |
| February 9, 2026 | Claude Opus 4.6 | claude-opus-4-6 | Milestone 1 issue creation, workload balancing, project board setup | Nathaniel Frissell |
| February 13, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Vendor Leaflet.js + offline basemap (Issue #37, FR-OFF-01/03/04/06) | Liam Miller |
| February 21, 2026 | Claude Opus 4.6 | claude-opus-4-6 | Receiver config extraction to .env (Issue #38) | Liam Miller |
| February 21, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Connection status indicator in header (Issue #36, FR-UI-03) | Liam Miller |
| February 21, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | DB health check + smarter last-updated timestamp (Issue #41) | Liam Miller |
| February 22, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | ITU zone boundary overlay (FR-MAP-09) | Liam Miller |
| February 22, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Extract inline CSS to central stylesheet (static/css/style.css) | Liam Miller |
| February 27, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Milestone 1 audit (#32-#41), #36/#38/#40/#41 fixes, polyline removal, lastInterval sync, documentation | Liam Miller |
| March 1, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | 404 error diagnosis (OSM tile layer vs offline basemap conflict) | Liam Miller |
| March 1, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Issue #37 re-fix: offline basemap, favicon, shadow 404, label a11y, lastInterval cross-iframe sync | Liam Miller |
| April 4, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | ITU-R HF Prop prediction web interface: navigation menu, prediction page scaffolding, P2P form, ITURHFProp subprocess integration (WSL) | Liam Miller |
| April 9, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | P2P prediction page map: offline basemap, TX/RX draggable markers, geodesic arc, legend, default Scranton→London path | Liam Miller |
| April 9, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | P2P BCR/MUF chart: HTML5 Canvas heatmap with bilinear interpolation, contour lines, Catmull-Rom MUF line, hover tooltip, MUF/OPMUF toggle | Liam Miller |
| April 10, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | P2P chart polish: Viridis colormap, vermillion MUF line, antenna type dropdowns, chart background, contest/single frequency output filtering (two-run backend) | Liam Miller |
| April 10, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | P2P UX + chart expansion: auto-scroll fix, responsive stacking, BCR/SNR/PR metric buttons, S-meter PR scale, discrete legend blocks, generalised contour lines, MUF edge clamp, results export (copy/download CSV) | Liam Miller |
| April 11, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Area prediction page: map + form scaffolding, `/api/predict/area` backend, Viridis heatmap overlay on Leaflet map, contour lines on dense sampled grid, transparent low band, time arrow controls, BCR/SNR/PR metric buttons, opacity/resolution controls, results export | Liam Miller |
| April 11, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Area overlay polish: viewport-sized Mercator canvas (blur fix), lon wrap fix, boundary contour, hover info box, color-bar legend, "Very High" resolution 1°→2° | Liam Miller |
| April 12, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Download image feature (P2P + Area), grayline overlay, contest band toggles, input validation audit, button placement fixes | Liam Miller |
| April 13, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Merge recovery (missing imports, nav, routes, binary, data files), Contester's Table PDF export (band-selection modal, MUF/OPMUF + per-band BCR/SNR/PR tables, canvas line graphs), CLAUDE.md session order fix | Liam Miller |
| April 17, 2026 | Claude Sonnet 4.6 | claude-sonnet-4-6 | Area map PR S-unit fix, null fallback -999 fix, map layout overhaul (tooltip/legend hidden until prediction, legend dark-box sidebar), P2P-style windowed map (500px), lockWorldWidth() side-clip, PR column detection bug fix, contour alignment fix (dataMax 9→10), smooth rendering (removed Math.floor) | Liam Miller |

### Current Model

**Model**: Claude Sonnet 4.6
**Model ID**: claude-sonnet-4-6
**Context Window**: Large (suitable for entire codebase analysis)

---

## Project Context for Claude

### Project Summary

The HamSCI Contesting and DXing Dashboard is a real-time web application designed to help amateur radio operators optimize their HF transmissions during contests and DX operations. The dashboard visualizes propagation data from the HamSCI Personal Space Weather Station (PSWS) network, which collects WSPR, FT8, and FT4 digital mode spots.

### Key Technical Details

- **Data Source**: MongoDB database populated by WSPRDaemon software
- **Supported Modes**: WSPR, FT8, FT4
- **Update Cycles**: WSPR: 2 min, FT8: 15 sec, FT4: 7.5 sec
- **Typical Spot Rate**: 10-100 spots per 2-minute WSPR cycle
- **Geographic Coverage**: Worldwide (ionospheric propagation dependent)
- **Frequency Range**: 0.3-30 MHz (all HF amateur bands)

### Related Components

- **RX-888 MkII**: HF SDR Receiver with 30 MHz bandwidth
- **KA9Q-radio**: Multichannel SDR software
- **WSPRDaemon**: WSPR/FT8/FT4 decoder and database uploader
- **MongoDB**: Database with existing schema from WSPRDaemon

### Key Documents

- [docs/REQUIREMENTS.md](REQUIREMENTS.md) - Formal requirements specification (primary reference)
- [README.md](../README.md) - Complete technical documentation
- [OPERATOR_GUIDE.md](../OPERATOR_GUIDE.md) - User guide for radio operators
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Developer contribution guidelines
- [HamSCI Workshop 2025 Poster](references/Ruzankski,%20Owen%20-%20FRC_W3USR_POSTER%20-%20HamSCI%20Workshop%202025.pdf) - Project overview and goals
- [FRC Proposal](references/20250123%20FRC%20Proposal.pdf) - Detailed project proposal

---

## AI Contributions by Session

### Session 1: Security and Environment Configuration
**Date**: January 7, 2026
**Model**: Claude (unknown)
**Contributor**: Nathaniel Frissell
**Scope**: Security improvements and credential management

**Activities**:
- Implemented environment variable configuration using `.env` files
- Redacted exposed credentials from git history
- Created `.env.example` template file
- Updated security documentation and notices
- Fixed WSPRDaemon URL references
- Enhanced README with security best practices

### Session 2: API Performance Optimization
**Date**: January 12, 2026
**Model**: Claude (unknown)
**Contributor**: Nathaniel Frissell
**Scope**: Attempted performance improvements to API endpoints

**Activities**:
- Investigated API performance bottlenecks
- Attempted optimizations for spot data queries
- Work in progress (results unclear from commit history)

### Session 3: Requirements Document Creation (Continued Below)
**Date**: January 22, 2026
**Model**: Claude Sonnet 4.5 (claude-sonnet-4-5-20250929)
**Contributor**: Nathaniel Frissell
**Scope**: Creation of formal REQUIREMENTS.md specification

**Activities**:
- Synthesized information from README, OPERATOR_GUIDE, HamSCI poster, and FRC proposal
- Created structured requirements document with functional and non-functional requirements
- Defined RFC 2119-based requirement levels (SHALL/SHOULD/MAY)
- Documented core operator questions the dashboard must answer
- Specified offline-first design constraint (no CDN dependencies, LAN-only operation)
- Created acceptance criteria and validation checklist
- Documented user stories for different operator types
- Listed future considerations and open questions
- Created this CLAUDE.md documentation file

---

## Guidelines for Using Claude on This Project

### Before Starting a Session

1. **Read Key Documents**: Always read [docs/REQUIREMENTS.md](REQUIREMENTS.md) first to understand project scope
2. **Check Git Status**: Review recent commits to understand current state
3. **Review This File**: Check the session history above for context
4. **Understand Offline Constraint**: Remember this system MUST work without internet access

### During Development

1. **Maintain Consistency**: Follow existing code style and conventions
2. **Document Changes**: Update relevant documentation when making changes
3. **Test Incrementally**: For code changes, test each component before moving on
4. **Ask for Clarification**: When requirements are ambiguous, ask rather than assume
5. **Respect Dependencies**: Never add external CDN dependencies (offline-first requirement)

### Requirements Document Changes

When modifying [docs/REQUIREMENTS.md](REQUIREMENTS.md):

1. **Update Version Number**: Bump the version (1.0 → 1.1, etc.)
2. **Update Date**: Set to the current date
3. **Update Document History**: Add a new row with:
   - Version number
   - Date
   - ISO 8601 timestamp
   - Author name
   - LLM model and ID
   - Summary of changes
4. **Maintain Consistency**: Ensure SHALL/SHOULD/MAY match Must/Should/May priorities
5. **Update This File**: Add a new session entry in the "AI Contributions by Session" section

### Code Development Best Practices

1. **Follow Offline-First**: Requirements FR-OFF-01 through FR-OFF-08 are MUST requirements
2. **Vendor Dependencies**: Never add CDN dependencies; vendor all libraries locally
3. **Local Assets Only**: All JavaScript, CSS, GeoJSON, and images must be in repository
4. **Handle Invalid Data**: MongoDB may contain malformed grid squares; catch exceptions
5. **Optimize Performance**: Client-side filtering prevents excessive database load
6. **Session Storage**: Use sessionStorage for filter persistence across reloads
7. **Environment Variables**: Never commit credentials; always use `.env` files

### Communication Style

- Use clear, technical language
- Reference requirement IDs (e.g., FR-MAP-01) when discussing features
- Cite line numbers when discussing code (e.g., `services/spots.py:74`)
- Provide rationale for technical decisions
- Use amateur radio terminology correctly (bands, modes, propagation, etc.)

---

## Instructions for Future Claude Sessions

### On First Message

1. Read [docs/REQUIREMENTS.md](REQUIREMENTS.md) to understand the project
2. Read [docs/CLAUDE.md](CLAUDE.md) (this file) to understand the AI contribution history
3. Check `git log` to see recent changes
4. Ask the user what they would like to work on

### For Requirements Work

- Requirements changes should follow the format established in v1.0
- Always maintain the SHALL/SHOULD/MAY and Must/Should/May consistency
- Document all changes in the Document History section
- Update this CLAUDE.md file with session notes

### For Implementation Work

- Reference the requirements document frequently
- Prioritize Must requirements over Should requirements
- **CRITICAL**: Remember the offline-first constraint (FR-OFF-01 through FR-OFF-08)
- Never add external CDN dependencies or external API calls
- All assets must be vendored locally in the repository
- Test with realistic spot data from MongoDB
- Verify geographic lookups work correctly (countries, CQ zones, ITU zones)
- Ensure client-side filtering performs efficiently

### For Documentation Work

- Keep documentation concise but complete
- Use RFC 2119 keywords (SHALL/SHOULD/MAY) consistently
- Include examples where helpful
- Update version history appropriately
- Reference external amateur radio resources appropriately

---

## Technical Constraints to Remember

### CRITICAL: Offline-First Design

**The system MUST operate without any internet connectivity beyond the local LAN.**

This is not optional. The dashboard must be deployable at remote contest stations, field day sites, or emergency operations centers where internet access may be unreliable, restricted, or unavailable.

**Requirements:**
- All JavaScript libraries vendored locally (Leaflet.js, Turf.js, etc.)
- All CSS stylesheets vendored locally
- All GeoJSON boundary files included in repository
- All marker icons and image assets vendored locally
- Zero external HTTP/HTTPS requests for core functionality
- System operates with only MongoDB and Flask server accessible

### Must-Have Features (SHALL/Must)

**Core Operator Questions:**
- What bands are open and where? (FR-Q-01)
- When did they open/close? (FR-Q-02)
- Which band has the most activity? (FR-Q-04)
- What direction are signals coming from? (FR-Q-05)
- Is [specific band] open to [specific region]? (FR-Q-06)

**Map View:**
- Interactive world map (FR-MAP-01)
- Colored star markers by band at TX locations (FR-MAP-02)
- Receiver location marker (FR-MAP-04)
- Zoom and pan support (FR-MAP-05)
- Clickable markers with spot details (FR-MAP-06)
- Real-time spot counter by band (FR-MAP-07)
- CQ zone boundary overlay with labels (FR-MAP-08)
- ITU zone boundary overlay (FR-MAP-09)

**Table View:**
- Region × Band matrix display (FR-TBL-01)
- Spot counts per region-band combination (FR-TBL-02)
- Highlight active propagation cells (FR-TBL-03)
- Focus on 6 contest bands (FR-TBL-04)
- Map CQ zones to geographic regions (FR-TBL-05)
- Total spot counter (FR-TBL-06)

**Filtering:**
- Time-based filtering (last N minutes) (FR-FLT-01)
- Band filtering (all/individual/contest bands) (FR-FLT-02)
- Country filtering with "Non-US" option (FR-FLT-03)
- Continent filtering (FR-FLT-04)
- CQ zone filtering (1-40) (FR-FLT-05)
- ITU zone filtering (1-90) (FR-FLT-06)
- Mode filtering (WSPR/FT8/FT4) (FR-FLT-07)
- Filter persistence via session storage (FR-FLT-08)
- Client-side filtering for performance (FR-FLT-09)

**Geographic Processing:**
- Maidenhead grid to lat/lon conversion (FR-GEO-01)
- Point-in-polygon lookups (countries, CQ zones, ITU zones) (FR-GEO-02-04)
- GeoJSON boundary file loading (FR-GEO-05)
- Handle invalid grid squares gracefully (FR-GEO-06)

**User Interface:**
- Three view modes: map, table, combined (FR-UI-01)
- Consistent band color coding (FR-UI-02)
- Connection status indicators (FR-UI-03)
- Modern, clean, uncluttered design (FR-UI-04-07)

**Offline/Local Network:**
- Function completely without internet (FR-OFF-01)
- Local-network-only deployment support (FR-OFF-02)
- All JavaScript libraries vendored (FR-OFF-03)
- All CSS frameworks vendored (FR-OFF-04)
- All GeoJSON files in repository (FR-OFF-05)
- All icons/images local (FR-OFF-06)
- No external API calls required (FR-OFF-07)
- Operate with only MongoDB + Flask accessible (FR-OFF-08)

### Highly Desired Features (SHOULD/Should)

- Maximum Usable Frequency (MUF) display (FR-Q-03)
- CSV export support (FR-EXP-03)
- External data integration: RBN, PSK Reporter, DX Cluster (FR-EXP-04) - must be optional
- Clear visual feedback for filter changes (FR-UI-08)
- Tablet and desktop browser support (FR-UI-09)
- Dual-column table layout (FR-TBL-07)
- User filter preferences across reloads (FR-RT-04)

### Optional Features (MAY/May)

- Light and dark themes (FR-UI-10)
- N1MM+ Logger integration (FR-EXP-05)
- Rate limiting (NFR-SEC-05)
- Optional authentication (NFR-SEC-06)
- Automated tests (NFR-MAINT-05)
- Docker deployment (NFR-DEPLOY-06)

---

## Database Schema Reference

MongoDB collection: `wspr_db.spots`

```javascript
{
  _id: ObjectId("..."),
  callsign: "W1ABC",           // Transmitter callsign
  rx_callsign: "KD3ALD",       // Receiver callsign
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

**Important**: This schema is defined by WSPRDaemon and cannot be modified. The dashboard must work with this format.

---

## Amateur Radio Context

### Band Designations

| Band | Frequency Range | Typical Contest Use |
|------|----------------|---------------------|
| 160m | 1.8-2.0 MHz | Night-time, low-noise locations |
| 80m | 3.5-4.0 MHz | Night-time, regional/DX |
| 40m | 7.0-7.3 MHz | Night/day, reliable DX |
| 30m | 10.1-10.15 MHz | WSPR-only, no contests |
| 20m | 14.0-14.35 MHz | Daytime workhorse DX band |
| 17m | 18.068-18.168 MHz | Daytime, limited contest use |
| 15m | 21.0-21.45 MHz | Daytime DX, solar cycle dependent |
| 12m | 24.89-24.99 MHz | Limited contest use |
| 10m | 28.0-29.7 MHz | High solar activity, sporadic E |

**Contest Bands**: The 6 most important contest bands are 160m, 80m, 40m, 20m, 15m, 10m.

### Geographic Zones

- **CQ Zones**: 40 zones worldwide (used in CQWW contests)
- **ITU Zones**: 90 zones worldwide (used in some ARRL contests)
- **Maidenhead Grid**: 6-character grid squares (e.g., FN42hx) for location precision

### Digital Modes

- **WSPR**: Weak Signal Propagation Reporter (2-minute cycles, very weak signals)
- **FT8**: Fast Text 8 (15-second cycles, moderate signals)
- **FT4**: Fast Text 4 (7.5-second cycles, contesting mode)

---

## Contact and Collaboration

**Project Developers**:
- Owen Ruzanski (KD3ALD) - Lead student developer
- Liam Miller (KD3BVX) - Student developer
- Dr. Nathaniel Frissell (W2NAF) - Faculty advisor and project lead

**Project**: HamSCI Personal Space Weather Station (PSWS) Dashboard Development
**Institution**: University of Scranton, Department of Physics/Engineering
**Amateur Radio Club**: W3USR (University of Scranton), Frankford Radio Club

**Funding**:
- Frankford Radio Club (FRC)
- NSF Grants AGS-2432821, AGS-2432822, AGS-2432824, and AGS-2432823
- Amateur Radio Digital Communications (ARDC)

For questions about this project or the use of AI assistance, please refer to the project documentation or contact the project lead.

### Session 4: Project Planning and Issue Board Setup
**Date**: February 2, 2026
**Model**: Claude Opus 4.5 (claude-opus-4-5-20251101)
**Contributor**: Nathaniel Frissell (W2NAF)
**Scope**: Semester project planning, gap analysis, GitHub project board setup
**Status**: Complete

**Activities**:
- Performed comprehensive gap analysis of existing codebase against REQUIREMENTS.md (~85% complete)
- Identified critical blocker: Leaflet.js loaded from CDN, violating offline-first requirements (FR-OFF-01/03/04)
- Identified other gaps: ITU zone overlay not rendered, no connection status indicators, no last-update timestamp, hardcoded receiver config, inline CSS, no tests
- Found code quality issues: bandColorMap defined twice in map_ft.js, time parsing duplicated between map_ft.js and table_ft.js, broken onload.js script reference in templates
- Closed all 6 existing open issues (#7, #8, #17, #18, #23, #24) to start fresh
- Created Issue #30: Set-Up and Install W3USR WSPRDaemon System (due Feb 9, on project board "Ready")
- Created Issue #31: Install, Test, and Debug Current DXDashboard (due Feb 16, assigned KD3ALD, blocked by #30, on project board "Ready")
- Set up GitHub project board access (HamSCI project #9) and verified issue placement
- Drafted full semester project plan with 3 milestones (later expanded to 4 in Session 5)
- Plan saved to `docs/PROJECT_PLAN.md` (git-tracked)

**Team Structure Documented**:
- W2NAF: Project manager/PI
- KD3ALD: Lead student developer (architecture, modularity)
- KD3BVX: Student developer (propagation models, science)
- Contributors: Additional CS students for discrete, well-scoped tasks

### Session 5: Milestone 1 Issue Creation and Workload Balancing
**Date**: February 9, 2026
**Model**: Claude Opus 4.6 (claude-opus-4-6)
**Contributor**: Nathaniel Frissell (W2NAF)
**Scope**: Finalize Milestone 1 issues, balance workload, update project board
**Status**: Complete

**Activities**:
- Reviewed draft PROJECT_PLAN.md and identified workload imbalance (KD3ALD had 5 Milestone 1 issues, KD3BVX had 1)
- Redistributed Milestone 1 work evenly: 5 issues each for KD3ALD and KD3BVX
- Created GitHub labels: `architecture`, `offline-first`, `UI/UX`, `science`, `blocker`, `milestone-1`
- Created 10 new GitHub issues (#32-#41) for Milestone 1, all assigned and on project board
- Added `milestone-1` label to existing issues #30 and #31
- Set target dates on all 12 Milestone 1 issues on the project board
- Added new Milestone 3: Frankford Radio Club Demo (Apr 14) — sponsor feedback session before Hamvention
- Renumbered old Milestone 3 to Milestone 4 (Hamvention, May 14)
- Updated PROJECT_PLAN.md to reflect 4-milestone structure and actual issue assignments
- Decision: create issues incrementally by milestone (Milestone 1 only for now to keep board focused)

**Milestone 1 Issue Assignments (all on project board, status "Ready")**:
- **KD3ALD**: #31 Install/Test, #32 Remove onload.js, #33 Backend split, #34 config.js, #35 utils.js, #36 Connection status
- **KD3BVX**: #37 Vendor Leaflet, #38 Receiver config, #39 Central CSS, #40 ITU overlay, #41 Timestamp
- Key dependency: KD3BVX #38 (receiver config, due Feb 20) must finish before KD3ALD #34 (config.js, due Feb 21)

**Next Session Goals**:
- Check progress on #30 (WSPRDaemon setup) and #31 (Install/Test/Debug)
- Once Milestone 1 is underway, create Milestone 2 issues (7 issues for HamSCI Workshop)
- Resolve open decisions: great circle path rendering, MUF estimation approach

### Session 6: Vendor Leaflet.js + Offline Basemap (Issue #37, FR-OFF-01/03/04/06)
**Date**: February 13, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Remove all external CDN dependencies from the map view; serve Leaflet and basemap tiles entirely from local files
**Status**: Complete

**Activities**:
- Downloaded Leaflet 1.9.4 (JS, CSS, 5 marker icon PNGs) to `static/vendor/leaflet/` — replaces `unpkg.com` CDN references in both active templates
- Replaced OpenStreetMap tile layer (`tile.openstreetmap.org`) in `map_ft.js` with `loadOfflineBasemap()`: loads three Natural Earth GeoJSON files from `static/vendor/basemap/` and renders them as Leaflet vector layers
- Basemap uses blue ocean background (CSS), light land fill (`ne_50m_land.json`), dark country borders (`ne_50m_admin_0_countries.json`), and lighter state/province borders (`states-50m.json`)
- Initial implementation used world-atlas TopoJSON (designed for D3.js), which caused antimeridian wrapping artifacts (horizontal lines across Russia/Antarctica); replaced with Natural Earth GeoJSON which is pre-split at the antimeridian and renders correctly in Leaflet
- Added `maxBounds` to map initialization to prevent scrolling past ±180°
- Updated `templates/index_ft.html` and `templates/index_wcount.html`: replaced `https://unpkg.com/leaflet/...` with `vendor/leaflet/...`
- Updated `README.md` and `docs/CLAUDE.md`

**Note**: `static/vendor/` is not git-tracked. Re-run the download commands in README.md → "Offline Basemap Files" and "Leaflet Vendor Files" sections after any `git clean` or fresh clone.

**Files Modified**:
- `static/vendor/leaflet/` — new directory (leaflet.js, leaflet.css, images/)
- `static/vendor/basemap/` — new directory (ne_50m_land.json, ne_50m_admin_0_countries.json, states-50m.json)
- `static/js/map_ft.js` — removed OSM tile layer, added `loadOfflineBasemap()`, added `maxBounds`
- `templates/index_ft.html` — local Leaflet CSS/JS references
- `templates/index_wcount.html` — local Leaflet CSS/JS references
- `README.md` — vendor file download instructions, project structure, map view notes
- `docs/CLAUDE.md` — session record

---

### Session 7: Extract Receiver Callsign and Grid Square into .env (Issue #38)
**Date**: February 21, 2026
**Model**: Claude Opus 4.6 (claude-opus-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Remove hardcoded receiver callsign and grid square; make configurable via .env
**Status**: Complete

**Activities**:
- Added `RECEIVER_CALLSIGN` and `RECEIVER_GRIDSQUARE` to `.env.example` with placeholder values
- Loaded new env vars in `web-ft.py` via `os.getenv()` with backward-compatible defaults
- Replaced hardcoded `"FN21ni"` in `fetch_wspr_spots()` and `fetch_wspr_spots_tb()` with `RECEIVER_GRIDSQUARE`
- Added `GET /config` REST API endpoint to serve receiver callsign and grid square to frontend
- Updated `table_ft.js`: replaced hardcoded `const call = "KD3ALD"` with `let call = ""` populated via `fetch('/config')`
- Updated `README.md`: revised "Receiver Station Configuration" section and added `/config` endpoint to API documentation

**Files Modified**:
- `.env.example` — receiver station config section added, real credentials removed
- `web-ft.py` — env var loading, `RECEIVER_GRIDSQUARE` substitution, `/config` endpoint
- `static/js/table_ft.js` — dynamic callsign loading from `/config`
- `README.md` — updated configuration and API documentation

### Session 8: Connection Status Indicator (Issue #36, FR-UI-03)
**Date**: February 21, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Add visible connection status indicator to all dashboard views
**Status**: Complete

**Activities**:
- Added `GET /health` endpoint to `web-ft.py` returning `{"status": "ok"}` (HTTP 200)
- Created `static/js/connection_status.js`: polls `/health` every 30 seconds, updates colored dot in header (yellow = checking, green = connected, red = disconnected)
- Updated `templates/index_ft.html`: added `.status-dot` CSS, indicator `<div>` between `<h1>` and `<h3>`, and `<script>` tag for `connection_status.js`
- Updated `templates/table_ft.html`: same CSS, indicator `<div>` below `<h1>`, and `<script>` tag
- `both.html` required no changes — its iframes load `/map` and `/table` which already include the indicator
- Updated `README.md`: added feature to Key Features, `/health` to architecture diagram and API docs, `connection_status.js` to project structure, new Connection Status Indicator section in Frontend Components
- Updated `docs/CLAUDE.md`: model history table and this session entry

**Files Modified**:
- `web-ft.py` — `/health` endpoint added
- `static/js/connection_status.js` — new file (polling logic)
- `templates/index_ft.html` — CSS + indicator HTML + script tag
- `templates/table_ft.html` — CSS + indicator HTML + script tag
- `README.md` — documentation updates
- `docs/CLAUDE.md` — session record

### Session 9: DB Health Check + Smarter Last-Updated Timestamp (Issue #41)
**Date**: February 21, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Make `/health` verify MongoDB; add 3-state indicator; smarter "Last updated" / "Last spot" timestamp
**Status**: Complete

**Activities**:
- Updated `/health` in `web-ft.py` to ping MongoDB via `client.admin.command('ping')` — returns 503 + `{"status": "db_error"}` when DB is down
- Added `GET /latest-spot-time` endpoint: queries for most recent spot in MongoDB, returns `{"found": true, "time": "HH:MM:00 UTC"}` or `{"found": false}`
- Updated `static/js/connection_status.js`: added `dberror` state (orange dot, "DB Unavailable" label); maps HTTP 200 → connected, 503 → dberror, network error → disconnected
- Added `.status-dberror { background: #f97316 }` CSS to `templates/index_ft.html` and `templates/table_ft.html`
- Updated `static/js/map_ft.js`: conditional timestamp — "Last updated: HH:MM:SS UTC" when spots were found; falls back to `GET /latest-spot-time` → "Last spot: HH:MM:00 UTC" when none
- Updated `static/js/table_ft.js`: `buildTable()` now returns `total`; conditional timestamp logic moved to `loadSpots()` with same fallback pattern
- Updated `README.md` and `docs/CLAUDE.md`

**Files Modified**:
- `web-ft.py` — `/health` updated, `/latest-spot-time` added
- `static/js/connection_status.js` — 3-state indicator
- `templates/index_ft.html` — `.status-dberror` CSS
- `templates/table_ft.html` — `.status-dberror` CSS
- `static/js/map_ft.js` — conditional timestamp
- `static/js/table_ft.js` — `buildTable()` returns total, conditional timestamp in `loadSpots()`
- `README.md` — documentation updates
- `docs/CLAUDE.md` — session record

### Session 10: Milestone 1 Completion Audit, Bug Fixes, Polyline Removal, and lastInterval Sync
**Date**: February 27, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Verify all Milestone 1 issues (#32-#41 excl. #37); implement fixes for #36, #38, #40, #41; remove TX→RX polylines; sync lastInterval across map and table views; update all documentation
**Status**: Complete

**Activities**:
- Audited issues #32-#41 (excl. #37): confirmed #32, #33, #34, #35, #39 complete; found #36, #38, #40, #41 incomplete
- Renamed `RECEIVER_GRID` → `RECEIVER_GRIDSQUARE` in `app.py` to align with `.env.example`; fixed same key name in `services/spots.py` (KeyError bug)
- Added `receiver_grid` to `/config` JSON response in `routes/api.py`
- Replaced hardcoded `callsign`/`gridSquare` in `static/js/config.js` with `loadStation()` async method that fetches from `/config` (#38)
- Added `setStatus()` and `setLastUpdated()` helpers to both `map_ft.js` and `table_ft.js`; wrapped `fetch()` calls in try/catch to drive status indicator on success/error (#36/#41)
- Added `renderITUZones()` function to `map_ft.js` (modeled after `loadCqZones()`); uses `ITUZoneFeat` from utils.js and `itu_zone_number` GeoJSON property; assigns `ituZoneBordersLayer`/`ituZoneLabelsLayer` (#40)
- Fixed implicit global `cqZoneLabelsLayer` in `map_ft.js` with explicit `let` declaration
- Removed TX→RX polyline creation, popup, and layer tracking from `map_ft.js`; grey lines no longer appear on map
- Fixed runtime ReferenceError: renamed `ituZoneFeatures` → `ITUZoneFeat` in `renderITUZones()` to match utils.js global
- Fixed `map_ft.js` DOMContentLoaded: guarded line that unconditionally overwrote sessionStorage-restored lastInterval with URL param fallback
- Added sessionStorage read on load and write on `loadSpots()` to `table_ft.js` so lastInterval is shared between map and table views
- Updated `README.md`: corrected band color config reference, `/config` response key, map view features, project structure, dev/deploy instructions, footer date
- Updated `OPERATOR_GUIDE.md`: removed grey-lines references, added v3.0 version history entry
- Updated `docs/CLAUDE.md`: model history, current model, removed FR-MAP-03, communication style example

**Files Modified**:
- `app.py` — RECEIVER_GRID → RECEIVER_GRIDSQUARE
- `routes/api.py` — added receiver_grid to /config response
- `services/spots.py` — RECEIVER_GRID → RECEIVER_GRIDSQUARE (both fetch functions, KeyError fix)
- `static/js/config.js` — dynamic loadStation() replacing hardcoded station block
- `static/js/map_ft.js` — setStatus/setLastUpdated, renderITUZones, polyline removal, ITUZoneFeat fix, cqZoneLabelsLayer declaration, lastInterval sessionStorage guard
- `static/js/table_ft.js` — setStatus/setLastUpdated, CONFIG.loadStation(), lastInterval sessionStorage read/write
- `README.md` — multiple accuracy fixes throughout
- `OPERATOR_GUIDE.md` — polyline references removed, v3.0 version entry added
- `docs/CLAUDE.md` — session record, model history updated

### Session 11: 404 Error Investigation (map_ft.js) — Resolved in Session 12
**Date**: February 28 – March 1, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Diagnose browser console "Failed to load resource: 404 NOT FOUND" at `null:1` in map view
**Status**: Diagnosed; fixed in Session 12

**Diagnosis**:
- Root cause: `static/js/map_ft.js` still called `L.tileLayer(CONFIG.map.tileUrl, ...)` where `tileUrl` = `"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"` — active external tile layer violating FR-OFF-01/07
- `loadOfflineBasemap()` from Session 6 was lost in a later merge; the local basemap GeoJSON files in `static/vendor/basemap/` were present but not being loaded

---

### Session 12: Issue #37 Complete Fix — Offline Basemap, Favicon, Shadow 404, Label A11y, lastInterval Sync
**Date**: March 1, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Complete Issue #37 offline-first requirements; fix several additional bugs found during testing
**Status**: Complete

**Activities**:
- Re-applied CDN fix to `templates/index_ft.html` (had been overwritten): `https://unpkg.com/leaflet/dist/leaflet.js` → `vendor/leaflet/leaflet.js`
- Replaced `L.tileLayer(CONFIG.map.tileUrl, ...)` in `map_ft.js` with `loadBasemap()` — fetches `ne_50m_land.json`, `ne_50m_admin_0_countries.json`, and `states-50m.json` from `static/vendor/basemap/` and renders them as Leaflet GeoJSON vector layers; land fill `#e8e0d8`, country borders `#888`, state borders `#bbb`
- Removed `tileUrl` and `tileOptions` from `CONFIG.map` in `config.js` (no longer used)
- Added `background-color: #a8d5e8` (ocean blue) to `#map` in `style.css` so the ocean areas are visually distinct from land
- Added `/favicon.ico` route to `routes/views.py` returning HTTP 204 — eliminates the browser-generated 404 on every page load
- Fixed Leaflet marker shadow 404 loop: `L.Icon.Default.prototype.options.shadowUrl = null` → `shadowUrl = ''` still caused Leaflet to construct `imagePath + ''` = `vendor/leaflet/images/`; replaced both overrides with `L.Icon.Default.prototype.createShadow = function() { return null; }` which prevents the shadow element from being created at all
- Fixed accessibility issue in `templates/table_ft.html`: added `for="lastInterval"` and `for="threshold"` attributes to two `<label>` elements that were missing them (DevTools flagged "no label associated with a form field")
- Implemented bidirectional `lastInterval` sync between map and table iframes: both views now write to `localStorage` (in addition to `sessionStorage`) when the value changes; each view has a `window.addEventListener("storage", ...)` listener that updates its own input and calls `loadSpots()` when the other frame changes the value — fixes the issue where updating interval in one pane did not update the other

**Technical notes**:
- `sessionStorage` is isolated per iframe even when same-origin; `localStorage` is shared and fires the `storage` event in all other same-origin frames — that is why switching to `localStorage` enables cross-iframe sync
- `createShadow` override is the correct Leaflet API to suppress shadow rendering; setting `shadowUrl` to any string (including empty) still causes URL construction internally
- The `storage` event only fires in frames *other than* the one that wrote the value, so there is no infinite loop risk

**Files Modified**:
- `templates/index_ft.html` — CDN `<script>` tag re-fixed to local vendor path
- `static/js/map_ft.js` — `loadBasemap()` added, `L.tileLayer` removed, `createShadow` override, `localStorage` write + `storage` listener
- `static/js/config.js` — `tileUrl` and `tileOptions` removed from `CONFIG.map`
- `static/css/style.css` — `background-color: #a8d5e8` added to `#map`
- `routes/views.py` — `/favicon.ico` route added (HTTP 204)
- `templates/table_ft.html` — `for` attributes added to two `<label>` elements
- `static/js/table_ft.js` — `localStorage` write + `storage` listener for cross-iframe sync
- `README.md` — date updated, lastInterval sync troubleshooting entry added
- `docs/CLAUDE.md` — session record

### Session 13: ITU-R HF Prop Prediction Web Interface
**Date**: April 4, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Build the web interface for the ITU-R HF propagation prediction software package (`itu_r_hf/`)
**Duration**: 2.25 hours (10:15–12:30)
**Status**: In Progress — form and backend wired; executable integration pending full test

**Activities**:
- Added hamburger (☰) navigation menu to `both.html`: fixed-position button (top-left) opens a slide-out panel with "Spots" and "Prediction" links; clicking outside closes it
- Created `/prediction` route and `prediction.html`: landing page with "How to Use this Program" heading and tab bar
- Created `/prediction/p2p` route and `prediction_p2p.html`: full point-to-point prediction form
- Created `/prediction/area` route and `prediction_area.html`: placeholder area prediction page
- All prediction pages share the hamburger nav and a three-tab bar (How To / Point to Point / Area) with the active tab highlighted
- Built full P2P input form with: TX/RX lat/lng, antenna gain (dBi), year/month/SSN, frequency selector (Single / Contest Bands / HF Spectrum toggle), TX power (W), signal type dropdown (WSPR/FT8/CW/SSB Usable/SSB Marginal — auto-sets BW and SNRr), path type (Short/Long), noise environment with dB values, and output options checklist (BMUF, OPMUF, Field Strength, Received Power, SNR, BCR)
- Contest Bands mode shows pill labels (160m / 80m / 40m / 20m / 15m / 10m); sends `1.9, 3.75, 7.1, 14.15, 21.2, 28.3` MHz to the program
- HF Spectrum mode sends 1–30 MHz in 1 MHz steps
- "Run Prediction" button turns orange ("Running...") during the subprocess call; reverts on completion; required-field errors shown in red above the button
- Results displayed in a dark scrollable `<pre>` block with the "Data Format:" column-header section bolded (Option B display)
- Added `POST /api/predict/p2p` to `routes/api.py`: validates inputs, converts TX power (W → dB(kW)), builds a `.in` input file in `itu_r_hf/tmp/`, runs `ITURHFProp`, reads and returns the output text, cleans up temp files
- Cross-platform subprocess: on Windows uses WSL (`wsl bash -c "LD_LIBRARY_PATH=... exe -s in out"`) with all paths converted to `/mnt/c/...` format; on Linux calls the binary directly with `LD_LIBRARY_PATH` set; WSL was installed on the development machine to avoid needing Visual Studio
- Hardcoded behind the scenes: ISOTROPIC antennas, TX2RX orientation, ANALOG modulation, 50% reliability threshold, all 24 hours output, grid corners = RX location
- Added CSS sections 10–12 to `static/css/style.css`: hamburger nav, prediction page tabs, and full prediction form styling

**Key Decisions**:
- WSL chosen over Visual Studio compilation to run the Linux binary on Windows — distributable, no compiler needed
- Backend uses `platform.system()` to select WSL vs direct call automatically — same codebase works on Windows (local/LAN) and Linux (public server)
- `DataFilePath` and `RptFilePath` in the `.in` file use WSL-format paths on Windows so the Linux binary can resolve them correctly

**Files Modified/Created**:
- `templates/both.html` — hamburger nav added
- `templates/prediction.html` — new (prediction landing page)
- `templates/prediction_p2p.html` — new (full P2P form)
- `templates/prediction_area.html` — new (placeholder)
- `routes/views.py` — `/prediction`, `/prediction/p2p`, `/prediction/area` routes added
- `routes/api.py` — `POST /api/predict/p2p` endpoint added; `platform`, `math`, `uuid`, `subprocess`, `os` imports added
- `static/css/style.css` — sections 10 (hamburger nav), 11 (prediction tabs), 12 (prediction form) appended
- `docs/CLAUDE.md` — session record

### Session 14: P2P Prediction Page — Mini Map, Draggable Markers, Geodesic Arc
**Date**: April 9, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Add an interactive offline mini map to the P2P prediction page with TX/RX markers and a great circle path
**Duration**: 45 minutes (10:15–11:00)
**Status**: Complete

**Activities**:
- Added offline Leaflet basemap (land + country + state outlines, no tile server) to `/prediction/p2p` using absolute vendor paths (`/vendor/leaflet/`, `/vendor/basemap/`) — required because the page lives at a subpath (`/prediction/p2p`), where relative paths would resolve incorrectly
- Placed map in a `.pred-map-row` flex layout: map on the left, "Coming Soon" placeholder box on the right, both 360 px tall — placeholder reserved for a future results panel
- Added draggable TX (red `#ef4444`) and RX (blue `#3b82f6`) markers using `L.marker` + `L.divIcon` — `L.circleMarker` does not support dragging
- Implemented `updateMarkers()` with a create-or-move pattern: markers are created once and repositioned via `setLatLng()` on subsequent calls, preventing drag handlers from being re-bound on every keystroke
- Geodesic arc (orange dashed, `#f97316`) computed with a pure-JS spherical interpolation (`geodesicPoints()`, 100 waypoints) — no external library needed
- Added `antimeridianFix()` to normalize longitudes as a continuous sequence, preventing the polyline from drawing a shortcut across the map on trans-Pacific paths
- Drag events update the lat/lon input fields live and redraw the arc; input field changes reposition the markers and redraw the arc
- Default path pre-populated on load: TX = Scranton PA (41.409, -75.6624), RX = London UK (51.5074, -0.1278); map centered at `[46, -37]` zoom 3 (mid-Atlantic) so both endpoints are visible
- Added Leaflet `L.control` legend (bottom-right) showing TX/RX dot colors
- Added CSS Section 13 to `static/css/style.css`: `.pred-map-row`, `#pred-map`, `.pred-coming-soon`, `.pred-map-legend`, `.legend-dot`

**Key Decisions**:
- `L.divIcon` chosen over `L.circleMarker` — only `L.marker` supports the `draggable` option
- Geodesic math inlined (no turf.js dependency) — keeps the pred page self-contained
- Absolute vendor paths (`/vendor/...`) required on all sub-route pages; relative paths only work on top-level routes

**Files Modified**:
- `templates/prediction_p2p.html` — Leaflet CSS link, map row HTML, full JS rewrite of second script block
- `static/css/style.css` — Section 13 appended (map row, legend)
- `docs/CLAUDE.md` — session record

---

### Session 15: P2P Prediction Page — BCR/MUF Propagation Chart
**Date**: April 9, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Replace the "Coming Soon" placeholder panel with a live BCR/MUF propagation chart
**Duration**: 2 hours (20:30–22:30)
**Status**: Complete

**Activities**:
- Replaced `.pred-coming-soon` div with `<canvas id="pred-chart">` (HTML5 Canvas, zero dependencies, fully offline)
- Backend (`routes/api.py`): always runs full 1–30 MHz spectrum × all 24 UTC hours regardless of form frequency selection; always merges `RPT_BMUF`, `RPT_OPMUF`, `RPT_BCR` into the report options; added `parse_chart_data()` to dynamically parse column positions from the `Data Format:` section and extract `bcr[30][24]`, `bmuf[24]`, `opmuf[24]` arrays; returns `{output, chart_data}` from the endpoint
- Canvas chart renders: bilinear-interpolated BCR heatmap (smooth color gradient, no CDN), 9 contour lines at 10% BCR boundaries (marching squares algorithm), Catmull-Rom spline MUF/OPMUF line, Y-axis (MHz), X-axis (UTC), color legend bar with BCR % labels
- Color gradient: dark blue (0%) → cyan (25%) → green (50%) → yellow-orange (75%) → red (100%), with sigmoid-based soft stepping to create defined bands while preserving smoothness
- Contour lines computed with marching squares — scans each adjacent grid cell pair for crossings at each 10% boundary, draws 1px semi-transparent lines precisely aligned to the heatmap coordinate system
- MUF toggle buttons added between map row and form: "MUF (50th Pctl.)" and "OPMUF (85th Pctl.)"; switching redraws only the line, not the heatmap
- Hover tooltip: mousemove maps pixel position back to the raw grid cell and displays `{freq} MHz | {UTC} UTC | {BCR}%` in a dark overlay at the top-left of the plot area
- `putImageData` coordinate fix: bilinear heatmap uses physical pixels (CSS px × DPR) since `createImageData`/`putImageData` bypass the `ctx.scale(dpr, dpr)` transform
- Contour line alignment fix: coordinate mapping in `drawContourLines()` updated to match `drawBilinearHeatmap()` exactly (`fiToY = MT + ph*(1-fi/29)`, `hiToX = ML + (hi/23)*pw`)
- Confirmed BMUF < OPMUF is correct per ITU-R P.533: BMUF is the 50th-percentile MUF (median), OPMUF includes scatter modes and can exceed BMUF
- Added CSS Section 14: `.pred-chart-canvas`, `.pred-muf-toggle`, `.muf-toggle-btn`

**Key Decisions**:
- HTML5 Canvas chosen over Plotly.js — fully offline (no 3 MB bundle), faster rendering, complete control over coordinate system
- `BCR_COLOR_LUT` precomputed at page load (1001-entry array, sigmoid-stepped) — eliminates per-pixel gradient math in the inner loop
- Marching squares run on the raw 24×30 grid (not the interpolated pixels) — ensures contour lines track the actual data boundaries
- `putImageData` requires explicit DPR scaling since it bypasses `ctx.scale()`
- Both `parse_chart_data()` column detection and marching squares coordinate mapping must use the same axis conventions as the pixel loop

**Files Modified**:
- `routes/api.py` — `parse_chart_data()` added; `predict_p2p()` updated (forced spectrum, merged chart options, returns `chart_data`); `import re` added
- `templates/prediction_p2p.html` — canvas replaces Coming Soon; MUF toggle buttons added; full chart JS (`bcrColor`, `bcrColorRGB`, `BCR_COLOR_LUT`, `catmullRomPoints`, `drawBilinearHeatmap`, `drawContourLines`, `renderChart`, `bindChartHover`, `setMufMode`); `runPrediction()` updated to call `renderChart`
- `static/css/style.css` — Section 14 appended

---

### Session 16: P2P Chart Polish + Contest Frequency Output Filtering
**Date**: April 10, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Visual polish on the BCR/MUF chart and accurate frequency output filtering for contest/single modes
**Duration**: 1.5 hours (11:00–12:30)
**Status**: Complete

**Activities**:
- Added TX and RX antenna type dropdowns (Isotropic only; ready for additional types later); `onAntennaTypeChange()` resets gain field to 2.15 dBi when Isotropic is re-selected
- Changed antenna gain label from `"TX Antenna Gain (dBi, 0 = isotropic)"` → `"TX Antenna Gain (dBi)"`; default value changed from 0 to 2.15 (standard isotropic reference gain)
- Changed chart canvas background from near-black `#0d0d14` to light grey `#d8d8d8`; border softened to `#bbb`
- Replaced original blue→cyan→green→yellow→red BCR color gradient with the Viridis colormap for colorblind accessibility; stops sampled at 10% BCR intervals mapped onto Viridis 0.0–0.9 (compressed scale) to spread the high-end green/yellow range — prevents 90% and 100% from appearing identical
- Changed MUF/OPMUF line from white to vermillion `#D55E00` (Okabe-Ito colorblind-safe palette); draws a 4px semi-transparent black shadow pass first, then a 2px vermillion pass on top — ensures visibility across the full Viridis range
- Added contest/single frequency output filtering: for contest mode, backend runs ITURHFProp twice — once with 1–30 MHz integers (chart) and once with the 6 specific contest frequencies (text output); for single mode, runs twice with the exact entered frequency for text output; spectrum mode reuses the chart run output
- Contest frequencies: 160m=1.9 MHz, 80m=3.6 MHz, 40m=7.125 MHz, 20m=14.15 MHz, 15m=21.2 MHz, 10m=28.3 MHz
- Added `filterOutputByFreq(text, mode, singleFreq)` JS function to filter text output rows client-side before rendering; keeps all header/Data Format lines, filters only data rows by frequency match (±0.01 MHz tolerance)
- Fixed segfault (exit code 139): initial approach of appending extra frequencies to the 30-integer list exceeded ITURHFProp's internal frequency array limit; resolved by two separate subprocess runs rather than a single oversized list

**Key Decisions**:
- Viridis compressed to 0.0–0.9 (not full 0.0–1.0): the full Viridis scale has near-identical RGB values at 90% and 100%; the compressed scale gives each 10% band a clearly distinct color while still ending in recognizable yellow-green
- Two-run approach for contest/single: replacing integer MHz steps with non-integer values would make the chart heatmap subtly inaccurate (propagation at 7.125 MHz ≠ propagation at 7.0 MHz); two runs preserve chart accuracy while giving exact text output
- `CONTEST_FREQS` defined at module level in `api.py` and as a JS constant in the template — single source of truth for each layer

**Files Modified**:
- `templates/prediction_p2p.html` — antenna type dropdowns, label text, gain default, `onAntennaTypeChange()`, `CONTEST_FREQS` JS constant, `filterOutputByFreq()`, output filter applied before `<pre>` render; `VIRIDIS_STOPS` updated; MUF line draw updated to vermillion + shadow
- `routes/api.py` — `CONTEST_FREQS` constant added; frequency-building logic replaced with `_execute(freq_string)` nested helper; two-run logic for contest/single modes
- `static/css/style.css` — canvas background and border updated (Section 14)

### Session 17: P2P UX Fixes + Chart Metric Expansion + Results Export
**Date**: April 10, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: UX polish and chart feature expansion on the P2P prediction page
**Duration**: 2.25 hours (18:30–20:45)
**Status**: Complete

**Activities**:
- Removed auto-scroll to results (`scrollIntoView` call deleted) — page stays at current position after prediction completes
- Added responsive stacking media query (`@media (max-width: 900px)`): `.pred-map-row` switches to `flex-direction: column`; both panels get `flex: none` and `height: 300px` so neither collapses in split-screen
- Added SNR and PR metric buttons alongside MUF buttons in a two-group `pred-chart-controls` flex layout; BCR button is default active
- Backend: added `RPT_SNR` and `RPT_PR` to `required_chart`; updated `parse_chart_data()` to extract SNR (column keyword `'SNR'`) and PR (column keyword `'RECEIVER'`) into separate 30×24 arrays; returns `snr` and `pr` alongside `bcr` in `chart_data`
- `renderChart()` refactored to select metric data/scale/label based on `chartMetric` state: BCR fixed 0–100%, SNR fixed -30 to 60 dB, PR fixed S-meter scale (S0 = -163 dBW, S9 = -103 dBW, 6 dB per S-unit, IARU HF standard)
- `drawBilinearHeatmap()` generalised: now accepts `dataMin`/`dataMax` and normalises any metric to 0–100% before the Viridis LUT lookup
- `drawContourLines()` generalised: `data` and `levels` now parameters; BCR uses fixed `[10,20,...,90]`, SNR uses 9 equal 9 dB steps across -30 to 60, PR uses exact S-unit boundaries `[-157,-151,...,-109]` dBW
- Legend bar changed from smooth gradient to 10 discrete solid blocks (one per Viridis stop) with tick labels at each boundary: BCR shows `100%`→`0%`, SNR shows `60`→`-30` dB, PR shows `S9`→`S0`
- Hover tooltip shows raw dBW value for PR (not S-unit) and `dB` for SNR
- MUF line x-coordinates clamped: first point set to `ML`, last point to `ML + pw` — line now runs edge-to-edge with no gap at either end
- `Path.SNRXXp` parameter tested at 90 (reverted to 50 by user after testing)
- Results area background changed from black (`#0b0b0b`) to light grey (`#d8d8d8`) matching the chart panel; text changed to dark (`#1a1a1a`)
- Added "Copy to Clipboard" and "Download CSV" buttons above the `<pre>` results block: Copy briefly shows "Copied!" on the button; Download generates a timestamped filename `MM_DD_YYYY_HH-MM_prediction.csv` (HH-MM uses hyphen — colons are invalid in Windows filenames)

**Key Decisions**:
- PR uses a fixed S-meter scale rather than auto-scale: the S-meter is a known amateur radio reference (IARU HF standard, S9 = -73 dBm = -103 dBW), making the chart immediately interpretable without needing to read the legend range each time
- SNR uses a fixed -30 to 60 dB range rather than auto-scale: spans the full range from inaudible to excellent for any digital/voice mode, making cross-prediction comparisons consistent
- `'RECEIVER'` (not `'RECEIVED'`) matched the ITURHFProp column descriptor `"Pr - Median receiver power (dB)"` — corrected after initial parse failure
- Discrete legend blocks chosen over smooth gradient bar: each block directly corresponds to one Viridis color band, making the legend a true key to the chart regions

**Files Modified**:
- `routes/api.py` — `required_chart` expanded; `parse_chart_data()` updated for SNR/PR columns
- `templates/prediction_p2p.html` — two-group button layout; `chartMetric` state; `setChartMetric()`; `drawBilinearHeatmap()` signature; `drawContourLines()` signature; `renderChart()` metric selection, contour levels, discrete legend, hover label; MUF edge clamp; `copyResults()`/`downloadCsv()` functions; results export buttons; results `<pre>` stays light
- `static/css/style.css` — responsive stacking media query; `.pred-chart-controls`/`.pred-metric-toggle` layout; `.pred-results pre` light grey; `.results-actions` button row

### Session 18: Area Prediction Page — Full Implementation
**Date**: April 11, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Complete area prediction page — map, form, backend, heatmap overlay, controls, and polish
**Duration**: 2.25 hours (10:30–12:45)
**Status**: Complete

**Activities**:
- Built `prediction_area.html` form scaffold: TX location, antenna (TX type + TX/RX gain, no RX type select), time & solar activity (year/month/hour/SSN), single-frequency input, signal type, noise environment, Run Prediction button
- Added full-width interactive Leaflet map (`#area-map`, 400px, world view zoom 2): draggable red TX marker synced to lat/lng fields; TX-only legend; same offline basemap as P2P
- Added `parse_area_data(text, resolution)` to `routes/api.py`: parses area-mode ITURHFProp CSV rows `(seq, hour, rx_lat, rx_lon, metrics...)` into 3-D arrays `[hour][lat_idx][lon_idx]`; detects lat/lon columns by `'LATITUDE'`/`'LONGITUDE'` keywords
- Added `/api/predict/area` endpoint: global grid (±90°/±180°), all 24 UTC hours, single frequency, 300s timeout; returns `{output, area_data}`; `rpt_format = 'RPT_RXLOCATION | RPT_BCR | RPT_SNR | RPT_PR'` (BMUF/OPMUF excluded)
- Fixed area parse failure: `RPT_RXLOCATION` was missing from initial `rpt_format`, so lat/lon columns never appeared in output; added flag to fix
- `renderAreaOverlay()`: bilinear interpolation over raw data grid onto 720×360 offscreen canvas; `BCR_COLOR_LUT` (same 1001-entry Viridis LUT as P2P); scales: BCR 0–100%, SNR -30 to 60 dB, PR -163 to -103 dBW (S0–S9); drapes result as `L.imageOverlay` on Leaflet map
- Custom Leaflet pane `heatmapPane` (z-index 450): heatmap renders above basemap vectors (400) but below TX marker (600)
- Transparent lowest band: pixels with `norm < 10` get `alpha = 0`, showing basemap through no-signal regions
- Contour lines: pre-samples bilinear interpolation onto a 360×180 dense regular grid, then runs marching squares — lines align precisely with visible color boundaries regardless of input resolution; same level sets as P2P per metric
- Chart controls bar below map: `◀ HH UTC ▶` time arrows (wraps 0–23, re-renders overlay client-side), BCR/SNR/PR metric buttons, opacity number input (default 0.75), resolution dropdown (Low 15° / Medium 10° / High 5° / Very High 1° ⚠ slow)
- Initial display hour seeded from the form's "Hour UTC" field after prediction completes
- Results section: raw text dump (`<pre>`), Copy to Clipboard, Download CSV (`MM_DD_YYYY_HH-MM_area_prediction.csv`)
- `_to_wsl()` promoted from nested function inside `predict_p2p` to module-level helper in `api.py`

**Key Decisions**:
- All 24 hours returned in one API call: arrow buttons re-render the cached data instantly with no additional API calls
- Canvas image overlay (`L.imageOverlay`) chosen over `L.rectangle` per cell: smooth scaling at any zoom, correct z-ordering, no performance cliff at high resolution
- Contour lines run on pre-sampled 360×180 grid (not raw data grid): marching squares on only 13×25 points at 15° resolution produced blocky, misaligned lines; the dense sample grid matches exactly what the pixel loop interpolated, giving smooth curves
- BMUF/OPMUF excluded from area output: not used by any display logic, only added clutter to raw text and slightly increased parse time

**Files Modified**:
- `routes/api.py` — module-level `_to_wsl()`; `parse_area_data()`; `/api/predict/area` endpoint
- `templates/prediction_area.html` — full page (map, chart controls, form, results, all JS)
- `static/css/style.css` — `#area-map` rule (Section 13b); Section 15 area chart control styles

### Session 19: Area Overlay Polish — Blur Fix, Boundary Contour, Hover Box, Color Legend
**Date**: April 11, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Visual and correctness polish on the area prediction heatmap overlay
**Duration**: 0.5 hours (18:00–18:30)
**Status**: Complete

**Activities**:
- Fixed heatmap blur: replaced fixed 720×360 offscreen canvas with a viewport-sized canvas (`areaMap.getSize()`); replaced equirectangular lat calculation with Mercator-correct `containerPointToLatLng()` per row/column; overlay now draped over `areaMap.getBounds()` instead of `[[-90,-180],[90,180]]` — eliminates browser upscaling blur
- Fixed longitude wrapping bug: `containerPointToLatLng` returns lon > 180 or < -180 when Leaflet repeats world tiles on wide screens at low zoom; added `((lon+180)%360+360)%360-180` wrap in both the pixel loop and the hover handler — prevented all-yellow overlay on PR metric
- Added re-render on map events: `areaMap.on('zoomend moveend resize', refreshOverlay)` — overlay stays crisp after zooming/panning
- Eliminated separate 360×180 pre-sample loop: `valGrid` (a flat `Float32Array(W*H)`) is now filled during the pixel pass and passed directly to `drawAreaContours()` — single surface guarantees contour/pixel alignment
- Updated `drawAreaContours()` to accept `strokeStyle` and `lineWidth` params; split into two calls per render: boundary level (no-data/data edge) at `lineWidth: 1.5, rgba(0,0,0,0.70)` and inner band contours at `lineWidth: 1, rgba(0,0,0,0.45)`
- Added hover info box: Leaflet control at `topleft` shows bilinearly-interpolated value at cursor position (`BCR: 45%` / `SNR: -12.3 dB` / `PR: -139.2 dBW`); displays `—` before prediction runs or outside grid bounds; updates on `mousemove`, clears on `mouseout`
- Added color-bar legend: Leaflet control at `topright`; vertical Viridis gradient canvas auto-sized to widest tick label; metric title at top; tick marks and labels at every contour level plus min/max endpoints; gray band for transparent no-data region; white boundary line at norm=10; re-renders on metric switch
- Changed "Very High" resolution option from 1° to 2°

**Key Decisions**:
- Viewport-sized canvas + `getBounds()` overlay: canvas covers exactly what's visible with no dead space or CSS scaling — sharpness guaranteed at any zoom level
- `containerPointToLatLng` for Mercator correctness: Leaflet's own CRS math ensures lat bands are spaced identically to how Leaflet renders the basemap
- `valGrid` flat array replaces 2-D pre-sample loop: eliminates one full W×H interpolation pass; contour/pixel alignment guaranteed since both use the same bilinear formula
- Boundary contour drawn as a separate heavier call: the no-color/color edge is the most perceptually important boundary and reads as a "coastline" of signal coverage

**Files Modified**:
- `templates/prediction_area.html` — viewport canvas, `containerPointToLatLng` pixel loop, lon wrap, `zoomend/moveend/resize` listener, `valGrid` flat array, `drawAreaContours()` split calls + signature, hover info box control + `mousemove`/`mouseout` handlers, `renderAreaLegend()` function + legend control, Very High resolution value
- `static/css/style.css` — `.area-legend-control` rule added (Section 13b)

---

### Session 20: Download Image, Grayline, Contest Band Toggles, Input Validation
**Date**: April 12, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Data export, map overlay, frequency UX, and input validation across both prediction pages
**Duration**: 2.75 hours (12:00–14:45)
**Status**: Complete

**Activities**:
- Added "Download Image" button to P2P: placed in `pred-chart-controls` row (rightmost), calls `canvas.toDataURL()` on `#pred-chart` — canvas already contains the color legend; filename includes metric and date
- Added "Download Image" button to Area: placed in `area-chart-controls` row (rightmost), opens a modal with three extent options — Whole Map (360°×180°), Surrounding Area (±90° lon / ±45° lat from TX), Custom bounds (four text inputs); renders an offscreen canvas at 1440px width with ocean fill, GeoJSON land/borders, heatmap pixel loop + contours, and legend composited in bottom-right corner; dropped `leaflet-image` library (hung on SVG GeoJSON layers) in favour of direct canvas rendering using cached `basemapLand` / `basemapCountries` GeoJSON
- Fixed Area Download Image button placement: button was rendering inside `#pred-results` (hidden until prediction runs, at page bottom); moved to `area-chart-controls`
- Added grayline overlay to Area map: `graylinePane` at z-index 420 (above basemap GeoJSON at 400, below heatmap at 450); `solarParams(date)` computes solar declination + equation of time; `renderGraylineCanvas()` builds 720×360 equirectangular canvas with four alpha bands — civil (0→50), nautical (50→120), astronomical (120→180), night (180) — producing gradual terminator fade; `refreshGrayline()` updates or creates `L.imageOverlay`; auto-refreshes every 60 seconds
- Grayline uses prediction UTC not wall clock: `refreshGrayline()` builds a synthetic `Date.UTC(year, month-1, 15, areaHour)` from the prediction form values when a prediction is loaded; falls back to `new Date()` on initial map load; `stepHour()` calls `refreshGrayline()` on each arrow press; prediction completion also triggers `refreshGrayline()`
- Added contest band toggles to P2P: converted `<span class="band-label">` static pills to `<button class="band-label" data-freq="...">` with `onclick="toggleBand(this)"`; `.band-label.inactive` CSS state (gray) for deselected bands; `getContestFreqs()` reads live selection; payload sends `contest_freqs` array to backend; backend uses `data.get('contest_freqs') or CONTEST_FREQS` fallback; validation blocks run with zero bands selected
- Input validation audit and fixes — both pages: all numeric fields audited; fields correctly using `parseFloat` (lat/lon, power, frequency, download bounds) confirmed valid; Year and SSN/R12 were using `parseInt()` which silently truncated decimals (`"2025.5"` → 2025, `"150.7"` → 150) — replaced with `Number() % 1 !== 0` integer check matching the previously fixed Hour field; Area Hour was already fixed; error messages updated to say "whole number"
- Download modal custom bounds validation: added ±90/±180 range checks and min < max enforcement for lat and lon fields; errors displayed as bulleted list in `#dl-status`

**Key Decisions**:
- Direct canvas rendering for Area download instead of `leaflet-image`: the library hangs on SVG GeoJSON layers; self-rendering from cached GeoJSON data is reliable, offline, and produces a cleaner output at controlled resolution
- Day 15 for grayline date: mid-month avoids month boundary edge cases; solar geometry changes slowly enough that day 1 vs day 15 is imperceptible at grayline scale
- `Number() % 1 !== 0` pattern for integer validation: catches any decimal input including trailing decimals; `parseInt` was the wrong parser for fields that must be whole numbers
- Contest band buttons start all-active: user deselects unwanted bands rather than selecting from scratch — lower friction for the common case (all bands)

**Files Modified**:
- `templates/prediction_p2p.html` — Download Image button + `downloadChartImage()`, contest band buttons, `toggleBand()`, `getContestFreqs()`, `contest_freqs` in payload, Year/SSN integer validation
- `templates/prediction_area.html` — Download Image button placement (area-chart-controls), download modal HTML, `openAreaDownloadModal()` / `closeAreaDownloadModal()` / `executeAreaDownload()` / `drawGeoJSONFeature()`, grayline variables + `solarParams()` + `renderGraylineCanvas()` + `refreshGrayline()`, grayline pane init, `stepHour()` + prediction completion call `refreshGrayline()`, Year/SSN integer validation, Hour integer validation fix, download modal bounds validation
- `routes/api.py` — `contest_freqs` from payload used in P2P contest-mode backend pass
- `static/css/style.css` — `.band-label` cursor + `.band-label.inactive` gray state, `.area-info-box` rule added

---

### Session 21: Merge Recovery + Contester's Table PDF Export
**Date**: April 13, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Restore codebase after branch merge, add "Generate Contester's Table" PDF export to P2P page
**Duration**: 0.75 hours (15:30–16:15)
**Status**: Complete

**Activities**:
- Resolved post-merge damage: `routes/api.py` missing `import math, os, platform, re, subprocess, uuid` (file loaded but all prediction calls crashed); `templates/both.html` missing hamburger nav; `templates/prediction.html` missing entirely; `routes/views.py` missing `/prediction`, `/prediction/p2p`, `/prediction/area` routes; `itu_r_hf/ITURHFProp/Linux/ITURHFProp` binary missing; `itu_r_hf/ITURHFProp/Data/` directory missing — all restored from `feature/prediction-page-architecture+p2p-prediction` branch via `git checkout <branch> -- <path>`
- Fixed Session 14/15 order in CLAUDE.md (BCR/MUF chart session was listed before the mini-map session; corrected so Session 14 = mini-map 10:15–11:00, Session 15 = chart 20:30–22:30)
- Added "Generate Contester's Table" button to P2P results action row (alongside Copy to Clipboard and Download CSV)
- Band-selection modal: six checkboxes (160m–10m, all pre-checked), Cancel closes without generating, overlay click also closes
- Print window opens in new tab via `window.open()` — user triggers print manually (removed auto-`win.print()` so canvas graphs have time to render)
- Page 1: MUF & OPMUF — two side-by-side 3×13 tables (hours 1–12 / 13–24)
- Per-band pages: two side-by-side 4×13 tables (Hour, BCR, SNR, PR in S-units) + three stacked canvas line graphs (BCR blue, SNR orange, PR green) at 500×150px each
- PR column and PR chart both use IARU HF S-meter scale: S9 = −103 dBW, 6 dB per S-unit, clamped S0–S9 via `dBWtoS()` helper
- `freqToIdx(mhz)` maps contest band frequencies to `bcr/snr/pr` array indices using `Math.round(mhz) - 1`, matching backend's `parse_chart_data()` logic
- All chart data serialized as JSON embedded in print window's `<script>` block; `window.onload` draws all canvases before user prints

**Key Decisions**:
- `window.open()` + `win.document.write()` for PDF: zero dependencies, fully offline, browser Print → Save as PDF handles formatting; no jsPDF or server-side PDF library needed
- Removed `win.print()` auto-call: canvas `drawChart()` runs in `window.onload` of the new window, but the print dialog would fire before the load event completed — user now clicks Ctrl+P/⌘P at their discretion
- Two side-by-side 13-row table halves: guarantees fit on portrait letter regardless of font size or browser zoom

**Files Modified**:
- `templates/prediction_p2p.html` — "Generate Contester's Table" button, band-selection modal HTML, `openTableModal()` / `closeTableModal()` / `makeTableHtml()` / `generateContestersTable()`, `BAND_NAMES` constant, `freqToIdx()`, `dBWtoS()`
- `static/css/style.css` — Section 16: table modal overlay + panel styles
- `routes/api.py` — missing standard library imports restored
- `routes/views.py` — prediction routes restored
- `templates/both.html` — hamburger nav restored
- `templates/prediction.html` — recreated from branch history
- `itu_r_hf/ITURHFProp/Linux/ITURHFProp` — binary restored from branch
- `itu_r_hf/ITURHFProp/Data/` — data directory restored from branch
- `docs/CLAUDE.md` — session order fix, this session record

### Session 22: Area Map PR Fix + Map Layout Overhaul
**Date**: April 17, 2026
**Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Contributor**: Liam Miller (KD3BVX)
**Scope**: Fix PR heatmap display on area map; overhaul map layout (tooltip/legend visibility, map sizing, world-edge clipping); fix PR column detection bug and contour alignment
**Duration**: 1.5 hours (09:45–11:15)
**Status**: Complete

**Activities**:
- Investigated compute cost of P2P vs Area predictions: P2P runs 1–2 ITURHFProp subprocess calls (~720 grid points, 120s timeout); Area runs 1 call with a global grid up to 1.57M points at 1° resolution (300s timeout) — Area is substantially heavier
- Fixed PR heatmap showing all yellow (original bug): switched from raw dBW scale (dataMin/dataMax = -163/-103 dBW) to S-unit scale (dataMin=0, dataMax=9); S-unit formula: `S = floor(9 + (dBW + 103) / 6)`, clamped 0–9 (IARU HF standard, S9 = −103 dBW, 6 dB per S-unit); contour levels updated to `[1,2,...,8]`; legend labels to `'S0'–'S9'`; hover tooltip shows `"PR: S5 (-133.2 dBW)"` (S-unit + raw dBW in parentheses)
- Fixed PR heatmap still all yellow after S-unit fix: `parse_area_data()` initializes the `pr` grid with `None`; in JS `null ?? dataMin` where `dataMin=0` gave 0 dBW → S26 → clamped S9 → yellow for all grid cells with no mode; fix: added `rawFallback = areaMetric === 'pr' ? -999 : dataMin` so null cells resolve to −999 dBW → S = max(0, floor(9 + (−999+103)/6)) = 0 → norm=0% → transparent; applied in both the live overlay renderer and the download PNG renderer
- Hidden tooltip before prediction: `area-info-box` div now has `style="display:none"` on the Leaflet control container at `onAdd` time; revealed via `document.getElementById('area-info-box').style.display = ''` in the prediction response handler
- Hidden legend before prediction: removed Leaflet legend control; replaced with a plain `#area-legend-wrapper` DOM element (sibling of `#area-map` in a flex row); `display: none` until prediction runs; dark background matching P2P legend box (`rgba(0,0,0,0.72)`, `border: 1px solid #333`, `border-radius: 4px`, `padding: 6px 8px`)
- Map layout: wrapped `#area-map` and `#area-legend-wrapper` in `#area-map-row` flex container (`gap: 12px`); `#area-map { flex: 1; height: 500px }` matches P2P style; `#area-legend-wrapper { flex-shrink: 0; align-self: center }`
- Map centers on TX after prediction: `areaMap.setView([txLat, txLng], 4, { animate: false })` called in prediction response handler; zoom 4 gives useful regional view
- `lockWorldWidth()`: added `zoomSnap: 0.1`, `maxBounds: [[-90,-180],[90,180]]`, `maxBoundsViscosity: 1.0` to map init; `lockWorldWidth()` computes `minZoom = log2(containerWidth / 256)` so Mercator world width exactly fills the container — eliminates empty ocean strips on left/right; called after basemap loads, on window resize, and after legend appears; re-locks on `areaMap.invalidateSize()` when legend sidebar shifts container width

**Key Decisions**:
- S-unit scale (not dBW): ITURHFProp PR values for strong signals exceed −103 dBW (e.g. −80 dBW), which is above the old dataMax and would clamp to 100% yellow; S-units put the full usable signal range on a 0–9 scale with natural breakpoints
- `−999 dBW` sentinel (not `dataMin=0`): a null grid cell means "no propagation mode" — it should render transparent, not as an S0 signal; −999 gives S = max(0, −149) = 0 → norm=0% → transparent; −307 "no-mode" floats already stored by the backend also resolve to S=0 transparently
- `lockWorldWidth()` instead of fixed aspect ratio: the container width changes when the legend sidebar appears; fractional `minZoom` via `log2()` guarantees a pixel-exact fill regardless of container width

- Fixed PR column detection bug in `parse_area_data()`: the column description `"Receiver latitude (deg)"` contains the word "RECEIVER", so `col_pr` was being set to the latitude column index before the actual `"Pr - Median receiver power (dB)"` column was reached; every cell rendered S9 (yellow) because latitude values -90…90° all convert to S ≥ 11 → clamped S9; fix: added `and 'POWER' in desc` so the check requires both 'RECEIVER' and 'POWER' — matches the power column but not the lat/lon columns
- Fixed PR contour lines appearing in the middle of color bands: with `dataMax=9`, each S-unit = 11.1% of the Viridis range but the legend uses 10 blocks of 10% each — contour lines at integer S-units landed at 11.1%, 22.2%… (inside blocks) instead of at 10%, 20%… (block boundaries); fix: changed `dataMax` to `10` so each S-unit = exactly 10% of the Viridis range, and added S9 to `contourLevels` (`[1,2,3,4,5,6,7,8,9]`); now matches BCR/SNR behavior
- Fixed PR heatmap appearing banded/blocky instead of smooth: `Math.floor()` in the S-unit conversion quantized interpolated dBW values into only 10 discrete levels; removed `Math.floor()` (now `9 + (val + 103) / 6`, still clamped 0–9) for continuous S-unit values in both live and download renderers; hover tooltip retains `Math.floor()` for integer S-unit display

**Key Decisions**:
- S-unit scale (not dBW): ITURHFProp PR values for strong signals exceed −103 dBW (e.g. −80 dBW), which is above the old dataMax and would clamp to 100% yellow; S-units put the full usable signal range on a 0–9 scale with natural breakpoints
- `−999 dBW` sentinel (not `dataMin=0`): a null grid cell means "no propagation mode" — it should render transparent, not as an S0 signal; −999 gives S = max(0, −149) = 0 → norm=0% → transparent; −307 "no-mode" floats already stored by the backend also resolve to S=0 transparently
- `lockWorldWidth()` instead of fixed aspect ratio: the container width changes when the legend sidebar appears; fractional `minZoom` via `log2()` guarantees a pixel-exact fill regardless of container width
- `'POWER' in desc` guard: prevents the lat/lon columns from being confused with the PR power column; both contain 'RECEIVER' but only the power column contains 'POWER'
- `dataMax=10` (not 9): with 9 S-unit steps and 10 Viridis blocks, using dataMax=9 caused an 11.1%/10% mismatch; dataMax=10 makes each integer S-unit boundary coincide exactly with a Viridis block boundary

**Files Modified**:
- `routes/api.py` — `parse_area_data()` col_pr detection changed from `'RECEIVER' in desc` to `'RECEIVER' in desc and 'POWER' in desc`
- `templates/prediction_area.html` — PR S-unit conversion in overlay and download renderers; `rawFallback` null sentinel; `area-info-box` hidden until prediction; `#area-legend-wrapper` DOM sidebar replacing Leaflet control; map init with `zoomSnap`/`maxBounds`/`maxBoundsViscosity`; `lockWorldWidth()` helper; post-prediction handler (`setView`, `invalidateSize`, `lockWorldWidth`); window resize listener; `Math.floor()` removed from S-unit conversion (continuous rendering); `dataMax` changed 9→10; `contourLevels` extended to include S9
- `static/css/style.css` — Section 13b rewritten: `#area-map-row` flex row, `#area-map` (flex:1, 500px, ocean-blue bg), `#area-legend-wrapper` (flex-shrink:0, dark bg, hidden by default), `.area-info-box` (dark bg, courier font)

---

## Version History

| Version | Date | Changes | Model Used |
|---------|------|---------|------------|
| 1.0 | January 22, 2026 | Initial creation of CLAUDE.md | Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) |
| 1.1 | February 2, 2026 | Added Session 4: project planning and issue board setup | Claude Opus 4.5 (claude-opus-4-5-20251101) |
| 1.2 | February 9, 2026 | Added Session 5: Milestone 1 issues created, workload balanced, FRC milestone added | Claude Opus 4.6 (claude-opus-4-6) |
| 1.3 | February 13, 2026 | Added Session 6: Leaflet vendored + offline basemap (Issue #37) | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 1.4 | February 21, 2026 | Added Session 7: receiver config extracted to .env (Issue #38) | Claude Opus 4.6 (claude-opus-4-6) |
| 1.5 | February 21, 2026 | Added Session 8: connection status indicator (Issue #36, FR-UI-03) | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 1.6 | February 21, 2026 | Added Session 9: DB health check, 3-state indicator, smarter timestamp | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 1.7 | February 27, 2026 | Added Session 10: Milestone 1 audit, #36/#38/#40/#41 fixes, polyline removal, lastInterval sync, doc updates | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 1.8 | March 1, 2026 | Added Session 11: 404 error diagnosis — OSM tile layer conflict with offline basemap | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 1.9 | March 1, 2026 | Added Session 12: Issue #37 complete — offline basemap, favicon, shadow fix, label a11y, lastInterval cross-iframe sync | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.0 | April 4, 2026 | Added Session 13: ITU-R HF Prop prediction interface — nav menu, prediction page scaffolding, P2P form, WSL subprocess integration | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.1 | April 9, 2026 | Added Session 14: P2P map — offline basemap, draggable TX/RX markers, geodesic arc, legend, default Scranton→London path | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.2 | April 9, 2026 | Added Session 15: P2P BCR/MUF chart — Canvas heatmap, contour lines, MUF spline, hover tooltip, MUF/OPMUF toggle with percentile labels | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.3 | April 10, 2026 | Added Session 16: chart polish (Viridis, vermillion MUF line, antenna dropdowns, grey background), contest/single frequency output filtering with two-run backend | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.4 | April 10, 2026 | Added Session 17: auto-scroll fix, responsive stacking, BCR/SNR/PR metric buttons, S-meter PR scale, discrete legend, generalised contours, MUF edge clamp, results export (copy/download CSV) | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.5 | April 11, 2026 | Added Session 18: area prediction page — map, form, backend, Viridis heatmap overlay, contour lines (dense sampled grid), transparent low band, time/metric/opacity/resolution controls, results export | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.6 | April 11, 2026 | Added Session 19: area overlay polish — viewport canvas blur fix, lon wrap fix, boundary contour, hover info box, color-bar legend, Very High 1°→2° | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.7 | April 12, 2026 | Added Session 20: download image (P2P + Area), grayline overlay, contest band toggles, input validation audit (Year/SSN integer checks), button placement fixes | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.8 | April 13, 2026 | Added Session 21: merge recovery, Contester's Table PDF export (modal, MUF/OPMUF table, per-band BCR/SNR/PR tables + canvas graphs), CLAUDE.md fixes | Claude Sonnet 4.6 (claude-sonnet-4-6) |
| 2.9 | April 17, 2026 | Added Session 22: area map PR S-unit fix, null fallback -999 sentinel, tooltip/legend hidden until prediction, dark-box legend sidebar, P2P-style windowed map (500px), lockWorldWidth() side-clip, PR column detection bug (RECEIVER+POWER fix), contour alignment (dataMax 9→10), smooth rendering (removed Math.floor) | Claude Sonnet 4.6 (claude-sonnet-4-6) |

---

## License and Attribution

This documentation file is part of the HamSCI Contesting and DXing Dashboard project. The project is licensed under the GNU General Public License v3.0. All AI assistance provided by Claude (Anthropic) should be acknowledged in project documentation and publications as appropriate.

**Recommended Citation Format**:
```
This project was developed with assistance from Claude (Anthropic) AI assistant.
See docs/CLAUDE.md for detailed contribution history.
```

---

## Additional Resources

### HamSCI and PSWS
- HamSCI Community: https://hamsci.org/
- PSWS Database: http://psws.hamsci.org
- WSPRDaemon: http://wsprdaemon.org/

### Amateur Radio Resources
- CQ Zones Map: http://www.cqmaps.com/zones.htm
- ITU Zones Map: http://www.dxmaps.com/ituzone.html
- WSPR Activity: https://wsprnet.org/
- PSK Reporter: https://pskreporter.info/
- Reverse Beacon Network: http://reversebeacon.net/

### Technical Documentation
- Leaflet Documentation: https://leafletjs.com/reference.html
- Turf.js Documentation: https://turfjs.org/
- Flask Documentation: https://flask.palletsprojects.com/
- MongoDB Documentation: https://www.mongodb.com/docs/

---

*This file should be updated after each significant Claude session to maintain an accurate record of AI contributions to the project.*
