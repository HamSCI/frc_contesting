"""
Ionosphere assimilation state management for the Assimilated-Predictions [BETA] page.

This module is the FRAMEWORK for a future data-assimilation feature. It does NOT
perform any real assimilation. It manages a working copy of the reference
ionosphere and decides, on each request, whether predictions on the assimilation
page should use the pristine "baseline" ionosphere or the (future) "assimilated"
copy, driving a color-coded indicator on the page.

Directories (all under the gitignored ionosphere/ tree):
    baseline    : itu_r_hf/ITURHFProp/Data/      (pristine reference, never modified here)
    assimilated : ionosphere/assimilated/        (working copy the future process will modify)
    state file  : ionosphere/assimilated_state.json  {"session_start", "last_activity"}

State machine (see get_status): a fresh session shows "baseline" for the first
ASSIMILATION_WARMUP_MINUTES, then flips to "assimilated". A session whose last
activity is older than ASSIMILATION_STALE_MINUTES is considered dead: the working
copy is reset to a fresh baseline copy and a new session begins. "Done Predicting"
(mark_done) refreshes the activity timestamp to keep the session alive.
"""

import filecmp
import json
import os
import shutil
from datetime import datetime, timedelta

# Files whose difference from baseline signals that assimilation has modified the
# working copy. Assimilation edits the monthly ionospheric maps, so we compare those.
_IONOS_FILES = [f'ionos{m:02d}.bin' for m in range(1, 13)]

# Full set of files required for the working copy to be a valid drop-in data dir
# (kept in sync with REQUIRED_DATA_FILES in routes/api.py).
_REQUIRED_FILES = (
    _IONOS_FILES
    + [f'COEFF{m:02d}W.txt' for m in range(1, 13)]
    + ['P1239-3 Decile Factors.txt']
)

_DEFAULT_WARMUP_MINUTES = 15.0
_DEFAULT_STALE_MINUTES = 30.0


def _warmup_minutes():
    """Minutes a fresh session stays 'baseline' before flipping to 'assimilated'."""
    try:
        return float(os.getenv('ASSIMILATION_WARMUP_MINUTES', _DEFAULT_WARMUP_MINUTES))
    except (ValueError, TypeError):
        return _DEFAULT_WARMUP_MINUTES


def _stale_minutes():
    """Minutes of inactivity after which a session is considered dead and reset."""
    try:
        return float(os.getenv('ASSIMILATION_STALE_MINUTES', _DEFAULT_STALE_MINUTES))
    except (ValueError, TypeError):
        return _DEFAULT_STALE_MINUTES


def _paths():
    """Return the baseline dir, assimilated working dir, and state file path."""
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    return {
        'baseline_dir':    os.path.join(project_root, 'itu_r_hf', 'ITURHFProp', 'Data'),
        'assimilated_dir': os.path.join(project_root, 'ionosphere', 'assimilated'),
        'state_file':      os.path.join(project_root, 'ionosphere', 'assimilated_state.json'),
    }


def _assimilated_complete(p):
    """True if the working copy contains every required data file."""
    d = p['assimilated_dir']
    return os.path.isdir(d) and all(
        os.path.isfile(os.path.join(d, f)) for f in _REQUIRED_FILES
    )


def _copy_baseline_to_assimilated(p):
    """(Re)create the working copy as a full copy of the pristine baseline."""
    os.makedirs(os.path.dirname(p['assimilated_dir']), exist_ok=True)
    shutil.copytree(p['baseline_dir'], p['assimilated_dir'], dirs_exist_ok=True)


def _ensure_assimilated_exists(p):
    """Make sure the working copy exists and is complete (copy baseline if not)."""
    if not _assimilated_complete(p):
        _copy_baseline_to_assimilated(p)


def _ionos_files_differ(p):
    """True if any ionosNN.bin in the working copy differs from baseline."""
    for name in _IONOS_FILES:
        base = os.path.join(p['baseline_dir'], name)
        assim = os.path.join(p['assimilated_dir'], name)
        if not os.path.isfile(assim):
            return True
        if not filecmp.cmp(base, assim, shallow=False):
            return True
    return False


def _load_state(p):
    """Load the session state file; return {} if missing or unreadable."""
    try:
        with open(p['state_file'], 'r') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_state(p, state):
    """Persist the session state file."""
    os.makedirs(os.path.dirname(p['state_file']), exist_ok=True)
    with open(p['state_file'], 'w') as f:
        json.dump(state, f, indent=2)


def _parse(ts):
    """Parse an ISO timestamp string; return None on failure."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except (ValueError, TypeError):
        return None


def _status_dict(mode, session_start, last_activity, warmup, stale, flip_at):
    """Build the JSON-serializable status payload returned to the frontend."""
    return {
        'mode':          mode,
        'label':         'Assimilated Ionosphere' if mode == 'assimilated' else 'Baseline Ionosphere',
        'color':         'green' if mode == 'assimilated' else 'red',
        'session_start': session_start.isoformat() if session_start else None,
        'last_activity': last_activity.isoformat() if last_activity else None,
        'warmup_minutes': warmup,
        'stale_minutes':  stale,
        'flip_at':       flip_at.isoformat() if flip_at else None,
    }


def get_status():
    """
    Resolve the current ionosphere mode, performing any needed side effects
    (create/reset the working copy, start a new session), and return the status
    payload for the indicator.
    """
    now = datetime.utcnow()
    p = _paths()
    _ensure_assimilated_exists(p)

    state = _load_state(p)
    differ = _ionos_files_differ(p)
    warmup = _warmup_minutes()
    stale = _stale_minutes()

    session_start = _parse(state.get('session_start'))
    last_activity = _parse(state.get('last_activity'))
    fresh = last_activity is not None and (now - last_activity) <= timedelta(minutes=stale)

    flip_at = None
    if fresh and session_start is not None:
        # Active session.
        if differ:
            mode = 'assimilated'                       # real modifications present
        elif (now - session_start) >= timedelta(minutes=warmup):
            mode = 'assimilated'                       # warmed up (framework: time-based)
        else:
            mode = 'baseline'
            flip_at = session_start + timedelta(minutes=warmup)
    else:
        # Stale or no session: discard any stale modified copy and start fresh.
        if differ:
            _copy_baseline_to_assimilated(p)
        session_start = now
        last_activity = now
        _save_state(p, {
            'session_start': now.isoformat(),
            'last_activity': now.isoformat(),
        })
        mode = 'baseline'
        flip_at = now + timedelta(minutes=warmup)

    return _status_dict(mode, session_start, last_activity, warmup, stale, flip_at)


def mark_done():
    """
    Record that the user finished a prediction/assimilation session ("Done
    Predicting"): refresh the activity timestamp so the session stays alive for
    another stale window. Returns the updated status.
    """
    now = datetime.utcnow()
    p = _paths()
    _ensure_assimilated_exists(p)
    state = _load_state(p)
    if not state.get('session_start'):
        state['session_start'] = now.isoformat()
    state['last_activity'] = now.isoformat()
    _save_state(p, state)
    return get_status()


def resolve_prediction_data_dir():
    """
    Return the data directory predictions on the assimilation page should use:
    the pristine baseline when the indicator is 'baseline', otherwise the
    assimilated working copy. This is how the page switches ionospheres.
    """
    status = get_status()
    p = _paths()
    return p['assimilated_dir'] if status['mode'] == 'assimilated' else p['baseline_dir']
