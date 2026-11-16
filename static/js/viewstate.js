// viewstate.js — every setting in the URL, for sharing and bookmarking (#62).
// Load before the view's own script (map_ft.js, table_ft.js, waterfall.js).
//
// The dashboard shell (both.html) owns the address bar.  It forwards its
// query string into each tab's iframe, so a shared link like
//   /?view=table&last=60&thr=3
// opens the Table with those settings.  Each view then:
//   * reads a setting from its URL first, then this session, then the
//     default, so a shared link beats the recipient's own session;
//   * on every change, publishes its settings: its own URL is updated (so
//     the standalone /map, /table, /waterfall pages are linkable too) and the
//     shell merges them into the top-level URL.
// Params equal to their default are dropped to keep links short.  Settings
// the views keep in sync (last, reload, band) use the same name in each;
// per-view ones have their own (Map modes, Table tmodes/thr, States
// smodes/sthr, Bands bmodes), and plain modes/thr from a link apply to all.

const ViewState = {
  /** First present URL param among `names` (current name first, legacy after). */
  param(...names) {
    const p = new URLSearchParams(window.location.search);
    for (const n of names) if (p.has(n)) return p.get(n);
    return null;
  },

  session(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  },

  shared(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },

  /**
   * URL param, else sessionStorage[key], else the value the other views share
   * in localStorage[sharedKey] (lastInterval, reload, bandSel), else fallback.
   * Reading the shared value matters: a view opened later must not write its
   * defaults over what the other tabs (or browser tabs) are using.
   */
  get(names, key, fallback, sharedKey = null) {
    const fromUrl = this.param(...[].concat(names));
    if (fromUrl !== null) return fromUrl;
    const saved = key ? this.session(key) : null;
    if (saved !== null) return saved;
    const shared = sharedKey ? this.shared(sharedKey) : null;
    return shared !== null && shared !== "" ? shared : fallback;
  },

  /**
   * Publish a view's settings.
   * @param {string} view - "map" | "table" | "waterfall" | ...
   * @param {Object} state - name -> value; null/""/the default drops the param
   * @param {Object} defaults - name -> default value
   * @param {string[]} legacy - old param names to drop from the URL
   */
  publish(view, state, defaults = {}, legacy = []) {
    const own = new URLSearchParams(window.location.search);
    legacy.forEach(n => own.delete(n));
    const params = {};
    for (const [k, v] of Object.entries(state)) {
      const isDefault = v === null || v === undefined || v === "" ||
        (k in defaults && String(v) === String(defaults[k]));
      if (isDefault) own.delete(k);
      else { own.set(k, String(v)); params[k] = String(v); }
    }
    const qs = own.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (window.parent !== window) {
      try {
        window.parent.postMessage({ type: "frc-state", view, keys: Object.keys(state), legacy, params },
                                  window.location.origin);
      } catch (e) { /* not embedded in the dashboard */ }
    }
  },
};
