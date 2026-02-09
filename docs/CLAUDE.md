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

### Current Model

**Model**: Claude Opus 4.6
**Model ID**: claude-opus-4-6
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
- Cite line numbers when discussing code (e.g., `web-ft.py:198`)
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
- Interactive world map with propagation paths (FR-MAP-01)
- Colored star markers by band (FR-MAP-02)
- Lines connecting TX and RX stations (FR-MAP-03)
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

---

## Version History

| Version | Date | Changes | Model Used |
|---------|------|---------|------------|
| 1.0 | January 22, 2026 | Initial creation of CLAUDE.md | Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) |
| 1.1 | February 2, 2026 | Added Session 4: project planning and issue board setup | Claude Opus 4.5 (claude-opus-4-5-20251101) |
| 1.2 | February 9, 2026 | Added Session 5: Milestone 1 issues created, workload balanced, FRC milestone added | Claude Opus 4.6 (claude-opus-4-6) |

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
