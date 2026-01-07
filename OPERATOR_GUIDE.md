# HamSCI Contesting Dashboard - Operator Quick Reference

**Station:** KD3ALD Personal Space Weather Station
**Location:** FN21ni (Northern New Jersey)
**Dashboard:** http://dash.kd3ald.com

---

## Quick Start

### What This Dashboard Shows

This dashboard displays **real-time HF propagation conditions** by showing decoded WSPR, FT8, and FT4 spots from the KD3ALD receiver. Each spot represents a successful digital mode reception, indicating that a particular band is open to that location.

**Use this dashboard to answer:**
- ✅ What bands are currently open?
- ✅ Where are they open to (which countries/continents)?
- ✅ Which band has the most activity right now?
- ✅ Is 20m open to Europe? Is 40m open to the Pacific?
- ✅ Should I try 80m or 40m for the next contest contact?

---

## Dashboard Views

### 1. Map View (`/map`)

Interactive world map showing propagation paths with colored markers.

**What You See:**
- **Colored stars** = Transmitter locations (color = band)
- **Grey lines** = Propagation path from TX to RX (your station)
- **Blue markers** = Receiver location (KD3ALD)
- **Spot counter** (bottom-right) = How many spots on each band

**Color Guide:**
| Band | Color | Contest Band? |
|------|-------|---------------|
| 160m | ⚫ Black | ✅ Yes |
| 80m | 🔴 Red | ✅ Yes |
| 60m | 🟠 Orange-dark | No (shared) |
| 40m | 🟠 Orange | ✅ Yes |
| 30m | 🟡 Yellow | No (WARC) |
| 20m | 🟢 Green | ✅ Yes |
| 17m | 🟢 Green-light | No (WARC) |
| 15m | 🔵 Cyan | ✅ Yes |
| 12m | 🔵 Blue-dark | No (WARC) |
| 10m | 🔵 Blue-dark | ✅ Yes |
| 6m | 🟣 Purple | No (VHF) |

**How to Use:**
1. **Check band openings:** Look for clusters of colored stars in target regions
2. **Click on markers:** See details (callsign, SNR, time, frequency)
3. **Click on lines:** See propagation path details
4. **Use filters:** Narrow down to specific bands or regions (see below)

---

### 2. Table View (`/table`)

Tabular display showing spot counts by region and band.

**What You See:**
- **Rows:** Geographic regions (Europe, North America, Asia, etc.)
- **Columns:** Contest bands (160m, 80m, 40m, 20m, 15m, 10m)
- **Numbers:** How many spots received from that region on that band
- **Green cells:** Active bands (1+ spots received)

**How to Use:**
1. **Quick band scan:** See at a glance which bands are open to which regions
2. **Compare activity:** Higher numbers = more activity/better propagation
3. **Plan next QSO:** Choose band with most spots to your target region

**Example:**
```
Region        | 160 | 80 | 40 | 20 | 15 | 10 |
Europe        |     | 3  | 12 | 45 | 8  | 2  |
North America |  1  | 15 | 32 | 18 |    |    |
```
Translation: 20m is HOT to Europe (45 spots)! 40m good to North America (32 spots).

---

### 3. Combined View (`/` or root)

Side-by-side display of map and table in iframes. Best for multi-monitor setups or large screens.

---

## Using the Filters

### Time Filter

**Control:** "Last Interval" (minutes)
**Options:** Any number (default: 15 minutes)

**What it does:** Shows only spots received in the last N minutes.

**Recommendations:**
- **Contesting:** Use 5-15 minutes for real-time band conditions
- **Casual DXing:** Use 30-60 minutes to see trends
- **Solar events:** Use 2-5 minutes during flares or aurora

---

### Band Filter

**Control:** "Band" dropdown
**Options:** All bands, individual bands (160m-2m), or "Contest Bands"

**Contest Bands Mode:**
Filters to only the 6 traditional HF contest bands: **160m, 80m, 40m, 20m, 15m, 10m**.
Excludes WARC bands (30m, 17m, 12m) where contesting is not allowed.

**When to use:**
- ✅ During contests → Select "Contest Bands"
- ✅ Looking for specific band → Select individual band (e.g., "20m")
- ✅ General monitoring → Leave on "All Bands"

---

### Country Filter

**Control:** "Country" dropdown
**Options:** All countries, specific country, or "Non-US"

**Special Options:**
- **"Non-US":** Shows only DX (non-USA) spots - useful for USA operators seeking DX contacts
- **Specific country:** Filter to one country (e.g., "Japan", "Germany")

**Contest Use:**
During DX contests (e.g., CQWW, ARRL DX), use "Non-US" to see only DX propagation.

---

### Continent Filter

**Control:** "Continent" dropdown
**Options:** All, Africa, Asia, Europe, North America, Oceania, South America

**When to use:**
- Working specific continent multipliers in contests
- Checking propagation to target region
- Example: "Is 40m open to Europe right now?"

---

### CQ Zone Filter

**Control:** "CQ Zone" dropdown
**Options:** All zones, zones 1-40

**What are CQ Zones?**
Amateur radio contest zones (1-40) defined by CQ Magazine. Used for zone multipliers in contests like CQWW.

**Example Zones:**
- Zone 3: West Coast USA
- Zone 4: Central USA
- Zone 5: East Coast USA (includes KD3ALD receiver)
- Zone 14-16, 20: Europe
- Zone 25: Japan

**Contest Use:**
Select specific zone you need for multiplier in CQWW or zone-based contests.

---

### ITU Zone Filter

**Control:** "ITU Zone" dropdown
**Options:** All zones, zones 1-90

**What are ITU Zones?**
International Telecommunication Union zones (1-90). Used for ITU multipliers in some contests.

**When to use:**
Less common than CQ zones, but useful for ITU-based contests or awards.

---

### Mode Filter

**Controls:** WSPR, FT8, FT4 checkboxes
**Default:** All modes selected (show everything)

**What the modes mean:**
- **WSPR:** Weak Signal Propagation Reporter (2-minute cycles)
  - Good for: Long-distance propagation testing, band monitoring
  - Typical SNR: -30 to +10 dB
- **FT8:** Fast 8FSK mode (15-second transmissions)
  - Good for: Quick contacts, weak signal DX, contests
  - Most popular digital mode currently
- **FT4:** Fast 4FSK mode (7.5-second transmissions)
  - Good for: Contests requiring speed
  - Less common than FT8

**When to filter by mode:**
- Contesting with FT8 → Uncheck WSPR and FT4
- Propagation research → Check only WSPR
- General use → Leave all checked

---

### CQ Zone Outline Toggle

**Control:** "Show CQ Outlines" checkbox
**What it does:** Draws CQ zone boundaries on the map with zone numbers

**When to use:**
- Learning CQ zone geography
- Visually identifying which zones are being spotted
- Planning mult strategy in CQWW contest

---

### Auto-Reload Interval

**Control:** "Auto Reload" dropdown
**Options:** Off, 2 min, 5 min, 10 min, 15 min, 30 min

**What it does:** Automatically refreshes the page every N minutes to show new spots.

**Recommendations:**
- **Active contesting:** 2-5 minutes
- **Casual monitoring:** 15-30 minutes
- **Battery-powered device:** Off or 30 minutes
- **Important:** Page reloads can interrupt interactions, turn off if actively clicking around

---

## Interpreting the Data

### Signal-to-Noise Ratio (SNR)

When you click a marker, you'll see SNR in dB (decibels).

**What SNR means:**
- **-20 dB or below:** Very weak signal (WSPR can decode this!)
- **-10 to 0 dB:** Weak but solid copy
- **0 to +10 dB:** Good signal
- **+10 dB or higher:** Strong signal

**For contesting:**
Higher SNR = easier to make contact. But even -10 dB can work with FT8!

---

### Spot Density

**Many spots to a region = good propagation!**

If you see 50 spots on 20m to Europe but only 2 spots on 15m, **work 20m to Europe**.

**Why spot count matters:**
- More spots = more stations active = better propagation
- Few spots might mean:
  - Band just opening (check again in 10-15 minutes)
  - Band closing
  - Low activity time (middle of night in target region)
  - Propagation is poor

---

### Time of Day Effects

**HF propagation changes throughout the day:**

**Low Bands (160m, 80m):**
- Best: Nighttime (local and target region)
- Poor: Daytime (D-layer absorption)
- Peak: 2-3 hours before sunrise (grey line)

**Mid Bands (40m, 30m):**
- Good: 24 hours, but changes character
- Daytime: Shorter skip (regional)
- Nighttime: Longer skip (DX)

**High Bands (20m, 17m, 15m, 12m, 10m):**
- Best: Daytime
- Poor: Nighttime (especially 10m)
- Peak: Solar maximum years (we're currently in solar cycle 25 rise!)

**6m:**
- Sporadic E in summer
- F2 propagation during high solar activity

---

## Contest Strategy Tips

### Before the Contest

1. **Monitor for 24-48 hours:** Learn propagation patterns
2. **Note opening times:** When does 20m open to EU from your QTH?
3. **Check solar indices:** High SFI (>150) = good high band conditions

### During the Contest

1. **Check dashboard every 10-15 minutes**
2. **Compare bands:** Which has most spots to target region?
3. **Look for openings:** New spots appearing = band opening
4. **Watch for closings:** Spots disappearing = move to another band
5. **Use table view:** Quick scan of all bands at once

### Example Contest Scenario

**Situation:** CQWW SSB Contest, Saturday afternoon, you need European multipliers

**Dashboard Check:**
```
Europe spots (last 15 min):
20m: 45 spots, SNR avg -5 dB
15m: 12 spots, SNR avg +8 dB
10m: 2 spots, SNR avg +12 dB
```

**Strategy:**
1. ✅ **Call CQ on 20m** - most activity, good SNR
2. ✅ **Monitor 15m** - good signals, might have less competition
3. ❌ **Skip 10m** - too few spots, not worth it yet
4. ✅ **Check again in 30 minutes** - 10m might improve as sun angle changes

---

## Understanding Your Receiver (KD3ALD PSWS)

### What the Receiver Does

The Personal Space Weather Station at KD3ALD **continuously monitors all HF bands** using:
- **RX-888 MkII SDR** (software defined radio)
- **30 MHz bandwidth** (covers 0.3-30 MHz simultaneously!)
- **KA9Q-radio software** (multichannel receiver)
- **WSPRDaemon** (decodes WSPR, FT8, FT4)
- **GPS-disciplined oscillator** (precision timing)

### Data Collection

**Receiver location:** FN21ni grid square (Northern New Jersey)

**What it decodes:**
- WSPR on all amateur bands (2200m through 6m)
- FT8 on popular frequencies
- FT4 on contest frequencies

**Update cycle:**
- WSPR: Every 2 minutes (even minutes)
- FT8: Every 15 seconds
- FT4: Every 7.5 seconds

**Data flow:**
1. Receiver decodes spots
2. Uploaded to MongoDB database (***REDACTED_HOST***)
3. Dashboard queries database
4. You see spots on map/table!

### Receiver Limitations

**Important to know:**
- ⚠️ **One receiver only:** Dashboard shows propagation **TO** KD3ALD (FN21ni)
- ⚠️ **Not transmitting:** KD3ALD receiver is RX-only (doesn't transmit)
- ⚠️ **Local noise:** Urban QTH may have higher noise floor
- ⚠️ **Antenna limitations:** Small active antenna (not a beam or large wire)

**What this means for you:**
- **Dashboard shows:** What stations can hear at KD3ALD location
- **Dashboard doesn't show:** What you'll hear at YOUR location
- **But:** HF propagation is generally reciprocal, so it's a good indicator!

**Best use:**
Use this dashboard as a **guide** for band conditions, but always verify with your own equipment. If the dashboard shows 20m open to Europe, there's a good chance it's open from your QTH too!

---

## Troubleshooting

### No Spots Showing

**Possible causes:**
1. **Time filter too narrow:** Try increasing "Last Interval" to 30-60 minutes
2. **Band conditions poor:** Try different band or different time of day
3. **All filters applied:** Reset filters to defaults (click "Update")
4. **Receiver offline:** Check if dashboard title shows recent update time

### Map Not Loading

**Solutions:**
1. **Clear browser cache:** Ctrl+F5 (Windows) or Cmd+Shift+R (Mac)
2. **Check internet connection:** GeoJSON files are large (~18MB)
3. **Try different browser:** Chrome, Firefox, or Edge
4. **Disable browser extensions:** Some ad blockers interfere with maps

### Markers Not Appearing

**Solutions:**
1. **Zoom out:** Try zooming out on the map
2. **Check band filter:** Make sure you're not filtering out all spots
3. **Check mode filter:** Make sure at least one mode is checked
4. **Wait for spots:** Increase "Last Interval" to 30 minutes

### Table Shows All Zeros

**Solutions:**
1. **Increase time interval:** Last 5 minutes might not have enough spots
2. **Check mode filters:** Make sure modes are selected
3. **Check band conditions:** Might be a propagation minimum
4. **Wait for new cycle:** WSPR updates every 2 minutes (even minutes UTC)

---

## Advanced Tips

### Using Multiple Dashboard Views

**Multi-monitor setup:**
- Monitor 1: Logging software (N1MM+, etc.)
- Monitor 2: Dashboard map view
- Monitor 3: Dashboard table view

**Single monitor:**
- Use combined view (`/`) for both map and table
- Or switch between `/map` and `/table` as needed

### Correlating with Other Tools

**Use this dashboard WITH:**
- **PSK Reporter** (pskreporter.info) - See what others are hearing
- **Reverse Beacon Network** (reversebeacon.net) - CW propagation
- **DX Cluster** (dxsummit.fi) - Real-time DX spots
- **VOACAP** (voacap.com) - Propagation predictions
- **Solar indices** (solarham.com) - Space weather data

**Dashboard advantage:**
Shows **actual measured propagation** from your local region, not predictions or crowdsourced data from distant locations.

### Exporting Data

**To save spot data:**
1. Open `/spots?lastInterval=60` in browser
2. Copy JSON data
3. Use for analysis, logging, or archival

**To screenshot:**
1. Press `PrtScn` (Windows) or `Cmd+Shift+4` (Mac)
2. Save image for contest reports or propagation studies

---

## Glossary

| Term | Definition |
|------|------------|
| **CQ Zone** | Amateur radio contest zones (1-40) defined by CQ Magazine |
| **DX** | Long-distance communication (typically international) |
| **FT4** | Fast 4FSK digital mode, 7.5-second transmissions |
| **FT8** | Fast 8FSK digital mode, 15-second transmissions |
| **Grid Square** | Maidenhead locator system (e.g., FN21ni) |
| **HF** | High Frequency (3-30 MHz) - shortwave radio bands |
| **ITU Zone** | Telecommunication zones (1-90) defined by ITU |
| **MUF** | Maximum Usable Frequency - highest frequency that will refract |
| **PSWS** | Personal Space Weather Station (HamSCI project) |
| **QTH** | Amateur radio slang for "location" |
| **SDR** | Software Defined Radio |
| **SNR** | Signal-to-Noise Ratio (in decibels) |
| **UTC** | Coordinated Universal Time (GMT/Zulu time) |
| **WARC** | World Administrative Radio Conference bands (30m, 17m, 12m) - no contesting |
| **WSPR** | Weak Signal Propagation Reporter, 2-minute transmissions |

---

## Contact and Support

**Dashboard Operator:**
Owen Ruzanski, KD3ALD
Email: owen.ruzanski@scranton.edu

**Receiver Station:**
KD3ALD, Grid FN21ni
Northern New Jersey, USA

**Project Website:**
University of Scranton W3USR Amateur Radio Club
HamSCI Personal Space Weather Station Project

**Report Issues:**
- Receiver offline
- Dashboard errors
- Feature requests
- Propagation questions

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial release with WSPR support |
| 2.0 | Jan 2026 | Added FT8 and FT4 support |
| 2.1 | Jan 2026 | Added table view and regional aggregation |
| 2.2 | Jan 2026 | Added contest bands filter |

---

**73 de KD3ALD - Good DX!**

*For technical documentation, see [README_DOCUMENTATION.md](README_DOCUMENTATION.md)*
