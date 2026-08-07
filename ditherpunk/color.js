/* ============================================================
   DITHERPUNK — Colour utilities
   Shared by the page and the worker (importScripts).
   ============================================================ */

'use strict';

// ── sRGB → CIE LAB (D65) ────────────────────────────────────
function rgbToLab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750);
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual lightness L* only (0–100). */
function lightness(r, g, b) {
  let Y = r / 255, G = g / 255, B = b / 255;
  Y = Y > 0.04045 ? Math.pow((Y + 0.055) / 1.055, 2.4) : Y / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
  const y = Y * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  return 116 * (y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116) - 16;
}

/** Fast luma for effects that don't need perceptual accuracy. */
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ── Palette helpers ─────────────────────────────────────────

/** Sort dark → light by L*, so a saturated yellow ranks above a saturated blue. */
function sortByLightness(palette) {
  return palette
    .map(c => ({ c, l: lightness(c.r, c.g, c.b) }))
    .sort((a, b) => a.l - b.l)
    .map(x => x.c);
}

function paletteToLab(palette) {
  return palette.map(c => rgbToLab(c.r, c.g, c.b));
}

function nearestInLab(r, g, b, palette, lab) {
  const [L, A, B_] = rgbToLab(r, g, b);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < lab.length; i++) {
    const d = (L - lab[i][0]) ** 2 + (A - lab[i][1]) ** 2 + (B_ - lab[i][2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return palette[best];
}

function hexToRgb(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// ── HSV — for the colour picker's saturation/value field ────
function rgbToHsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R)      h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else                h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHex(c) {
  const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
}

// ── Median-cut quantization (D2 / D3) ───────────────────────
// Extracts up to `count` representative colours from RGBA pixel data.
function medianCut(data, count) {
  count = Math.max(2, Math.min(256, count | 0));

  // Sample rather than read every pixel — 20k is plenty to characterise
  // an image and keeps extraction well under a frame.
  const total = data.length / 4;
  const stride = Math.max(1, Math.floor(total / 20000));
  const pixels = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if (data[o + 3] < 8) continue;              // skip transparent
    pixels.push([data[o], data[o + 1], data[o + 2]]);
  }
  if (!pixels.length) return [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];

  let boxes = [pixels];
  while (boxes.length < count) {
    // Split the box with the largest spread on its longest axis.
    let target = -1, targetRange = -1, targetAxis = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) continue;
      for (let a = 0; a < 3; a++) {
        let lo = 255, hi = 0;
        for (const p of boxes[i]) { if (p[a] < lo) lo = p[a]; if (p[a] > hi) hi = p[a]; }
        const range = hi - lo;
        if (range > targetRange) { targetRange = range; target = i; targetAxis = a; }
      }
    }
    if (target < 0 || targetRange <= 0) break;

    const box = boxes[target];
    box.sort((p, q) => p[targetAxis] - q[targetAxis]);
    const mid = box.length >> 1;
    boxes.splice(target, 1, box.slice(0, mid), box.slice(mid));
  }

  return boxes.filter(b => b.length).map(box => {
    let r = 0, g = 0, b = 0;
    for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    return {
      r: Math.round(r / box.length),
      g: Math.round(g / box.length),
      b: Math.round(b / box.length),
    };
  });
}

if (typeof self !== 'undefined') {
  Object.assign(self, {
    rgbToLab, lightness, luma, sortByLightness, paletteToLab,
    nearestInLab, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, medianCut,
  });
}
