# Archive Directory

This directory contains legacy code from earlier development iterations of the HamSCI Contesting Dashboard. These files have been superseded by the current production codebase but are preserved here for historical reference.

---

## Directory Structure

```
_archive/
├── legacy_python/       # Deprecated Flask backend variants
├── legacy_javascript/   # Deprecated frontend JavaScript files
└── legacy_templates/    # Deprecated HTML templates
```

---

## Legacy Python (Backend)

### web-mongo.py
- **Original purpose**: Early Flask backend with country-based filtering
- **Deprecated**: Replaced by `web-ft.py` which adds FT8/FT4 support and improved filtering
- **Key differences from current**: Limited to WSPR-only, basic country filtering

### web-time.py
- **Original purpose**: Experimental variant with time-based filtering
- **Deprecated**: Time filtering integrated into `web-ft.py` with `lastInterval` parameter
- **Key differences from current**: Separate implementation for time-based queries

---

## Legacy JavaScript (Frontend)

### map.js (19KB)
- **Original purpose**: First implementation of Leaflet map visualization
- **Deprecated**: Replaced by `map_ft.js` with enhanced filtering and mode support
- **Key differences from current**:
  - WSPR-only (no FT8/FT4)
  - Limited geographic filtering
  - No CQ/ITU zone support

### map_time.js
- **Original purpose**: Time-based variant of map visualization
- **Deprecated**: Time filtering integrated into `map_ft.js`
- **Key differences from current**: Separate codebase for time-based display

### table.js
- **Original purpose**: Original table view implementation
- **Deprecated**: Replaced by `table_ft.js` with regional aggregation
- **Key differences from current**:
  - Different data structure
  - No regional grouping by CQ zones

### table_time.js
- **Original purpose**: Time-based variant of table view
- **Deprecated**: Time filtering integrated into `table_ft.js`
- **Key differences from current**: Separate implementation for time-based display

### onload.js (3 lines)
- **Original purpose**: Page initialization script
- **Current status**: Contains only commented-out code (wspr.live notification)
- **Note**: Effectively dead code, preserved for historical reference only

---

## Legacy Templates (HTML)

### index.html
- **Original purpose**: Original map interface with date/spot selection form
- **Deprecated**: Replaced by `index_ft.html` with improved UI and filtering
- **Key differences from current**: Different form layout, limited filter options

### index_time.html
- **Original purpose**: Time-based variant of map interface
- **Deprecated**: Time filtering integrated into `index_ft.html`

### table.html
- **Original purpose**: Original table view template
- **Deprecated**: Replaced by `table_ft.html` with regional display

### table_time.html
- **Original purpose**: Time-based variant of table view
- **Deprecated**: Time filtering integrated into `table_ft.html`

---

## Current Production Files

For reference, the active production codebase consists of:

**Backend:**
- `web-ft.py` - Main Flask application with WSPR/FT8/FT4 support

**Frontend JavaScript:**
- `static/js/map_ft.js` - Map visualization (730 lines, fully documented)
- `static/js/table_ft.js` - Table view (183 lines, fully documented)
- `static/js/chart.js` - Spot counting (98 lines, in use)

**Templates:**
- `templates/both.html` - Combined map+table view
- `templates/index_ft.html` - Map interface
- `templates/table_ft.html` - Table interface
- `templates/index_wcount.html` - Alternative display with counter

**Documentation:**
- `README_DOCUMENTATION.md` - Technical documentation
- `OPERATOR_GUIDE.md` - User guide for radio operators
- `CONTRIBUTING.md` - Developer contribution guidelines

---

## Development Timeline

1. **Phase 1**: Initial WSPR-only implementation
   - Files: `web-mongo.py`, `map.js`, `table.js`, `index.html`, `table.html`
   - Features: Basic spot visualization, country filtering

2. **Phase 2**: Time-based filtering experiment
   - Files: `web-time.py`, `map_time.js`, `table_time.js`, `index_time.html`, `table_time.html`
   - Features: Added time window filtering

3. **Phase 3**: FT8/FT4 integration (current)
   - Files: `web-ft.py`, `map_ft.js`, `table_ft.js`, `index_ft.html`, `table_ft.html`
   - Features: Multi-mode support, CQ/ITU zones, enhanced filtering

---

## Why Files Were Archived

**Reasons for archival:**
- ✅ Superseded by improved implementations with more features
- ✅ Code duplication eliminated (multiple variants consolidated)
- ✅ Functionality integrated into current production codebase
- ✅ No longer referenced by active Flask routes or templates
- ✅ Preserved for historical reference and potential feature recovery

**Git history preservation:**
All files were moved using `git mv` to maintain full version control history.

---

## Recovery Instructions

If you need to reference or recover code from archived files:

1. **Read archived code:**
   ```bash
   cat _archive/legacy_python/web-mongo.py
   ```

2. **Restore archived file:**
   ```bash
   git mv _archive/legacy_python/web-mongo.py web-mongo.py
   ```

3. **View historical commits:**
   ```bash
   git log --follow _archive/legacy_python/web-mongo.py
   ```

---

## Contact

**Project Lead:**
Owen Ruzanski, KD3ALD
Email: owen.ruzanski@scranton.edu

**Organization:**
University of Scranton W3USR Amateur Radio Club
Frankford Radio Club

**Project:**
HamSCI Personal Space Weather Station Dashboard

---

*Archived on 2026-01-07 during documentation and cleanup effort*
