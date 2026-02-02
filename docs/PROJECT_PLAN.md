# DXDashboard Project Plan

**Status:** DRAFT - To be finalized in next planning session
**Created:** February 2, 2026
**Author:** Nathaniel Frissell (W2NAF) with Claude Opus 4.5

## Overview

Development plan for the HamSCI DXDashboard, organized around three milestone dates with issues scoped for team assignment (KD3ALD, KD3BVX, and contributor-ready tasks for new CS students).

## Team

- **W2NAF** - Project manager/PI
- **KD3ALD** - Lead student developer (architecture, modularity)
- **KD3BVX** - Student developer (propagation models, science)
- **Contributors** - Additional CS students (discrete, well-scoped tasks)

---

## MILESTONE 1: Minimal Working System (Due: Feb 28)

**Goal:** Stable, functional dashboard on W3USR system for ARRL DX Contest SSB.

### Already Created
| Title | Assignee | Due | Status |
|-------|----------|-----|--------|
| #30 Set-Up W3USR WSPRDaemon System | (unassigned) | Feb 9 | Ready |
| #31 Install, Test, Debug DXDashboard | KD3ALD | Feb 16 | Ready |

### New Issues to Create

**Critical Blockers (no dependencies - can start immediately):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Vendor Leaflet.js Locally (Remove CDN) | contributor | Feb 14 | offline-first, blocker, good first issue |
| Remove Broken onload.js Script Reference | contributor | Feb 14 | bug, good first issue |

**Architecture - Backend (depends on #31):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Extract Receiver Callsign/Grid to Configuration | KD3ALD | Feb 21 | architecture, blocker |
| Split web-ft.py Into Modular Backend Components | KD3ALD | Feb 21 | architecture |

**Architecture - Frontend (config.js depends on receiver config extraction):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Create Central CSS Stylesheet (Extract Inline Styles) | contributor | Feb 21 | architecture, UI/UX, contributor-ready |
| Create Shared JavaScript Config Module (config.js) | KD3ALD | Feb 21 | architecture |
| Extract Shared JS Utility Functions (utils.js) | KD3ALD | Feb 24 | architecture |

**Feature Completion (independent tracks):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Add ITU Zone Overlay Rendering on Map | KD3BVX | Feb 28 | science, enhancement |
| Add Last-Update Timestamp Display | contributor | Feb 28 | enhancement, contributor-ready |
| Add Connection Status Indicator | contributor | Feb 28 | enhancement, contributor-ready |

### Milestone 1 Critical Path
```
#30 (WSPRDaemon) -> #31 (Install/Test) -> Config Extraction -> Backend Split -> config.js -> utils.js

Independent (start immediately):
  Vendor Leaflet.js, Remove onload.js, Central CSS, ITU overlay, Timestamp, Connection status
```

---

## MILESTONE 2: HamSCI Workshop Demo (Due: March 12)

**Goal:** Polished, demo-ready dashboard with modern UI and initial science features.

### Issues to Create

**Architecture:**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Replace iframe Combined View with Single-Page Layout | KD3ALD | Mar 7 | architecture |

**UI/UX Modernization:**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Redesign Filter Controls Layout | contributor | Mar 7 | UI/UX, contributor-ready |
| Modernize Table View Styling | contributor | Mar 10 | UI/UX, contributor-ready |
| Add Visual Feedback for Filter Changes | contributor | Mar 10 | UI/UX, contributor-ready |

**Science Features (KD3BVX):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Implement Basic MUF Estimation Display | KD3BVX | Mar 14 | science |
| Add Great Circle Path Rendering | KD3BVX | Mar 14 | science |

**Data Export:**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Add CSV Export Endpoint and Button | contributor | Mar 14 | enhancement, contributor-ready |

---

## MILESTONE 3: Dayton Hamvention (Due: May 14)

**Goal:** Production-quality system with testing, deployment, and advanced features.

### Issues to Create

**Testing (Apr 1-15):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Set Up Python Backend Test Framework (pytest) | contributor | Apr 1 | contributor-ready |
| Set Up JavaScript Frontend Test Framework | contributor | Apr 15 | contributor-ready |

**Deployment (Apr 1-15):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Create Dockerfile and Docker Compose | contributor | Apr 15 | contributor-ready |
| Create systemd Service File and Deploy Docs | contributor | Apr 15 | contributor-ready |

**External Data Integration (Apr 15 - May 7):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Optional RBN Data Integration | KD3BVX | May 7 | science |
| Optional PSK Reporter Integration | KD3BVX | May 7 | science |

**Advanced Features (Apr 15 - May 7):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Implement Dark/Light Theme Toggle | contributor | May 1 | UI/UX, contributor-ready |
| Add Rate Limiting to API Endpoints | contributor | May 7 | contributor-ready |
| Implement Tablet-Responsive Layout | contributor | May 7 | UI/UX, contributor-ready |

**Cleanup and Documentation (May 1-14):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Remove Legacy/Archive Code | KD3ALD | May 7 | architecture |
| Update All Documentation | KD3ALD + KD3BVX | May 14 | documentation |
| Prepare Hamvention Demo | W2NAF + team | May 14 | documentation |

---

## BACKLOG (No Fixed Milestone)

Good first issues for onboarding new contributors:

| Title | Labels |
|-------|--------|
| Add MongoDB Index Verification on Startup | contributor-ready |
| Implement Data Retention Policy Cleanup | contributor-ready |
| Fix Duplicate CQ Zone GeoJSON Files | good first issue |
| Auto-Populate Country Filter from GeoJSON | contributor-ready |

---

## Assignment Summary

**KD3ALD (9 issues):** #31, Config extraction, Backend split, config.js, utils.js, Combined view rewrite, Legacy cleanup, Documentation, Hamvention demo

**KD3BVX (7 issues):** ITU overlay, MUF estimation, Great circle paths, RBN integration, PSK Reporter integration, Documentation, Hamvention demo

**Contributors (18 issues):** Vendor Leaflet, Remove onload.js, Central CSS, Timestamp, Connection status, Filter layout, Table styling, Visual feedback, CSV export, Python tests, JS tests, Docker, systemd, Dark theme, Rate limiting, Tablet layout, plus 4 backlog items

---

## Execution Plan

1. Create GitHub labels for issue categorization
2. Create all Milestone 1 issues (10 new issues)
3. Create all Milestone 2 issues (7 new issues)
4. Create all Milestone 3 issues (11 new issues)
5. Create backlog issues (4 issues)
6. Add all issues to project board with appropriate status columns
7. Set milestone labels on all issues

---

## Open Decisions (for next planning session)

- Include great circle path rendering? (not in REQUIREMENTS.md but scientifically relevant)
- MUF estimation approach: simple heuristic vs. defer to KD3BVX's expertise?
- Create all issues at once or incrementally by milestone?
