# Contributing to HamSCI Contesting Dashboard

Thank you for your interest in contributing to the HamSCI Contesting and DXing Dashboard project! This document provides guidelines for contributing code, reporting issues, and collaborating on this open-source project.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Code Style Guidelines](#code-style-guidelines)
5. [Testing Guidelines](#testing-guidelines)
6. [Documentation Standards](#documentation-standards)
7. [Submitting Changes](#submitting-changes)
8. [Reporting Issues](#reporting-issues)

---

## Code of Conduct

### Our Pledge

This project follows amateur radio traditions of courtesy, cooperation, and mutual assistance. We welcome contributions from operators of all experience levels.

### Expected Behavior

- Be respectful and constructive in all communications
- Provide helpful feedback and accept feedback graciously
- Focus on what is best for the project and the amateur radio community
- Use welcoming and inclusive language
- Follow the amateur radio principles of service, experimentation, and skill-building

---

## Getting Started

### Prerequisites

Before contributing, ensure you have:
- Python 3.8+ installed
- MongoDB access (for testing database queries)
- Modern web browser with developer tools
- Basic understanding of Flask and JavaScript
- Familiarity with amateur radio concepts (bands, modes, propagation)

### Setting Up Development Environment

1. **Clone the repository:**
   ```bash
   git clone https://github.com/hamsci/contesting-dashboard.git
   cd contesting-dashboard
   ```

2. **Create virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # or venv\Scripts\activate on Windows
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure local database:**
   - Copy `.env.example` to `.env` and configure your MongoDB credentials
   - Or use SSH tunnel to access remote database:
     ```bash
     ssh -L 27017:remote_host:27017 user@server
     # Then set MONGODB_HOST=localhost in .env
     ```

5. **Run development server:**
   ```bash
   python web-ft.py
   ```

6. **Open browser:**
   Navigate to http://localhost:5000

---

## Development Workflow

### Branch Strategy

- `master` - Stable production code
- `develop` - Integration branch for features
- `feature/*` - New features (e.g., `feature/add-rbm-integration`)
- `bugfix/*` - Bug fixes (e.g., `bugfix/fix-grid-parsing`)
- `hotfix/*` - Urgent production fixes

### Workflow Steps

1. **Create feature branch:**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/my-new-feature
   ```

2. **Make changes:**
   - Write code following style guidelines (see below)
   - Add comments and docstrings
   - Test locally

3. **Commit changes:**
   ```bash
   git add .
   git commit -m "Add feature: brief description"
   ```

4. **Push to remote:**
   ```bash
   git push origin feature/my-new-feature
   ```

5. **Create Pull Request:**
   - Go to GitHub and create PR from your feature branch to `develop`
   - Fill out PR template with description of changes
   - Request review from maintainers

6. **Address review feedback:**
   - Make requested changes
   - Push updates to same branch
   - PR will update automatically

7. **Merge:**
   - Once approved, maintainer will merge to `develop`
   - `develop` is periodically merged to `master` for releases

---

## Code Style Guidelines

### Python (Backend)

**Follow PEP 8 with these specifics:**

#### Naming Conventions
```python
# Functions: lowercase with underscores
def fetch_wspr_spots(lastInterval=15):
    pass

# Variables: lowercase with underscores
spot_count = 0
rx_callsign = "KD3ALD"

# Constants: UPPERCASE with underscores
CONTEST_BANDS = ["160m", "80m", "40m", "20m", "15m", "10m"]

# Classes: PascalCase (if needed)
class SpotAggregator:
    pass
```

#### Docstrings
Use Google-style docstrings:

```python
def frequency_to_band(freq):
    """
    Convert frequency in MHz to amateur radio band designation.

    Maps frequencies to standard amateur radio band names based on
    FCC frequency allocations.

    Args:
        freq (float): Frequency in MHz (e.g., 14.097 for 20 meters)

    Returns:
        str: Band designation (e.g., "20m") or "Unknown" if not in amateur band

    Example:
        >>> frequency_to_band(14.097)
        '20m'
    """
    if 14.0 <= freq < 14.35:
        return "20m"
    return "Unknown"
```

#### Comments
```python
# Good: Explain WHY, not WHAT
# Convert threshold to database format (stores as separate date/time strings)
threshold_date = f"{threshold.year % 100:02d}{threshold.month:02d}{threshold.day:02d}"

# Bad: States the obvious
# Set threshold_date variable
threshold_date = f"{threshold.year % 100:02d}{threshold.month:02d}{threshold.day:02d}"
```

#### Imports
```python
# Standard library imports first
from datetime import datetime, timedelta
import json

# Third-party imports second
from flask import Flask, jsonify
from pymongo import MongoClient

# Local imports last
from utils import helper_function
```

---

### JavaScript (Frontend)

**Follow Airbnb JavaScript Style Guide with modifications:**

#### Naming Conventions
```javascript
// Functions: camelCase
function loadSpots() {
    // ...
}

// Variables: camelCase
let spotCount = 0;
const rxCallsign = "KD3ALD";

// Constants: SCREAMING_SNAKE_CASE
const CONTEST_BANDS = ["160m", "80m", "40m", "20m", "15m", "10m"];

// Private functions: _prefixed (convention)
function _parseInternalFormat(data) {
    // ...
}
```

#### JSDoc Comments
```javascript
/**
 * Lookup country name from geographic coordinates.
 *
 * Uses Turf.js point-in-polygon test against country boundary polygons
 * to determine which country contains the given coordinates.
 *
 * @param {number} lat - Latitude in decimal degrees
 * @param {number} lon - Longitude in decimal degrees
 * @returns {string} Country name or "Unknown" if not found
 *
 * @example
 * lookupCountry(40.7128, -74.0060) // "United States of America"
 */
function lookupCountry(lat, lon) {
    const pt = turf.point([lon, lat]);
    for (const feature of countryFeat) {
        if (turf.booleanPointInPolygon(pt, feature)) {
            return feature.properties.name || "Unknown";
        }
    }
    return "Unknown";
}
```

#### Async/Await (Preferred over Promises)
```javascript
// Good: async/await
async function loadSpots() {
    try {
        const res = await fetch('/spots?lastInterval=15');
        const spots = await res.json();
        renderSpots(spots);
    } catch (err) {
        console.error('Failed to load spots:', err);
    }
}

// Avoid: Promise chains
function loadSpots() {
    fetch('/spots?lastInterval=15')
        .then(res => res.json())
        .then(spots => renderSpots(spots))
        .catch(err => console.error(err));
}
```

#### Error Handling
```javascript
// Always use try-catch for async operations
async function loadCountryPolygons() {
    try {
        const res = await fetch("js/countries.geojson");
        const data = await res.json();
        countryFeat = data.features;
        console.log("Loaded", countryFeat.length, "country polygons");
    } catch (err) {
        console.error("Failed to load countries.geojson", err);
        // Optionally: show user-friendly error message
        alert("Failed to load country data. Map filtering may not work.");
    }
}
```

---

### HTML/CSS

#### HTML Style
```html
<!-- Use semantic HTML5 -->
<section id="spot-info" class="info-panel">
    <h3>Spot Information</h3>
    <p>Found 45 spots from Europe</p>
</section>

<!-- Use descriptive IDs and classes -->
<button id="updateButton" class="btn btn-primary">Update</button>

<!-- Keep inline styles to minimum -->
<!-- Prefer CSS classes over inline style="" -->
```

#### CSS Style
```css
/* Use courier monospace font (project standard) */
body {
    font-family: 'Courier New', Courier, monospace;
}

/* Group related rules */
.spot-counter {
    position: absolute;
    bottom: 10px;
    right: 10px;
    background: white;
    padding: 10px;
    border-radius: 5px;
}

/* Use comments to explain non-obvious styling */
/* Green highlight for active bands (threshold met) */
td.value {
    background-color: green;
    color: white;
}
```

---

## Testing Guidelines

### Manual Testing Checklist

Before submitting PR, test the following:

#### Backend Tests
- [ ] Server starts without errors (`python web-ft.py`)
- [ ] `/spots` endpoint returns JSON
- [ ] `/tbspots` endpoint returns JSON with CQ zones
- [ ] Time filtering works (`lastInterval` parameter)
- [ ] Invalid grid squares handled gracefully

#### Frontend Tests
- [ ] Map loads and displays tiles
- [ ] Spots appear on map with correct colors
- [ ] Band filter works (all bands, individual, contest mode)
- [ ] Country filter works (including "Non-US")
- [ ] Continent filter works
- [ ] CQ zone filter works
- [ ] Mode filter works (WSPR/FT8/FT4)
- [ ] Marker popups show correct information
- [ ] Spot counter updates correctly
- [ ] Session storage persists filters
- [ ] Auto-reload works
- [ ] Table view displays correct counts
- [ ] Table highlights active bands

#### Cross-Browser Testing
Test in at least 2 browsers:
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari (if on Mac)
- [ ] Edge

#### Mobile Testing (if applicable)
- [ ] Map is responsive on mobile
- [ ] Filters are usable on small screens

### Automated Testing (Future)

We plan to add:
- Python unit tests (pytest)
- JavaScript unit tests (Jest)
- Integration tests (Selenium)
- API endpoint tests

If you'd like to help set up testing infrastructure, please reach out!

---

## Documentation Standards

### Code Documentation Requirements

**Every new function must have:**
1. Docstring/JSDoc explaining purpose
2. Parameter descriptions with types
3. Return value description
4. Example usage (if not obvious)

**Complex algorithms must have:**
1. Inline comments explaining logic
2. References to sources (if using published algorithms)

**New features must include:**
1. Update to README.md (technical documentation)
2. Update to OPERATOR_GUIDE.md (if user-facing)
3. Screenshots (if UI changes)

**When using AI assistance (Claude, etc.):**
1. Review [docs/CLAUDE.md](docs/CLAUDE.md) for project context and guidelines
2. Update docs/CLAUDE.md session history if making significant contributions
3. Follow the offline-first constraints (no CDN dependencies)
4. Reference requirement IDs when implementing features

### Writing Style

**For technical documentation:**
- Be concise but complete
- Use active voice ("The function returns..." not "The value is returned...")
- Include code examples
- Link to relevant external resources

**For operator documentation:**
- Use plain language
- Define amateur radio terms
- Include visual examples (screenshots, tables)
- Provide troubleshooting steps

---

## Submitting Changes

### Pull Request Template

When creating a PR, include:

```markdown
## Description
Brief description of changes (1-2 sentences)

## Type of Change
- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update

## Changes Made
- List specific changes
- Use bullet points
- Be specific

## Testing Done
- [ ] Tested locally with development server
- [ ] Tested with production-like data
- [ ] Tested in multiple browsers
- [ ] Updated documentation

## Screenshots (if applicable)
[Attach screenshots showing UI changes]

## Related Issues
Closes #123
Related to #456
```

### Commit Message Format

Use conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(map): add ITU zone filtering support

Add dropdown filter for ITU zones (1-90) with client-side filtering.
Loads ituzones.geojson and uses Turf.js for point-in-polygon lookup.

Closes #42
```

```
fix(backend): handle invalid maidenhead grid squares

Wrap maidenhead.to_location() in try-catch to prevent server crashes
when database contains malformed grid squares. Defaults to (0, 0).

Fixes #67
```

```
docs: update operator guide with contest strategy tips

Add section on using dashboard during contests, including example
scenarios and band selection strategies.
```

---

## Reporting Issues

### Bug Reports

**Use this template:**

```markdown
## Bug Description
Clear description of the bug

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. See error

## Expected Behavior
What you expected to happen

## Actual Behavior
What actually happened

## Screenshots
If applicable, add screenshots

## Environment
- Browser: [e.g., Chrome 120]
- OS: [e.g., Windows 11]
- Dashboard URL: [e.g., http://dash.kd3ald.com]
- Time of occurrence: [e.g., 2026-01-07 14:30 UTC]

## Additional Context
Any other relevant information
```

### Feature Requests

**Use this template:**

```markdown
## Feature Description
Clear description of the feature

## Use Case
Explain why this feature would be useful:
- Who would use it?
- What problem does it solve?
- How does it improve contesting/DXing operations?

## Proposed Solution
Describe how you envision this working

## Alternatives Considered
Other approaches you've thought about

## Additional Context
Amateur radio context, contest examples, etc.
```

### Questions

For questions about using the dashboard, see [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) first.

For technical questions, feel free to open a discussion or contact the maintainers directly.

---

## Code Review Process

### What Reviewers Look For

1. **Functionality:** Does it work as intended?
2. **Code Quality:** Follows style guidelines?
3. **Documentation:** Well-commented and documented?
4. **Testing:** Adequately tested?
5. **Performance:** No obvious performance issues?
6. **Security:** No security vulnerabilities introduced?

### Review Timeline

- Small PRs (<100 lines): 1-2 days
- Medium PRs (100-500 lines): 3-5 days
- Large PRs (>500 lines): 1 week+

**Tip:** Smaller PRs get reviewed faster! Break large features into multiple PRs if possible.

---

## Project Priorities

### High Priority

1. **Stability:** Don't break existing functionality
2. **Performance:** Dashboard must be responsive with 1000+ spots
3. **Accuracy:** Propagation data must be accurate and timely
4. **Usability:** Operators should be able to use dashboard during contests

### Medium Priority

1. **New filters:** Additional filtering options
2. **Data sources:** Integration with other PSWS nodes
3. **Export features:** Save spot data for analysis
4. **Mobile optimization:** Better mobile UI

### Low Priority

1. **UI polish:** Visual improvements
2. **Advanced analytics:** Historical data analysis
3. **Notifications:** Band opening alerts

---

## Resources for Contributors

### Project Documentation

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) - Formal requirements specification
- [docs/CLAUDE.md](docs/CLAUDE.md) - AI assistance history and guidelines
- [README.md](README.md) - Complete technical documentation
- [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) - User guide for operators

### Amateur Radio Resources

- [ARRL Band Plans](http://www.arrl.org/band-plan) - Frequency allocations
- [HamSCI Project](https://hamsci.org/) - Parent project
- [WSPRNet](https://wsprnet.org/) - WSPR network
- [PSK Reporter](https://pskreporter.info/) - Digital mode propagation

### Technical Resources

- [Flask Documentation](https://flask.palletsprojects.com/)
- [Leaflet Documentation](https://leafletjs.com/reference.html)
- [Turf.js Documentation](https://turfjs.org/)
- [MongoDB Query Reference](https://docs.mongodb.com/manual/reference/operator/query/)

### Development Tools

- [Postman](https://www.postman.com/) - API testing
- [MongoDB Compass](https://www.mongodb.com/products/compass) - Database GUI
- [Visual Studio Code](https://code.visualstudio.com/) - Code editor
- [Chrome DevTools](https://developer.chrome.com/docs/devtools/) - Browser debugging

---

## Recognition

Contributors will be recognized in:
- Repository README.md
- Documentation acknowledgments
- Conference presentations (HamSCI Workshop, Dayton Hamvention)
- Academic publications resulting from this work

---

## License

By contributing to this project, you agree that your contributions will be licensed under the same license as the project (to be determined - likely MIT or GPL).

---

## Questions?

**Project Lead:**
Owen Ruzanski, KD3ALD
Email: owen.ruzanski@scranton.edu

**Faculty Advisor:**
Dr. Nathaniel Frissell, W2NAF
Email: nathaniel.frissell@scranton.edu

**Frankford Radio Club Mentors:**
Ray Sokola, K9RS
Bud Trench, AA3B

---

**Thank you for contributing to HamSCI and advancing amateur radio science!**

*73 de KD3ALD*
