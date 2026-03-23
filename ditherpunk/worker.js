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

// ── Film palette nearest color ──────────────────────────────
function nearestFilmColor(r, g, b, palette) {
  let best = palette[0], bestDist = Infinity;
  for (const c of palette) {
    const dR = r - c.r, dG = g - c.g, dB = b - c.b;
    const d = 0.3 * dR * dR + 0.59 * dG * dG + 0.11 * dB * dB;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// ── Bias (power curve) ──────────────────────────────────────
function applyBias(val, exponent) {
  return 255 * Math.pow(val / 255, exponent);
}

// ── Step 1: Area-average downscale ──────────────────────────
function downscale(src, srcW, srcH, scale) {
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = dx * scaleX, x1 = (dx + 1) * scaleX;
      const y0 = dy * scaleY, y1 = (dy + 1) * scaleY;

      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, weight = 0;

      const iy0 = Math.floor(y0), iy1 = Math.ceil(y1);
      const ix0 = Math.floor(x0), ix1 = Math.ceil(x1);

      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          const w = wx * wy;
          const idx = (Math.min(sy, srcH - 1) * srcW + Math.min(sx, srcW - 1)) * 4;
          rSum += src[idx]     * w;
          gSum += src[idx + 1] * w;
          bSum += src[idx + 2] * w;
          aSum += src[idx + 3] * w;
          weight += w;
        }
      }

      const di = (dy * dstW + dx) * 4;
      dst[di]     = rSum / weight;
      dst[di + 1] = gSum / weight;
      dst[di + 2] = bSum / weight;
      dst[di + 3] = aSum / weight;
    }
  }
  return { data: dst, width: dstW, height: dstH };
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

// ── Ordered dithering ───────────────────────────────────────
function orderedDither(data, w, h, matrix, matSize, mode, filmPalette, filmDark, filmBright, biasExponent, ditherThreshold) {
  const out = new Uint8ClampedArray(data.length);
  const matMax = matSize * matSize;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      // Check if pixel is already close enough to snap flat
      const nearest = quantizePixel(r, g, b, mode, filmPalette, filmDark, filmBright);
      const dist = colorDist(r, g, b, nearest.r, nearest.g, nearest.b);

      let q;
      if (dist <= ditherThreshold) {
        // Close enough — snap flat, no ordered perturbation
        q = nearest;
      } else {
        // Far from palette — apply ordered dithering
        const threshold = matrix[y % matSize][x % matSize] / matMax;
        const biasedThreshold = Math.pow(threshold, biasExponent);
        const perturbation = (biasedThreshold - 0.5) * 255;

        const pr = Math.max(0, Math.min(255, r + perturbation));
        const pg = Math.max(0, Math.min(255, g + perturbation));
        const pb = Math.max(0, Math.min(255, b + perturbation));
        q = quantizePixel(pr, pg, pb, mode, filmPalette, filmDark, filmBright);
      }

      out[idx]     = q.r;
      out[idx + 1] = q.g;
      out[idx + 2] = q.b;
      out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

// ── Halftone dithering ──────────────────────────────────────
function halftoneDither(data, w, h, mode, filmPalette, filmDark, filmBright, ditherThreshold) {
  const out = new Uint8ClampedArray(data.length);
  const cellSize = 4;
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

// ── Step 5: Nearest-neighbor upscale ───────────────────────
function upscale(src, srcW, srcH, dstW, dstH) {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(Math.floor(dx * scaleX), srcW - 1);
      const sy = Math.min(Math.floor(dy * scaleY), srcH - 1);
      const si = (sy * srcW + sx) * 4;
      const di = (dy * dstW + dx) * 4;
      dst[di]     = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return dst;
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
  const { pixelation, bias, colorMode, ditherType, ditherThreshold } = settings;

  // Bias exponent
  const biasExponent = Math.log(bias) / Math.log(0.5);

  // Film extremes
  const [filmDark, filmBright] = getFilmExtremes(filmPalette);

  // Step 1: Downscale
  const { data: smallData, width: smallW, height: smallH } = downscale(imageData, width, height, pixelation);

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
        ditheredData = halftoneDither(biasedData, smallW, smallH, colorMode, filmPalette, filmDark, filmBright, ditherThreshold);
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
  const upscaled = upscale(ditheredData, smallW, smallH, width, height);

  self.postMessage({ result: upscaled, width, height }, [upscaled.buffer]);
};
