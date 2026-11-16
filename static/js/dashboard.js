/**
 * HamSCI PSWS Contesting Dashboard - combined view tab switching (dashboard.js)
 *
 * Toggles between the Map, Table, Bands, States and Waterfall iframes embedded
 * in both.html.  (The CW skimmer is not a tab yet: it is at /cws.)
 * Each iframe independently loads its own page; this shell only manages
 * visibility and the address bar.
 *
 * Frames with a data-src (the Waterfall) load on first use, and every frame
 * is told which tab is active via postMessage, so the Waterfall can stop
 * polling (and release its radiod spectrum channels) while it is hidden.
 *
 * The address bar describes exactly what is on screen (#62): view=<tab> plus
 * every setting the frames report (see viewstate.js), so the URL can be
 * bookmarked or shared.  The server forwards this page's query string into
 * each frame's src, so opening such a link restores the tab and settings.
 */

document.addEventListener("DOMContentLoaded", () => {
  const tabButtons = document.querySelectorAll(".dash-tab-btn");
  const frames = document.querySelectorAll(".dash-frame");

  function setUrlParams(update) {
    const p = new URLSearchParams(window.location.search);
    update(p);
    const qs = p.toString();
    return window.location.pathname + (qs ? `?${qs}` : "");
  }

  // Show one tab.  push=true adds a history entry, so Back/Forward move
  // between tabs; Map (the default) is left out of the URL.
  function activate(view, push) {
    const btn = [...tabButtons].find(b => b.dataset.view === view) || tabButtons[0];
    const targetId = btn.dataset.target;
    tabButtons.forEach(b => b.classList.toggle("active", b === btn));
    frames.forEach(f => {
      const active = f.id === targetId;
      f.classList.toggle("active", active);
      // A lazy frame gets today's settings, not the ones the page opened with.
      if (active && f.dataset.src && !f.getAttribute("src")) f.src = f.dataset.src.split("?")[0] + window.location.search;
      try {
        f.contentWindow?.postMessage({ type: "frc-tab", active: targetId }, window.location.origin);
      } catch (e) { /* frame not loaded yet */ }
    });
    const url = setUrlParams(p => {
      if (btn.dataset.view === "map") p.delete("view"); else p.set("view", btn.dataset.view);
    });
    if (push) window.history.pushState({ view: btn.dataset.view }, "", url);
    else window.history.replaceState({ view: btn.dataset.view }, "", url);
  }

  tabButtons.forEach(btn => btn.addEventListener("click", () => {
    if (!btn.classList.contains("active")) activate(btn.dataset.view, true);
  }));
  window.addEventListener("popstate", () => {
    activate(new URLSearchParams(window.location.search).get("view") || "map", false);
  });

  // A frame asks to show another tab (e.g. the Bands view's "Open in Map").
  window.addEventListener("message", ev => {
    if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== "frc-open") return;
    activate(ev.data.view, true);
  });

  // A frame reports its settings: merge them into the address bar.
  window.addEventListener("message", ev => {
    if (ev.origin !== window.location.origin || !ev.data || ev.data.type !== "frc-state") return;
    const { keys = [], legacy = [], params = {} } = ev.data;
    window.history.replaceState(window.history.state, "", setUrlParams(p => {
      [...keys, ...legacy].forEach(k => p.delete(k));
      Object.entries(params).forEach(([k, v]) => p.set(k, v));
    }));
  });

  // Band label style (#66): Frequency, Wavelength or both, shared by every
  // tab through localStorage (each frame relabels on the storage event) and
  // kept in the URL as labels= when not the default.
  const labels = document.getElementById("bandLabels");
  if (labels) {
    const fromUrl = new URLSearchParams(window.location.search).get("labels");
    if (["freq", "wl", "both"].includes(fromUrl)) {
      try { localStorage.setItem("bandLabels", fromUrl); } catch (e) { /* storage unavailable */ }
    }
    labels.value = CONFIG.bandLabelStyle();
    labels.addEventListener("change", () => {
      try { localStorage.setItem("bandLabels", labels.value); } catch (e) { /* storage unavailable */ }
      window.history.replaceState(window.history.state, "", setUrlParams(p => {
        if (labels.value === CONFIG.defaults.bandLabels) p.delete("labels"); else p.set("labels", labels.value);
      }));
    });
  }

  // Copy link: navigator.clipboard needs HTTPS, and the dashboard is plain
  // HTTP on the station LAN, so fall back to a temporary text field.
  const copyBtn = document.getElementById("copyLink");
  copyBtn?.addEventListener("click", async () => {
    const url = window.location.href;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch (e) { /* fall through */ }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove();
    }
    if (!ok) window.prompt("Copy this link:", url);
    copyBtn.textContent = ok ? "Copied ✓" : "Copy link";
    setTimeout(() => { copyBtn.textContent = "Copy link"; }, 1500);
  });

  activate(new URLSearchParams(window.location.search).get("view") || "map", false);
});
