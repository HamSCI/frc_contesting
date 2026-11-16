// spot_symbols.js — canvas-drawn spot symbols (#68, #67).
// Must be loaded after leaflet.js (the Leaflet part is skipped without it).
//
// Thousands of DOM marker pins made the map trail zoom/pan; these symbols are
// drawn by Leaflet's canvas renderer instead.  Colour = band (CONFIG.bands),
// shape = mode (CONFIG.modes).  drawSpotShape() and spotShapeSvg() are also
// used for legends and for the per-band canvas maps.

/** Trace one symbol path centred on (x, y) with "radius" r. Caller fills/strokes. */
function drawSpotShape(ctx, shape, x, y, r) {
  switch (shape) {
    case "square": {
      const h = r * 0.85;
      ctx.rect(x - h, y - h, 2 * h, 2 * h);
      break;
    }
    case "triangle": {
      const h = r * 1.15;
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h * 0.95, y + h * 0.6);
      ctx.lineTo(x - h * 0.95, y + h * 0.6);
      ctx.closePath();
      break;
    }
    case "diamond": {
      const h = r * 1.15;
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h, y);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x - h, y);
      ctx.closePath();
      break;
    }
    case "pentagon": {
      const h = r * 1.15;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        if (i) ctx.lineTo(x + h * Math.cos(a), y + h * Math.sin(a));
        else ctx.moveTo(x + h * Math.cos(a), y + h * Math.sin(a));
      }
      ctx.closePath();
      break;
    }
    case "star": {
      const outer = r * 1.3, inner = outer * 0.45;
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? inner : outer;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const px = x + rad * Math.cos(a), py = y + rad * Math.sin(a);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2, false);
  }
}

/** The same symbol as a small inline SVG, for legends and filter pills. */
function spotShapeSvg(shape, color, size = 12, stroke = "#222") {
  const c = size / 2, r = size * 0.36;
  let d;
  switch (shape) {
    case "square": {
      const h = r * 0.85;
      d = `<rect x="${c - h}" y="${c - h}" width="${2 * h}" height="${2 * h}"/>`;
      break;
    }
    case "triangle": {
      const h = r * 1.15;
      d = `<polygon points="${c},${c - h} ${c + h * 0.95},${c + h * 0.6} ${c - h * 0.95},${c + h * 0.6}"/>`;
      break;
    }
    case "diamond": {
      const h = r * 1.15;
      d = `<polygon points="${c},${c - h} ${c + h},${c} ${c},${c + h} ${c - h},${c}"/>`;
      break;
    }
    case "pentagon": {
      const h = r * 1.15, pts = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        pts.push(`${(c + h * Math.cos(a)).toFixed(2)},${(c + h * Math.sin(a)).toFixed(2)}`);
      }
      d = `<polygon points="${pts.join(" ")}"/>`;
      break;
    }
    case "star": {
      const outer = r * 1.3, inner = outer * 0.45, pts = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 ? inner : outer, a = -Math.PI / 2 + i * Math.PI / 5;
        pts.push(`${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`);
      }
      d = `<polygon points="${pts.join(" ")}"/>`;
      break;
    }
    default:
      d = `<circle cx="${c}" cy="${c}" r="${r}"/>`;
  }
  return `<svg class="spot-shape" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
         `<g fill="${color}" stroke="${stroke}" stroke-width="1">${d}</g></svg>`;
}

// Leaflet: a CircleMarker (same hit-testing, events and styling) whose path is
// one of the shapes above.  Canvas renderer only; SVG falls back to a circle.
const SpotMarker = typeof L === "undefined" ? null : (() => {
  L.Canvas.include({
    _updateSpotShape(layer) {
      if (!this._drawing || layer._empty()) return;
      const p = layer._point, ctx = this._ctx;
      const r = Math.max(Math.round(layer._radius), 1);
      ctx.beginPath();
      drawSpotShape(ctx, layer.options.shape, p.x, p.y, r);
      this._fillStroke(ctx, layer);
    },
  });
  L.SVG.include({
    _updateSpotShape(layer) { this._updateCircle(layer); },
  });
  return L.CircleMarker.extend({
    options: { shape: "circle" },
    _updatePath() { this._renderer._updateSpotShape(this); },
  });
})();
