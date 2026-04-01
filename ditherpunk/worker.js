/* ============================================================
   DITHERPUNK — Image Processing Worker
   Runs the full pipeline off the main thread
   ============================================================ */

'use strict';

// ── Bayer matrices ──────────────────────────────────────────
const BAYER2 = [
  [ 0,  2],
  [ 3,  1]
];

const BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5]
];

const BAYER8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21]
];

// Void-and-cluster 16×16 blue-noise matrix (precomputed)
const VOID_CLUSTER_16 = [
  [  0,128, 32,160,  8,136, 40,168,  2,130, 34,162, 10,138, 42,170],
  [ 64,192, 96,224, 72,200,104,232, 66,194, 98,226, 74,202,106,234],
  [ 16,144, 48,176, 24,152, 56,184, 18,146, 50,178, 26,154, 58,186],
  [ 80,208,112,240, 88,216,120,248, 82,210,114,242, 90,218,122,250],
  [  4,132, 36,164, 12,140, 44,172,  6,134, 38,166, 14,142, 46,174],
  [ 68,196,100,228, 76,204,108,236, 70,198,102,230, 78,206,110,238],
  [ 20,148, 52,180, 28,156, 60,188, 22,150, 54,182, 30,158, 62,190],
  [ 84,212,116,244, 92,220,124,252, 86,214,118,246, 94,222,126,254],
  [  1,129, 33,161,  9,137, 41,169,  3,131, 35,163, 11,139, 43,171],
  [ 65,193, 97,225, 73,201,105,233, 67,195, 99,227, 75,203,107,235],
  [ 17,145, 49,177, 25,153, 57,185, 19,147, 51,179, 27,155, 59,187],
  [ 81,209,113,241, 89,217,121,249, 83,211,115,243, 91,219,123,251],
  [  5,133, 37,165, 13,141, 45,173,  7,135, 39,167, 15,143, 47,175],
  [ 69,197,101,229, 77,205,109,237, 71,199,103,231, 79,207,111,239],
  [ 21,149, 53,181, 29,157, 61,189, 23,151, 55,183, 31,159, 63,191],
  [ 85,213,117,245, 93,221,125,253, 87,215,119,247, 95,223,127,255]
];

// ── Full-color 6×5×6 palette ────────────────────────────────
function buildFullColorPalette() {
  const R = 6, G = 5, B = 6;
  const palette = [];
  for (let r = 0; r < R; r++) {
    for (let g = 0; g < G; g++) {
      for (let b = 0; b < B; b++) {
        palette.push({
          r: Math.round(r * 255 / (R - 1)),
          g: Math.round(g * 255 / (G - 1)),
          b: Math.round(b * 255 / (B - 1))
        });
      }
    }
  }
  return palette;
}

const FULL_COLOR_PALETTE = buildFullColorPalette();

// ── RGB ↔ LAB conversion ────────────────────────────────────
function rgbToLab(r, g, b) {
  // sRGB → linear
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
  // linear → XYZ D65
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000;
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Precompute LAB for full-color palette
const FULL_COLOR_LAB = FULL_COLOR_PALETTE.map(c => rgbToLab(c.r, c.g, c.b));

function nearestFullColor(r, g, b) {
  const [L, A, B_] = rgbToLab(r, g, b);
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < FULL_COLOR_LAB.length; i++) {
    const [lL, lA, lB] = FULL_COLOR_LAB[i];
    const d = (L - lL) ** 2 + (A - lA) ** 2 + (B_ - lB) ** 2;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return FULL_COLOR_PALETTE[best];
}

// ── Film palette nearest color (LAB) ───────────────────────
// Cache LAB values per palette to avoid recomputing every pixel
const filmLabCache = new WeakMap();

function getFilmLab(palette) {
  if (filmLabCache.has(palette)) return filmLabCache.get(palette);
  const lab = palette.map(c => rgbToLab(c.r, c.g, c.b));
  filmLabCache.set(palette, lab);
  return lab;
}

function nearestFilmColor(r, g, b, palette) {
  const lab = getFilmLab(palette);
  const [L, A, B_] = rgbToLab(r, g, b);
  let best = palette[0], bestDist = Infinity;
  for (let i = 0; i < lab.length; i++) {
    const [lL, lA, lB] = lab[i];
    const d = (L - lL) ** 2 + (A - lA) ** 2 + (B_ - lB) ** 2;
    if (d < bestDist) { bestDist = d; best = palette[i]; }
  }
  return best;
}

// ── Bias (power curve) ──────────────────────────────────────
function applyBias(val, exponent) {
  return 255 * Math.pow(val / 255, exponent);
}

// ── Step 1: Area-average downscale (integer block size) ─────
// blockSize is always an integer so every dithered pixel maps to
// exactly blockSize×blockSize output pixels — no uneven squares.
function downscale(src, srcW, srcH, scale) {
  // Derive an integer block size from the scale factor.
  // scale=1 → blockSize=1 (no downscale), scale=0.25 → blockSize=4, etc.
  const blockSize = Math.max(1, Math.round(1 / scale));
  const dstW = Math.ceil(srcW / blockSize);
  const dstH = Math.ceil(srcH / blockSize);
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      // Source region for this block (clamped to image bounds)
      const x0 = dx * blockSize;
      const y0 = dy * blockSize;
      const x1 = Math.min(x0 + blockSize, srcW);
      const y1 = Math.min(y0 + blockSize, srcH);

      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4;
          rSum += src[i];
          gSum += src[i + 1];
          bSum += src[i + 2];
          aSum += src[i + 3];
          count++;
        }
      }

      const di = (dy * dstW + dx) * 4;
      dst[di]     = rSum / count;
      dst[di + 1] = gSum / count;
      dst[di + 2] = bSum / count;
      dst[di + 3] = aSum / count;
    }
  }
  return { data: dst, width: dstW, height: dstH, blockSize };
}

// ── Step 5: Nearest-neighbor upscale (integer block size) ───
// Each dithered pixel becomes exactly blockSize×blockSize output pixels.
function upscale(src, srcW, srcH, dstW, dstH, blockSize) {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let sy = 0; sy < srcH; sy++) {
    for (let sx = 0; sx < srcW; sx++) {
      const si = (sy * srcW + sx) * 4;
      const r = src[si], g = src[si + 1], b = src[si + 2], a = src[si + 3];

      const dyStart = sy * blockSize;
      const dxStart = sx * blockSize;
      const dyEnd = Math.min(dyStart + blockSize, dstH);
      const dxEnd = Math.min(dxStart + blockSize, dstW);

      for (let dy = dyStart; dy < dyEnd; dy++) {
        for (let dx = dxStart; dx < dxEnd; dx++) {
          const di = (dy * dstW + dx) * 4;
          dst[di]     = r;
          dst[di + 1] = g;
          dst[di + 2] = b;
          dst[di + 3] = a;
        }
      }
    }
  }
  return dst;
}

// ── Step 2: Apply bias ──────────────────────────────────────
function applyBiasToImage(data, exponent) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i]     = applyBias(data[i],     exponent);
    out[i + 1] = applyBias(data[i + 1], exponent);
    out[i + 2] = applyBias(data[i + 2], exponent);
    out[i + 3] = data[i + 3];
  }
  return out;
}

// ── Quantize a single pixel ─────────────────────────────────
function quantizePixel(r, g, b, mode, filmPalette, filmDark, filmBright) {
  if (mode === 'fullcolor') {
    return nearestFullColor(r, g, b);
  } else if (mode === 'mono') {
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = gray < 128 ? 0 : 255;
    return { r: v, g: v, b: v };
  } else if (mode === 'filmcolor') {
    // Full palette nearest-color match using weighted RGB distance
    return nearestFilmColor(r, g, b, filmPalette);
  } else { // film (1-bit)
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    return gray < 128 ? filmDark : filmBright;
  }
}

// ── Error diffusion kernels ─────────────────────────────────
const KERNELS = {
  'floyd-steinberg': {
    divisor: 16,
    offsets: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]]
  },
  'stucki': {
    divisor: 42,
    offsets: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]
    ]
  },
  'atkinson': {
    divisor: 8,
    offsets: [
      [1, 0, 1], [2, 0, 1],
      [-1, 1, 1], [0, 1, 1], [1, 1, 1],
      [0, 2, 1]
    ]
  },
  'jjn': {
    divisor: 48,
    offsets: [
      [1, 0, 7], [2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]
    ]
  },
  'burkes': {
    divisor: 32,
    offsets: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]
    ]
  },
  'sierra': {
    divisor: 32,
    offsets: [
      [1, 0, 5], [2, 0, 3],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
      [-1, 2, 2], [0, 2, 3], [1, 2, 2]
    ]
  },
  'sierra2': {
    divisor: 16,
    offsets: [
      [1, 0, 4], [2, 0, 3],
      [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1]
    ]
  },
  'sierra-lite': {
    divisor: 4,
    offsets: [
      [1, 0, 2],
      [-1, 1, 1], [0, 1, 1]
    ]
  }
};

// ── Color distance (normalized 0–1, max possible = sqrt(3)) ─
const MAX_COLOR_DIST = Math.sqrt(3);
function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt(
    0.3  * ((r1 - r2) / 255) ** 2 +
    0.59 * ((g1 - g2) / 255) ** 2 +
    0.11 * ((b1 - b2) / 255) ** 2
  );
}

// ── Error diffusion dithering ───────────────────────────────
function errorDiffusionDither(data, w, h, kernel, mode, filmPalette, filmDark, filmBright, ditherThreshold) {
  const buf = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];

  const out = new Uint8ClampedArray(data.length);
  const { divisor, offsets } = kernel;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const oldR = Math.max(0, Math.min(255, buf[idx]));
      const oldG = Math.max(0, Math.min(255, buf[idx + 1]));
      const oldB = Math.max(0, Math.min(255, buf[idx + 2]));

      const q = quantizePixel(oldR, oldG, oldB, mode, filmPalette, filmDark, filmBright);

      out[idx]     = q.r;
      out[idx + 1] = q.g;
      out[idx + 2] = q.b;
      out[idx + 3] = data[idx + 3];

      // Only propagate error if pixel is far enough from its nearest color
      const dist = colorDist(oldR, oldG, oldB, q.r, q.g, q.b);
      if (dist <= ditherThreshold) continue; // snap flat, no diffusion

      const eR = oldR - q.r;
      const eG = oldG - q.g;
      const eB = oldB - q.b;

      for (const [dx, dy, weight] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = (ny * w + nx) * 4;
        buf[ni]     += eR * weight / divisor;
        buf[ni + 1] += eG * weight / divisor;
        buf[ni + 2] += eB * weight / divisor;
      }
    }
  }
  return out;
}

// ── Color quantization (article formula) ───────────────────
// floor(c * (n-1) + 0.5) / (n-1) — finds nearest step in an n-level palette
function quantizeChannel(c, n) {
  return Math.floor(c * (n - 1) + 0.5) / (n - 1);
}

// Quantize a perturbed pixel using the article's additive threshold method.
// For palette modes we still snap to nearest palette color, but for
// fullcolor/mono we use the proper quantization formula for clean gradients.
function orderedQuantize(r, g, b, threshold, spread, mode, filmPalette, filmDark, filmBright) {
  // Normalize to 0-1, add threshold offset (centered around 0), clamp
  const tr = Math.max(0, Math.min(1, r / 255 + (threshold - 0.5) * spread));
  const tg = Math.max(0, Math.min(1, g / 255 + (threshold - 0.5) * spread));
  const tb = Math.max(0, Math.min(1, b / 255 + (threshold - 0.5) * spread));

  if (mode === 'fullcolor') {
    // 6-level quantization per channel (matches FULL_COLOR_PALETTE R=6,G=5,B=6)
    const qr = Math.round(quantizeChannel(tr, 6) * 255);
    const qg = Math.round(quantizeChannel(tg, 5) * 255);
    const qb = Math.round(quantizeChannel(tb, 6) * 255);
    return nearestFullColor(qr, qg, qb);
  } else if (mode === 'mono') {
    // 2-level: black or white
    const lum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
    const v = quantizeChannel(lum, 2) > 0.5 ? 255 : 0;
    return { r: v, g: v, b: v };
  } else if (mode === 'filmcolor') {
    return nearestFilmColor(Math.round(tr * 255), Math.round(tg * 255), Math.round(tb * 255), filmPalette);
  } else { // film 1-bit
    const lum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
    return lum >= 0.5 ? filmBright : filmDark;
  }
}

// ── Ordered dithering ───────────────────────────────────────
function orderedDither(data, w, h, matrix, matSize, mode, filmPalette, filmDark, filmBright, biasExponent, ditherThreshold) {
  const out = new Uint8ClampedArray(data.length);
  const matMax = matSize * matSize;

  // spread controls how strongly the threshold perturbs the color.
  // The article uses a fixed additive offset; we expose it via ditherThreshold
  // mapped to a useful range (0 = no dither, 1 = full spread of ~1 palette step).
  // A spread of 1/colorLevels is the "correct" amount per the article.
  const spread = ditherThreshold * 2.0; // 0..2 gives nice range

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      // Normalized threshold from Bayer matrix (0..1)
      const threshold = (matrix[y % matSize][x % matSize] + 0.5) / matMax;

      const q = orderedQuantize(r, g, b, threshold, spread, mode, filmPalette, filmDark, filmBright);

      out[idx]     = q.r;
      out[idx + 1] = q.g;
      out[idx + 2] = q.b;
      out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

// ── Halftone dithering ──────────────────────────────────────
function halftoneDither(data, w, h, mode, filmPalette, filmDark, filmBright, ditherThreshold, cellSize) {
  const out = new Uint8ClampedArray(data.length);
  const halfCell = cellSize / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      // Threshold check on original pixel
      const nearest = quantizePixel(r, g, b, mode, filmPalette, filmDark, filmBright);
      const dist = colorDist(r, g, b, nearest.r, nearest.g, nearest.b);

      let q;
      if (dist <= ditherThreshold) {
        q = nearest;
      } else {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const cx = (Math.floor(x / cellSize) + 0.5) * cellSize;
        const cy = (Math.floor(y / cellSize) + 0.5) * cellSize;
        const distDot = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const maxRadius = halfCell * Math.SQRT2;
        const radius = (1 - gray / 255) * maxRadius;
        const isInk = distDot <= radius;

        if (mode === 'fullcolor') {
          q = isInk ? nearestFullColor(r, g, b) : { r: 255, g: 255, b: 255 };
        } else if (mode === 'mono') {
          const v = isInk ? 0 : 255;
          q = { r: v, g: v, b: v };
        } else if (mode === 'filmcolor') {
          q = isInk ? nearestFilmColor(r, g, b, filmPalette) : (filmPalette.length ? filmPalette[filmPalette.length - 1] : { r: 255, g: 255, b: 255 });
        } else {
          q = isInk ? filmDark : filmBright;
        }
      }

      out[idx]     = q.r;
      out[idx + 1] = q.g;
      out[idx + 2] = q.b;
      out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

// ── Get film dark/bright ────────────────────────────────────
function getFilmExtremes(palette) {
  if (!palette || palette.length === 0) return [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
  let darkest = palette[0], brightestC = palette[0];
  let minLum = Infinity, maxLum = -Infinity;
  for (const c of palette) {
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if (lum < minLum) { minLum = lum; darkest = c; }
    if (lum > maxLum) { maxLum = lum; brightestC = c; }
  }
  return [darkest, brightestC];
}

// ── Main pipeline ───────────────────────────────────────────
self.onmessage = function(e) {
  const { imageData, width, height, settings, filmPalette } = e.data;
  const { pixelation, bias, colorMode, ditherType, ditherThreshold, halftoneCellSize } = settings;

  // Bias exponent
  const biasExponent = Math.log(bias) / Math.log(0.5);

  // Film extremes
  const [filmDark, filmBright] = getFilmExtremes(filmPalette);

  // Step 1: Downscale
  const { data: smallData, width: smallW, height: smallH, blockSize } = downscale(imageData, width, height, pixelation);

  // Step 2: Bias
  const biasedData = applyBiasToImage(smallData, biasExponent);

  // Steps 3+4: Palette mapping + dithering
  let ditheredData;

  const isErrorDiffusion = KERNELS[ditherType] !== undefined;

  if (isErrorDiffusion) {
    ditheredData = errorDiffusionDither(
      biasedData, smallW, smallH,
      KERNELS[ditherType],
      colorMode, filmPalette, filmDark, filmBright,
      ditherThreshold
    );
  } else {
    // Ordered dithering
    let matrix, matSize;
    switch (ditherType) {
      case 'bayer2':        matrix = BAYER2;        matSize = 2;  break;
      case 'bayer4':        matrix = BAYER4;        matSize = 4;  break;
      case 'bayer8':        matrix = BAYER8;        matSize = 8;  break;
      case 'void-cluster':  matrix = VOID_CLUSTER_16; matSize = 16; break;
      case 'halftone':
        ditheredData = halftoneDither(biasedData, smallW, smallH, colorMode, filmPalette, filmDark, filmBright, ditherThreshold, halftoneCellSize || 8);
        break;
      default:              matrix = BAYER4;        matSize = 4;  break;
    }
    if (!ditheredData) {
      ditheredData = orderedDither(
        biasedData, smallW, smallH,
        matrix, matSize,
        colorMode, filmPalette, filmDark, filmBright,
        biasExponent, ditherThreshold
      );
    }
  }

  // Step 5: Upscale back to original dimensions
  const upscaled = upscale(ditheredData, smallW, smallH, width, height, blockSize);

  self.postMessage({ result: upscaled, width, height }, [upscaled.buffer]);
};
