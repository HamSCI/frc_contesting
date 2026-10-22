/**
 * HamSCI PSWS Contesting Dashboard - combined view tab switching (dashboard.js)
 *
 * Toggles between the Map, Table and Waterfall iframes embedded in both.html.
 * Each iframe independently loads its own page, so there is no shared
 * script state to manage here - just visibility.
 *
 * Frames with a data-src (the Waterfall) load on first use, and every frame
 * is told which tab is active via postMessage, so the Waterfall can stop
 * polling (and release its radiod spectrum channels) while it is hidden.
 */

document.addEventListener("DOMContentLoaded", () => {
  const tabButtons = document.querySelectorAll(".dash-tab-btn");
  const frames = document.querySelectorAll(".dash-frame");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      tabButtons.forEach(b => b.classList.toggle("active", b === btn));
      frames.forEach(f => {
        const active = f.id === targetId;
        f.classList.toggle("active", active);
        if (active && f.dataset.src && !f.getAttribute("src")) f.src = f.dataset.src;
        try {
          f.contentWindow?.postMessage({ type: "frc-tab", active: targetId }, window.location.origin);
        } catch (e) { /* frame not loaded yet */ }
      });
    });
  });
});
