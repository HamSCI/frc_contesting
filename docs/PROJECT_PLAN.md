# DXDashboard Project Plan

**Status:** DRAFT - Updated February 9, 2026
**Created:** February 2, 2026
**Author:** Nathaniel Frissell (W2NAF) with Claude AI

## Overview

Development plan for the HamSCI DXDashboard, organized around four milestone dates with issues scoped for team assignment (KD3ALD, KD3BVX, and contributor-ready tasks for new CS students).

| Milestone | Date | Event |
|-----------|------|-------|
| 1 | Feb 28 | ARRL DX Contest SSB - Minimal Working System |
| 2 | Mar 12 | HamSCI Workshop Demo |
| 3 | Apr 14 | Frankford Radio Club Meeting Demo (sponsor feedback) |
| 4 | May 14 | Dayton Hamvention / Contest University |

## Team

- **W2NAF** - Project manager/PI
- **KD3ALD** - Lead student developer (architecture, modularity)
- **KD3BVX** - Student developer (propagation models, science)
- **Contributors** - Additional CS students (discrete, well-scoped tasks)

---

## MILESTONE 1: Minimal Working System (Due: Feb 28)

**Goal:** Stable, functional dashboard on W3USR system for ARRL DX Contest SSB.

**Note:** All issues below #31 are blocked by #31 (due Feb 16). Work splits into parallel tracks after that.

### Issues (all created on GitHub project board)

| # | Title | Assignee | Target Date | Labels |
|---|-------|----------|-------------|--------|
| #30 | Set-Up W3USR WSPRDaemon System | (unassigned) | Feb 9 | milestone-1 |
| #31 | Install, Test, Debug DXDashboard | KD3ALD | Feb 16 | milestone-1 |
| #32 | Remove Broken onload.js Script Reference | KD3ALD | Feb 17 | bug, milestone-1 |
| #37 | Vendor Leaflet.js Locally (Remove CDN) | KD3BVX | Feb 17 | offline-first, blocker, milestone-1 |
| #38 | Extract Receiver Callsign/Grid to Configuration | KD3BVX | Feb 20 | architecture, blocker, milestone-1 |
| #33 | Split web-ft.py Into Modular Backend Components | KD3ALD | Feb 21 | architecture, milestone-1 |
| #34 | Create Shared JavaScript Config Module (config.js) | KD3ALD | Feb 21 | architecture, milestone-1 |
| #39 | Create Central CSS Stylesheet (Extract Inline Styles) | KD3BVX | Feb 21 | architecture, UI/UX, milestone-1 |
| #35 | Extract Shared JS Utility Functions (utils.js) | KD3ALD | Feb 24 | architecture, milestone-1 |
| #40 | Add ITU Zone Overlay Rendering on Map | KD3BVX | Feb 28 | science, enhancement, milestone-1 |
| #36 | Add Connection Status Indicator | KD3ALD | Feb 28 | enhancement, milestone-1 |
| #41 | Add Last-Update Timestamp Display | KD3BVX | Feb 28 | enhancement, milestone-1 |

### Critical Path
```
#30 (WSPRDaemon) -> #31 (Install/Test) --+--> KD3ALD: #32 onload.js -> #33 backend split -> #34 config.js -> #35 utils.js -> #36 connection status
                                          |
                                          +--> KD3BVX: #37 Leaflet -> #38 receiver config -> #39 CSS -> #40 ITU overlay -> #41 timestamp
                                                                           |
                                                          KD3ALD #34 config.js depends on this
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

## MILESTONE 3: Frankford Radio Club Demo (Due: Apr 14)

**Goal:** Solid, deployable system to demo for FRC (project sponsor). Collect feedback to incorporate before Hamvention.

### Issues to Create

**Testing (Mar 15 - Apr 1):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Set Up Python Backend Test Framework (pytest) | contributor | Apr 1 | contributor-ready, milestone-3 |
| Set Up JavaScript Frontend Test Framework | contributor | Apr 7 | contributor-ready, milestone-3 |

**Deployment (Apr 1-11):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Create Dockerfile and Docker Compose | contributor | Apr 11 | contributor-ready, milestone-3 |
| Create systemd Service File and Deploy Docs | contributor | Apr 11 | contributor-ready, milestone-3 |

**Polish for Demo (Apr 1-11):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Implement Dark/Light Theme Toggle | contributor | Apr 11 | UI/UX, contributor-ready, milestone-3 |

**Demo Preparation:**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Prepare FRC Demo and Collect Feedback | W2NAF + team | Apr 14 | documentation, milestone-3 |

---

## MILESTONE 4: Dayton Hamvention (Due: May 14)

**Goal:** Production-quality system incorporating FRC feedback, with advanced features and full documentation.

### Issues to Create

**FRC Feedback (Apr 15-25):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Incorporate FRC Demo Feedback | KD3ALD + KD3BVX | Apr 25 | milestone-4 |

**External Data Integration (Apr 15 - May 7):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Optional RBN Data Integration | KD3BVX | May 7 | science, milestone-4 |
| Optional PSK Reporter Integration | KD3BVX | May 7 | science, milestone-4 |

**Advanced Features (Apr 15 - May 7):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Add Rate Limiting to API Endpoints | contributor | May 7 | contributor-ready, milestone-4 |
| Implement Tablet-Responsive Layout | contributor | May 7 | UI/UX, contributor-ready, milestone-4 |

**Cleanup and Documentation (May 1-14):**

| Title | Assignee | Due | Labels |
|-------|----------|-----|--------|
| Remove Legacy/Archive Code | KD3ALD | May 7 | architecture, milestone-4 |
| Update All Documentation | KD3ALD + KD3BVX | May 14 | documentation, milestone-4 |
| Prepare Hamvention Demo | W2NAF + team | May 14 | documentation, milestone-4 |

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

**KD3ALD:** #31, #32 onload.js, #33 backend split, #34 config.js, #35 utils.js, #36 connection status, Combined view rewrite, FRC feedback, Legacy cleanup, Documentation, Hamvention demo

**KD3BVX:** #37 Vendor Leaflet, #38 receiver config, #39 CSS, #40 ITU overlay, #41 timestamp, MUF estimation, Great circle paths, FRC feedback, RBN integration, PSK Reporter integration, Documentation, Hamvention demo

**Contributors:** Filter layout, Table styling, Visual feedback, CSV export, Python tests, JS tests, Docker, systemd, Dark theme, Rate limiting, Tablet layout, plus 4 backlog items

---

## Execution Plan

1. ~~Create GitHub labels for issue categorization~~ (Done Feb 9)
2. ~~Create all Milestone 1 issues~~ (Done Feb 9 — issues #30-41 on project board)
3. Create all Milestone 2 issues (7 issues)
4. Create all Milestone 3 issues (6 issues)
5. Create all Milestone 4 issues (8 issues)
6. Create backlog issues (4 issues)
7. Add all new issues to project board with appropriate status columns and target dates

---

## Open Decisions

- Include great circle path rendering? (not in REQUIREMENTS.md but scientifically relevant)
- MUF estimation approach: simple heuristic vs. defer to KD3BVX's expertise?
- Create remaining issues all at once or incrementally by milestone?
