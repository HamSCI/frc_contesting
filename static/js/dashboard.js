/**
 * HamSCI PSWS Contesting Dashboard - combined view tab switching (dashboard.js)
 *
 * Toggles between the Map and Table iframes embedded in both.html.
 * Each iframe independently loads /map or /table, so there is no shared
 * script state to manage here - just visibility.
 */

document.addEventListener("DOMContentLoaded", () => {
  const tabButtons = document.querySelectorAll(".dash-tab-btn");
  const frames = document.querySelectorAll(".dash-frame");

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      tabButtons.forEach(b => b.classList.toggle("active", b === btn));
      frames.forEach(f => f.classList.toggle("active", f.id === targetId));
    });
  });
});
