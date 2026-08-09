/* ============================================================
   DITHERPUNK — Image Processing Worker

   Pipeline, in order:
     1. downscale (pixelation) — SAMPLING picks how each output pixel
        chooses its colour, from a plain block mean up to a
        content-adaptive superpixel fit
     2. adjustments — brightness, contrast, blur, bias
     3. the effect stack, in user order; the DITHER node is one
        entry in that stack, so effects can run before or after
        quantization
     4. upscale back to source dimensions

   Everything after step 1 runs at the reduced resolution, which is
   both faster and correct for the aesthetic — effects should see
   the same chunky pixels the dither produces.
   ============================================================ */

'use strict';

importScripts('rng.js', 'color.js');

// ── Ordered matrices ────────────────────────────────────────
const BAYER2 = [[0, 2], [3, 1]];

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

const BLUENOISE_64 = (() => {
  const size = 64, n = size * size;
  function halton(i, b) {
    let f = 1, r = 0;
    for (; i > 0; i = Math.floor(i / b)) { f /= b; r += f * (i % b); }
    return r;
  }
  const flat = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(halton(i, 2) * size) + Math.floor(halton(i, 3) * size) * size;
    while (flat[idx] !== -1) idx = (idx + 1) % n;
    flat[idx] = i;
  }
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => flat[y * size + x]));
})();

// ── Full-color 6×5×6 palette ────────────────────────────────
const FULL_COLOR_PALETTE = (() => {
  const R = 6, G = 5, B = 6, p = [];
  for (let r = 0; r < R; r++)
    for (let g = 0; g < G; g++)
      for (let b = 0; b < B; b++)
        p.push({
          r: Math.round(r * 255 / (R - 1)),
          g: Math.round(g * 255 / (G - 1)),
          b: Math.round(b * 255 / (B - 1)),
        });
  return p;
})();
const FULL_COLOR_LAB = paletteToLab(FULL_COLOR_PALETTE);

function nearestFullColor(r, g, b) {
  return nearestInLab(r, g, b, FULL_COLOR_PALETTE, FULL_COLOR_LAB);
}

// ── Error diffusion kernels ─────────────────────────────────
// offsets: [dx, dy, weight]
const KERNELS = {
  'floyd-steinberg': { divisor: 16, offsets: [[1,0,7],[-1,1,3],[0,1,5],[1,1,1]] },
  'stucki': { divisor: 42, offsets: [
    [1,0,8],[2,0,4],
    [-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2],
    [-2,2,1],[-1,2,2],[0,2,4],[1,2,2],[2,2,1]] },
  'atkinson': { divisor: 8, offsets: [
    [1,0,1],[2,0,1],
    [-1,1,1],[0,1,1],[1,1,1],
    [0,2,1]] },
  'jjn': { divisor: 48, offsets: [
    [1,0,7],[2,0,5],
    [-2,1,3],[-1,1,5],[0,1,7],[1,1,5],[2,1,3],
    [-2,2,1],[-1,2,3],[0,2,5],[1,2,3],[2,2,1]] },
  'burkes': { divisor: 32, offsets: [
    [1,0,8],[2,0,4],
    [-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2]] },
  'sierra': { divisor: 32, offsets: [
    [1,0,5],[2,0,3],
    [-2,1,2],[-1,1,4],[0,1,5],[1,1,4],[2,1,2],
    [-1,2,2],[0,2,3],[1,2,2]] },
  'sierra2': { divisor: 16, offsets: [
    [1,0,4],[2,0,3],
    [-2,1,1],[-1,1,2],[0,1,3],[1,1,2],[2,1,1]] },
  'sierra-lite': { divisor: 4, offsets: [[1,0,2],[-1,1,1],[0,1,1]] },

  // ── Added in this pass ──
  'false-fs': { divisor: 8, offsets: [[1,0,3],[0,1,3],[1,1,2]] },
  'fan-93': { divisor: 16, offsets: [[1,0,7],[-2,1,1],[-1,1,3],[0,1,5]] },
  'shiau-fan': { divisor: 8, offsets: [[1,0,4],[-2,1,1],[-1,1,1],[0,1,2]] },
  'shiau-fan-2': { divisor: 16, offsets: [[1,0,8],[-3,1,1],[-2,1,1],[-1,1,2],[0,1,4]] },
  'stevenson-arce': { divisor: 200, offsets: [
    [2,0,32],
    [-3,1,12],[-1,1,26],[1,1,30],[3,1,16],
    [-2,2,12],[0,2,26],[2,2,12],
    [-3,3,5],[-1,3,12],[1,3,12],[3,3,5]] },
};

// ── Variable-coefficient diffusion ──────────────────────────
// Ostromoukhov's insight: fixed kernels produce structured "worming"
// because the same weights apply at every intensity. Varying the
// three coefficients with input level breaks it up.
//
// NOTE: this is an intensity-interpolated approximation of that
// scheme, not his published 256-entry table — hence "(approx)" in
// the menu. Behaviour matches in character: strongest right-weight
// at mid-tones, near-serial diffusion at the extremes.
const OSTRO_POINTS = [
  //  level, [right, down-left, down]
  [   0, [13,  0,  5]],
  [  16, [17,  1,  7]],
  [  32, [21,  2, 10]],
  [  48, [23,  4, 13]],
  [  64, [26,  6, 16]],
  [  80, [28,  8, 19]],
  [  96, [30, 10, 22]],
  [ 112, [32, 12, 24]],
  [ 128, [33, 13, 25]],
  [ 144, [32, 12, 24]],
  [ 160, [30, 10, 22]],
  [ 176, [28,  8, 19]],
  [ 192, [26,  6, 16]],
  [ 208, [23,  4, 13]],
  [ 224, [21,  2, 10]],
  [ 240, [17,  1,  7]],
  [ 255, [13,  0,  5]],
];

const OSTRO_TABLE = (() => {
  const t = new Float32Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    let i = 0;
    while (i < OSTRO_POINTS.length - 2 && OSTRO_POINTS[i + 1][0] < v) i++;
    const [l0, a] = OSTRO_POINTS[i];
    const [l1, b] = OSTRO_POINTS[i + 1];
    const f = l1 === l0 ? 0 : (v - l0) / (l1 - l0);
    const c0 = a[0] + (b[0] - a[0]) * f;
    const c1 = a[1] + (b[1] - a[1]) * f;
    const c2 = a[2] + (b[2] - a[2]) * f;
    const sum = c0 + c1 + c2 || 1;
    t[v * 3]     = c0 / sum;
    t[v * 3 + 1] = c1 / sum;
    t[v * 3 + 2] = c2 / sum;
  }
  return t;
})();

function variableOffsets(level, jitter) {
  const v = Math.max(0, Math.min(255, level | 0));
  let a = OSTRO_TABLE[v * 3], b = OSTRO_TABLE[v * 3 + 1], c = OSTRO_TABLE[v * 3 + 2];
  if (jitter) {
    // Zhou-Fang: perturb the coefficients per pixel to destroy any
    // residual periodic structure.
    a *= 1 + jitter; b *= 1 + jitter * 0.5; c *= 1 - jitter * 0.5;
    const s = a + b + c || 1;
    a /= s; b /= s; c /= s;
  }
  return [[1, 0, a], [-1, 1, b], [0, 1, c]];
}

// ── Adjustments ─────────────────────────────────────────────
function applyBrightnessContrast(data, brightness, contrast) {
  if (!brightness && !contrast) return data;

  // Contrast as a slope about mid-grey.
  //
  // The classic (259·(C+255)) / (255·(259−C)) formula is only defined for
  // C < 259. Scaling positive contrast to C = contrast·510 drove the
  // denominator through zero at contrast ≈ 0.51: the factor blew up and then
  // went NEGATIVE, inverting the image. That's why nudging the slider past
  // half did nothing, then everything at once.
  //
  // This slope is monotonic across the whole range: 0 (flat grey) at −1,
  // 1 at 0, and a steep-but-finite ~16.7 at +1.
  const slope = contrast >= 0
    ? 1 / Math.max(0.06, 1 - contrast)
    : 1 + contrast;
  const bAdd = brightness * 255;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = (i - 128) * slope + 128 + bAdd;
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  return data;
}

/** Separable box-blur triple pass — visually indistinguishable from
    gaussian, and linear in radius rather than quadratic. */
function gaussianBlur(data, w, h, radius) {
  if (radius <= 0) return data;
  const boxes = boxSizesForGauss(radius, 3);
  let src = data;
  let dst = new Uint8ClampedArray(data.length);
  for (let i = 0; i < 3; i++) {
    const r = (boxes[i] - 1) >> 1;
    boxBlurH(src, dst, w, h, r);
    boxBlurV(dst, src, w, h, r);
  }
  return src;
}

function boxSizesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxBlurH(src, dst, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let ch = 0; ch < 4; ch++) {
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x)) * 4 + ch];
      for (let x = 0; x < w; x++) {
        dst[row + x * 4 + ch] = sum / (r * 2 + 1);
        const add = src[row + Math.min(w - 1, x + r + 1) * 4 + ch];
        const sub = src[row + Math.max(0, x - r) * 4 + ch];
        sum += add - sub;
      }
    }
  }
}

function boxBlurV(src, dst, w, h, r) {
  if (r < 1) { dst.set(src); return; }
  for (let x = 0; x < w; x++) {
    for (let ch = 0; ch < 4; ch++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += src[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + ch];
      for (let y = 0; y < h; y++) {
        dst[(y * w + x) * 4 + ch] = sum / (r * 2 + 1);
        const add = src[(Math.min(h - 1, y + r + 1) * w + x) * 4 + ch];
        const sub = src[(Math.max(0, y - r) * w + x) * 4 + ch];
        sum += add - sub;
      }
    }
  }
}

function applyBias(data, exponent) {
  if (Math.abs(exponent - 1) < 1e-6) return data;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, exponent);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  return data;
}

// ── Scaling ─────────────────────────────────────────────────
/**
 * Every sampler answers the same question — which single colour stands in for
 * this block of source pixels — and they disagree in ways you can see.
 *
 * The block mean is unbiased and therefore blurry: at low pixelation a face
 * dissolves into blend pixels that belong to no feature, and the dither that
 * follows can only spread the error of an image whose shapes are already gone.
 * DETAIL and SUPERPIXEL both fight that from opposite ends — one reweights
 * inside a fixed block, the other lets the block itself move.
 */
function downscale(src, srcW, srcH, scale, s, palette) {
  const blockSize = Math.max(1, Math.round(1 / scale));
  const dstW = Math.ceil(srcW / blockSize);
  const dstH = Math.ceil(srcH / blockSize);
  const geom = { srcW, srcH, dstW, dstH, blockSize };

  let dst;
  switch (s && s.sampling) {
    case 'nearest':    dst = sampleNearest(src, geom); break;
    case 'detail':     dst = sampleDetail(src, geom, s.sampleDetail); break;
    case 'superpixel': dst = sampleSuperpixel(src, geom, s, samplingGuide(s, palette)); break;
    default:           dst = sampleBox(src, geom);
  }
  return { data: dst, width: dstW, height: dstH, blockSize };
}

/**
 * The palette the superpixel fit is allowed to steer by.
 *
 * Only a small palette carries information here. FULL COLOR's 180 entries sit
 * closer together than the differences the fit is trying to resolve, so
 * snapping to them says nothing — better to steer by the raw colour.
 */
function samplingGuide(s, palette) {
  if (palette && palette.length >= 2 && palette.length <= 64) return palette;
  if (s.colorMode === 'mono') return [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
  return null;
}

function sampleBox(src, geom) {
  const { srcW, srcH, dstW, dstH, blockSize } = geom;
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = dx * blockSize, y0 = dy * blockSize;
      const x1 = Math.min(x0 + blockSize, srcW), y1 = Math.min(y0 + blockSize, srcH);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      const di = (dy * dstW + dx) * 4;
      dst[di] = r / n; dst[di + 1] = g / n; dst[di + 2] = b / n; dst[di + 3] = a / n;
    }
  }
  return dst;
}

/** The block's centre pixel. Crisp, aliased, and the classic look. */
function sampleNearest(src, geom) {
  const { srcW, srcH, dstW, dstH, blockSize } = geom;
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  const half = blockSize >> 1;

  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(dy * blockSize + half, srcH - 1);
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(dx * blockSize + half, srcW - 1);
      const si = (sy * srcW + sx) * 4, di = (dy * dstW + dx) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

/**
 * Detail-preserving downscale (Weber et al. 2016, "Rapid, Detail-Preserving
 * Image Downscaling").
 *
 * Two passes over each block: the mean, then a weighted mean where every source
 * pixel's weight is its own distance from that mean, raised to λ. The inversion
 * is the whole point — pixels that disagree with their surroundings are exactly
 * the ones carrying the feature, so a lone specular highlight or a one-pixel
 * outline outvotes the flat area around it instead of being averaged into it.
 * λ = 0 collapses to a plain mean, which is why BOX is the honest zero here.
 */
function sampleDetail(src, geom, bias) {
  const lambda = Math.max(0, bias === undefined ? 0.5 : bias) * 1.5;
  if (lambda < 1e-6) return sampleBox(src, geom);

  const { srcW, srcH, dstW, dstH, blockSize } = geom;
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const x0 = dx * blockSize, y0 = dy * blockSize;
      const x1 = Math.min(x0 + blockSize, srcW), y1 = Math.min(y0 + blockSize, srcH);

      let mr = 0, mg = 0, mb = 0, ma = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4;
          mr += src[i]; mg += src[i + 1]; mb += src[i + 2]; ma += src[i + 3]; n++;
        }
      }
      mr /= n; mg /= n; mb /= n; ma /= n;

      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * srcW + sx) * 4;
          const dr = src[i] - mr, dg = src[i + 1] - mg, db = src[i + 2] - mb;
          // Luma-weighted distance: a green shift reads as more of a change than
          // the same numeric shift in blue, and the weighting should agree.
          const d = Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db) / 255;
          const wgt = Math.pow(d, lambda);
          r += src[i] * wgt; g += src[i + 1] * wgt;
          b += src[i + 2] * wgt; a += src[i + 3] * wgt;
          wsum += wgt;
        }
      }

      const di = (dy * dstW + dx) * 4;
      // A flat block has nothing to prefer — every weight is zero. Fall back to
      // the mean rather than dividing by it.
      if (wsum < 1e-6) {
        dst[di] = mr; dst[di + 1] = mg; dst[di + 2] = mb; dst[di + 3] = ma;
      } else {
        dst[di] = r / wsum; dst[di + 1] = g / wsum;
        dst[di + 2] = b / wsum; dst[di + 3] = a / wsum;
      }
    }
  }
  return dst;
}

/**
 * Grid-constrained SLIC — the superpixel half of Gerstner et al. 2012,
 * "Pixelated Image Abstraction" (NPAR; Computers & Graphics 2013).
 *
 * Instead of every output pixel owning a fixed square of the source, each one
 * owns a cell that is free to deform toward the colours it actually belongs to.
 * An eye, or the lit edge of a hood, ends up inside one cell rather than smeared
 * across four. What keeps this from becoming plain SLIC — which would return
 * blobs, not an image — is the grid constraint: a centre may never leave its
 * home cell by more than half a block, so the segmentation always stays a
 * dstW × dstH raster.
 *
 * The part that makes the paper's results look the way they do is the coupling:
 * a cell competes for pixels using **the palette colour it is going to end up
 * as**, not its own mean. That one substitution is what turns a smooth
 * segmentation into flat regions with hard borders, because it stops cells from
 * chasing differences the palette cannot express and makes them fight over the
 * differences it can. Without it you get a tidier blur; with it you get shapes.
 *
 * The paper solves for the palette at the same time, by mass-constrained
 * deterministic annealing. Here the palette is already chosen — it is whatever
 * the colour mode provides — so `guide` is that palette and only the
 * segmentation is solved. The output stays the cell's true mean, so the DITHER
 * node still owns the final colour assignment and can spread error as usual.
 */
function sampleSuperpixel(src, geom, s, guide) {
  const { srcW, srcH, dstW, dstH, blockSize } = geom;
  const n = srcW * srcH, cells = dstW * dstH;

  // Below 2×2 there is no cell to reshape, and the Lab buffer for a very large
  // source costs more memory than the result is worth.
  if (blockSize < 2) return sampleBox(src, geom);
  if (n > 6e6) return sampleDetail(src, geom, 0.6);

  // Lab for the whole source, once — this is the dominant cost, so it stays
  // outside the refinement loop.
  const lab = new Float32Array(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const o = i * 4;
    const c = rgbToLab(src[o], src[o + 1], src[o + 2]);
    lab[p] = c[0]; lab[p + 1] = c[1]; lab[p + 2] = c[2];
  }

  let iters = Math.max(1, Math.min(10, (s.sampleIters | 0) || 4));
  if (n > 4e6) iters = Math.min(iters, 3);

  // SLIC's compactness. Low lets colour dominate and cells chase features;
  // high makes the spatial term win and the result converges back on BOX.
  const rigidity = Math.max(0, Math.min(1, s.sampleShape === undefined ? 0.45 : s.sampleShape));
  const m = 10 + rigidity * 70;
  const spatialW = (m / blockSize) * (m / blockSize);
  const half = blockSize / 2;

  const cx = new Float32Array(cells), cy = new Float32Array(cells);
  // mL/mA/mB: the cell's true mean colour.  cL/cA/cB: the colour it competes
  // with — the same thing snapped to the guide palette, when there is one.
  const mL = new Float32Array(cells), mA = new Float32Array(cells), mB = new Float32Array(cells);
  const cL = new Float32Array(cells), cA = new Float32Array(cells), cB = new Float32Array(cells);
  const cr = new Float32Array(cells), cg = new Float32Array(cells);
  const cb = new Float32Array(cells), ca = new Float32Array(cells);

  const glab = guide ? paletteToLab(guide) : null;
  const snapGuides = () => {
    if (!glab) { cL.set(mL); cA.set(mA); cB.set(mB); return; }
    for (let k = 0; k < cells; k++) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < glab.length; i++) {
        const dl = mL[k] - glab[i][0], da = mA[k] - glab[i][1], db = mB[k] - glab[i][2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) { bestD = d; best = i; }
      }
      cL[k] = glab[best][0]; cA[k] = glab[best][1]; cB[k] = glab[best][2];
    }
  };

  // Seed every centre from its block: mean position, mean colour.
  const seed = sampleBox(src, geom);
  for (let k = 0; k < cells; k++) {
    const gx = k % dstW, gy = (k / dstW) | 0, o = k * 4;
    cx[k] = Math.min(gx * blockSize + half, srcW - 1);
    cy[k] = Math.min(gy * blockSize + half, srcH - 1);
    cr[k] = seed[o]; cg[k] = seed[o + 1]; cb[k] = seed[o + 2]; ca[k] = seed[o + 3];
    const c = rgbToLab(seed[o], seed[o + 1], seed[o + 2]);
    mL[k] = c[0]; mA[k] = c[1]; mB[k] = c[2];
  }
  snapGuides();

  const labels = new Int32Array(n);
  const dists = new Float32Array(n);
  const sumL = new Float64Array(cells), sumA = new Float64Array(cells), sumB = new Float64Array(cells);
  const sumR = new Float64Array(cells), sumG = new Float64Array(cells);
  const sumBl = new Float64Array(cells), sumAl = new Float64Array(cells);
  const sumX = new Float64Array(cells), sumY = new Float64Array(cells);
  const count = new Float64Array(cells);

  for (let it = 0; it < iters; it++) {
    dists.fill(Infinity);
    labels.fill(-1);

    // ── Assignment: each centre competes for the pixels within 2S of it,
    //    which is SLIC's locality trick — without it this is k-means over the
    //    whole image and costs O(cells × n).
    for (let k = 0; k < cells; k++) {
      const px = cx[k], py = cy[k];
      const x0 = Math.max(0, Math.floor(px - blockSize));
      const x1 = Math.min(srcW - 1, Math.ceil(px + blockSize));
      const y0 = Math.max(0, Math.floor(py - blockSize));
      const y1 = Math.min(srcH - 1, Math.ceil(py + blockSize));
      const kL = cL[k], kA = cA[k], kB = cB[k];

      for (let y = y0; y <= y1; y++) {
        const dy = y - py, rowSpatial = spatialW * dy * dy, row = y * srcW;
        for (let x = x0; x <= x1; x++) {
          const i = row + x, p = i * 3;
          const dl = lab[p] - kL, da = lab[p + 1] - kA, db = lab[p + 2] - kB;
          const dx = x - px;
          const d = dl * dl + da * da + db * db + rowSpatial + spatialW * dx * dx;
          if (d < dists[i]) { dists[i] = d; labels[i] = k; }
        }
      }
    }

    // ── Update
    sumL.fill(0); sumA.fill(0); sumB.fill(0);
    sumR.fill(0); sumG.fill(0); sumBl.fill(0); sumAl.fill(0);
    sumX.fill(0); sumY.fill(0); count.fill(0);

    for (let y = 0, i = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++, i++) {
        const k = labels[i];
        if (k < 0) continue;
        const p = i * 3, o = i * 4;
        sumL[k] += lab[p]; sumA[k] += lab[p + 1]; sumB[k] += lab[p + 2];
        sumR[k] += src[o]; sumG[k] += src[o + 1];
        sumBl[k] += src[o + 2]; sumAl[k] += src[o + 3];
        sumX[k] += x; sumY[k] += y;
        count[k]++;
      }
    }

    for (let k = 0; k < cells; k++) {
      const c = count[k];
      if (!c) continue;                       // handled below, once the means exist
      mL[k] = sumL[k] / c; mA[k] = sumA[k] / c; mB[k] = sumB[k] / c;
      cr[k] = sumR[k] / c; cg[k] = sumG[k] / c;
      cb[k] = sumBl[k] / c; ca[k] = sumAl[k] / c;

      // Grid constraint: a centre may drift, but never out of its own cell.
      const gx = k % dstW, gy = (k / dstW) | 0;
      const hx = gx * blockSize + half, hy = gy * blockSize + half;
      cx[k] = Math.max(hx - half, Math.min(hx + half, sumX[k] / c));
      cy[k] = Math.max(hy - half, Math.min(hy + half, sumY[k] / c));
    }

    // ── Starved cells. Once colour is allowed to outweigh position, a cell
    //    sitting on an edge loses every one of its pixels to the two cells on
    //    either side — and it still has to emit something. Leaving it on its
    //    seed hands that output pixel straight back to the box average, which
    //    is precisely the blend pixel this sampler exists to remove. So it
    //    adopts the colour of whichever superpixel actually covers its spot:
    //    the edge lands on one side or the other, cleanly.
    for (let k = 0; k < cells; k++) {
      if (count[k]) continue;
      const gx = k % dstW, gy = (k / dstW) | 0;
      const hx = Math.min(srcW - 1, Math.floor(gx * blockSize + half));
      const hy = Math.min(srcH - 1, Math.floor(gy * blockSize + half));
      const owner = labels[hy * srcW + hx];
      if (owner < 0 || !count[owner]) continue;
      mL[k] = mL[owner]; mA[k] = mA[owner]; mB[k] = mB[owner];
      cr[k] = cr[owner]; cg[k] = cg[owner]; cb[k] = cb[owner]; ca[k] = ca[owner];
      cx[k] = hx; cy[k] = hy;
    }

    // ── Laplacian smoothing of the centre colours across the output grid.
    //    Gerstner does this so neighbouring cells agree about what region they
    //    are part of; it damps the single-cell flicker you otherwise get where
    //    two features are equally close. It runs on the means, before the snap,
    //    so it settles which palette entry a cell commits to rather than
    //    blurring the colour we emit — the output is cr/cg/cb, untouched by it.
    if (it < iters - 1) smoothCentres(mL, mA, mB, dstW, dstH, 0.4);
    snapGuides();
  }

  const dst = new Uint8ClampedArray(cells * 4);
  for (let k = 0; k < cells; k++) {
    const o = k * 4;
    dst[o] = cr[k]; dst[o + 1] = cg[k]; dst[o + 2] = cb[k]; dst[o + 3] = ca[k];
  }
  return dst;
}

function smoothCentres(cL, cA, cB, w, h, alpha) {
  const oL = Float32Array.from(cL), oA = Float32Array.from(cA), oB = Float32Array.from(cB);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      let sL = 0, sA = 0, sB = 0, n = 0;
      if (x > 0)     { const j = k - 1; sL += oL[j]; sA += oA[j]; sB += oB[j]; n++; }
      if (x < w - 1) { const j = k + 1; sL += oL[j]; sA += oA[j]; sB += oB[j]; n++; }
      if (y > 0)     { const j = k - w; sL += oL[j]; sA += oA[j]; sB += oB[j]; n++; }
      if (y < h - 1) { const j = k + w; sL += oL[j]; sA += oA[j]; sB += oB[j]; n++; }
      if (!n) continue;
      cL[k] = oL[k] * (1 - alpha) + (sL / n) * alpha;
      cA[k] = oA[k] * (1 - alpha) + (sA / n) * alpha;
      cB[k] = oB[k] * (1 - alpha) + (sB / n) * alpha;
    }
  }
}

function upscale(src, srcW, srcH, dstW, dstH, blockSize) {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  for (let sy = 0; sy < srcH; sy++) {
    for (let sx = 0; sx < srcW; sx++) {
      const si = (sy * srcW + sx) * 4;
      const r = src[si], g = src[si + 1], b = src[si + 2], a = src[si + 3];
      const yEnd = Math.min(sy * blockSize + blockSize, dstH);
      const xEnd = Math.min(sx * blockSize + blockSize, dstW);
      for (let dy = sy * blockSize; dy < yEnd; dy++) {
        for (let dx = sx * blockSize; dx < xEnd; dx++) {
          const di = (dy * dstW + dx) * 4;
          dst[di] = r; dst[di + 1] = g; dst[di + 2] = b; dst[di + 3] = a;
        }
      }
    }
  }
  return dst;
}

// ── Quantization context ────────────────────────────────────
// Built once per render and handed to every dither routine.
function buildQuantizer(mode, palette, s, data) {
  const ctx = { mode };

  if (mode === 'fullcolor') {
    ctx.spacing = paletteSpacing(FULL_COLOR_PALETTE);
  } else if (mode === 'mono') {
    ctx.spacing = 1;
  } else if (mode === 'filmcolor' && palette.length) {
    ctx.palette = palette;
    ctx.lab = paletteToLab(palette);
    ctx.spacing = paletteSpacing(palette);
  } else if (mode === 'film' || (mode === 'filmcolor' && !palette.length)) {
    const [dark, bright] = extremes(palette);
    ctx.dark = dark; ctx.bright = bright;
    ctx.mode = 'film';
    ctx.spacing = 1;
  } else if (mode === 'ramp') {
    // Sorted dark → light by L* either way: bands need the ordering, and
    // it keeps the swatch strip and the processing order consistent.
    const sorted = sortByLightness(palette.length ? palette : [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }]);
    ctx.ramp = sorted;
    ctx.rampL = sorted.map(c => lightness(c.r, c.g, c.b));

    if (s.customMatch === 'bands') {
      ctx.rampMode = 'bands';
      ctx.edges = rampEdges(data, sorted.length, s.rampDistribution);
      ctx.spacing = 1;
    } else {
      // Nearest-colour in LAB — identical matching to Film Sim, so hue is
      // respected instead of everything collapsing onto a lightness ramp.
      ctx.rampMode = 'nearest';
      ctx.palette = sorted;
      ctx.lab = paletteToLab(sorted);
      ctx.spacing = paletteSpacing(sorted);
    }
  }
  return ctx;
}

/**
 * Mean distance from each palette entry to its nearest neighbour.
 *
 * DITHER STRENGTH snaps a pixel flat when it already sits close to a
 * palette colour. That cutoff has to be relative to how finely the
 * palette is spaced: an absolute 0.5 means "never diffuse" against the
 * 180-colour palette (every pixel is within 0.5 of something) while
 * meaning "diffuse almost always" against a 2-colour one. Scaling by
 * the palette's own spacing makes the slider behave the same way in
 * every colour mode.
 */
function paletteSpacing(palette) {
  const n = palette.length;
  if (n < 2) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = colorDist(palette[i].r, palette[i].g, palette[i].b,
                          palette[j].r, palette[j].g, palette[j].b);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / n;
}

function extremes(palette) {
  if (!palette || !palette.length) return [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
  let dark = palette[0], bright = palette[0], lo = Infinity, hi = -Infinity;
  for (const c of palette) {
    const l = luma(c.r, c.g, c.b);
    if (l < lo) { lo = l; dark = c; }
    if (l > hi) { hi = l; bright = c; }
  }
  return [dark, bright];
}

/**
 * Band edges in L* for the ramp mode.
 *  even      — split the image's lightness range into equal bands
 *  adaptive  — split by histogram so each colour covers a similar area
 */
function rampEdges(data, bands, distribution) {
  const hist = new Float64Array(101);
  let lo = 100, hi = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue;
    const L = Math.max(0, Math.min(100, lightness(data[i], data[i + 1], data[i + 2])));
    hist[Math.round(L)]++;
    if (L < lo) lo = L;
    if (L > hi) hi = L;
    count++;
  }
  if (!count || hi <= lo) { lo = 0; hi = 100; }

  const edges = new Float64Array(bands - 1);
  if (distribution === 'adaptive') {
    let cum = 0, next = 1, i = 0;
    for (; i <= 100 && next < bands; i++) {
      cum += hist[i];
      while (next < bands && cum >= (count * next) / bands) {
        edges[next - 1] = i;
        next++;
      }
    }
    for (; next < bands; next++) edges[next - 1] = 100;
  } else {
    for (let k = 1; k < bands; k++) edges[k - 1] = lo + (hi - lo) * (k / bands);
  }
  return edges;
}

function bandFor(L, edges) {
  let i = 0;
  while (i < edges.length && L >= edges[i]) i++;
  return i;
}

/** Quantize one pixel. Returns a colour object. */
function quantize(r, g, b, q) {
  switch (q.mode) {
    case 'fullcolor': return nearestFullColor(r, g, b);
    case 'mono': {
      const v = luma(r, g, b) < 128 ? 0 : 255;
      return { r: v, g: v, b: v };
    }
    case 'filmcolor': return nearestInLab(r, g, b, q.palette, q.lab);
    case 'ramp':      return q.rampMode === 'bands'
                        ? q.ramp[bandFor(lightness(r, g, b), q.edges)]
                        : nearestInLab(r, g, b, q.palette, q.lab);
    default:          return luma(r, g, b) < 128 ? q.dark : q.bright;
  }
}

const MAX_DIST = 1;
function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt(
    0.3  * ((r1 - r2) / 255) ** 2 +
    0.59 * ((g1 - g2) / 255) ** 2 +
    0.11 * ((b1 - b2) / 255) ** 2);
}

// ── Error diffusion ─────────────────────────────────────────
function errorDiffusionDither(data, w, h, type, q, threshold, serpentine, rng) {
  // Band mode quantizes along a single perceptual axis, so its error is
  // scalar. Diffusing RGB error against a lightness-ordered palette would
  // inject colour noise that belongs to no band. Nearest-colour matching
  // takes the normal RGB path below.
  if (q.mode === 'ramp' && q.rampMode === 'bands') {
    return errorDiffusionRamp(data, w, h, type, q, serpentine, rng);
  }

  const variable = type === 'ostromoukhov' || type === 'zhou-fang';
  const jitterAmt = type === 'zhou-fang' ? 0.35 : 0;
  const kernel = KERNELS[type];

  const buf = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) buf[i] = data[i];
  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < h; y++) {
    const rightward = !serpentine || (y % 2 === 0);
    const xStart = rightward ? 0 : w - 1;
    const xEnd   = rightward ? w : -1;
    const xStep  = rightward ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = (y * w + x) * 4;
      const oldR = Math.max(0, Math.min(255, buf[idx]));
      const oldG = Math.max(0, Math.min(255, buf[idx + 1]));
      const oldB = Math.max(0, Math.min(255, buf[idx + 2]));

      const c = quantize(oldR, oldG, oldB, q);
      out[idx] = c.r; out[idx + 1] = c.g; out[idx + 2] = c.b; out[idx + 3] = data[idx + 3];

      if (colorDist(oldR, oldG, oldB, c.r, c.g, c.b) <= threshold) continue;

      const eR = oldR - c.r, eG = oldG - c.g, eB = oldB - c.b;

      let offsets, divisor;
      if (variable) {
        const jitter = jitterAmt ? (rng() - 0.5) * 2 * jitterAmt : 0;
        offsets = variableOffsets(luma(oldR, oldG, oldB), jitter);
        divisor = 1;
      } else {
        offsets = kernel.offsets;
        divisor = kernel.divisor;
      }

      for (const [dx0, dy, weight] of offsets) {
        // Mirror the kernel when scanning right-to-left.
        const dx = rightward ? dx0 : -dx0;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = (ny * w + nx) * 4;
        const f = weight / divisor;
        buf[ni]     += eR * f;
        buf[ni + 1] += eG * f;
        buf[ni + 2] += eB * f;
      }
    }
  }
  return out;
}

/** Scalar-L* error diffusion for the ramp palette. */
function errorDiffusionRamp(data, w, h, type, q, serpentine, rng) {
  const variable = type === 'ostromoukhov' || type === 'zhou-fang';
  const jitterAmt = type === 'zhou-fang' ? 0.35 : 0;
  const kernel = KERNELS[type];

  const L = new Float32Array(w * h);
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    L[p] = lightness(data[i], data[i + 1], data[i + 2]);
  }
  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < h; y++) {
    const rightward = !serpentine || (y % 2 === 0);
    const xStart = rightward ? 0 : w - 1;
    const xEnd   = rightward ? w : -1;
    const xStep  = rightward ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const p = y * w + x, idx = p * 4;
      const oldL = Math.max(0, Math.min(100, L[p]));
      const band = bandFor(oldL, q.edges);
      const c = q.ramp[band];

      out[idx] = c.r; out[idx + 1] = c.g; out[idx + 2] = c.b; out[idx + 3] = data[idx + 3];

      const err = oldL - q.rampL[band];

      let offsets, divisor;
      if (variable) {
        const jitter = jitterAmt ? (rng() - 0.5) * 2 * jitterAmt : 0;
        offsets = variableOffsets(Math.round(oldL * 2.55), jitter);
        divisor = 1;
      } else {
        offsets = kernel.offsets;
        divisor = kernel.divisor;
      }

      for (const [dx0, dy, weight] of offsets) {
        const dx = rightward ? dx0 : -dx0;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        L[ny * w + nx] += err * (weight / divisor);
      }
    }
  }
  return out;
}

// ── Ordered dithering ───────────────────────────────────────
function quantizeChannel(c, n) {
  return Math.floor(c * (n - 1) + 0.5) / (n - 1);
}

function orderedQuantize(r, g, b, threshold, spread, q) {
  const tr = Math.max(0, Math.min(1, r / 255 + (threshold - 0.5) * spread));
  const tg = Math.max(0, Math.min(1, g / 255 + (threshold - 0.5) * spread));
  const tb = Math.max(0, Math.min(1, b / 255 + (threshold - 0.5) * spread));

  switch (q.mode) {
    case 'fullcolor':
      return nearestFullColor(
        Math.round(quantizeChannel(tr, 6) * 255),
        Math.round(quantizeChannel(tg, 5) * 255),
        Math.round(quantizeChannel(tb, 6) * 255));
    case 'mono': {
      const lum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
      const v = quantizeChannel(lum, 2) > 0.5 ? 255 : 0;
      return { r: v, g: v, b: v };
    }
    case 'filmcolor':
      return nearestInLab(tr * 255, tg * 255, tb * 255, q.palette, q.lab);
    case 'ramp': {
      if (q.rampMode === 'bands') {
        // Perturb along L* rather than per channel — same reason the
        // band error-diffusion path is scalar.
        const L = Math.max(0, Math.min(100,
          lightness(r, g, b) + (threshold - 0.5) * spread * 100));
        return q.ramp[bandFor(L, q.edges)];
      }
      return nearestInLab(tr * 255, tg * 255, tb * 255, q.palette, q.lab);
    }
    default: {
      const lum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
      return lum >= 0.5 ? q.bright : q.dark;
    }
  }
}

function orderedDither(data, w, h, matrix, matSize, q, threshold) {
  const out = new Uint8ClampedArray(data.length);
  const matMax = matSize * matSize;
  const spread = threshold * 2.0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const t = (matrix[y % matSize][x % matSize] + 0.5) / matMax;
      const c = orderedQuantize(data[idx], data[idx + 1], data[idx + 2], t, spread, q);
      out[idx] = c.r; out[idx + 1] = c.g; out[idx + 2] = c.b; out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

// ── Modulation dithering (B6) ───────────────────────────────
// The threshold is driven by a travelling waveform instead of a fixed
// matrix, which is what produces the classic screen-print "modulation
// line" look.
function waveform(kind, phase) {
  const t = phase - Math.floor(phase);            // 0..1
  switch (kind) {
    case 'triangle': return t < 0.5 ? t * 2 : 2 - t * 2;
    case 'square':   return t < 0.5 ? 0 : 1;
    case 'saw':      return t;
    case 'sine':
    default:         return 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
  }
}

function modulationDither(data, w, h, type, q, threshold, s) {
  const out = new Uint8ClampedArray(data.length);
  const spread = threshold * 2.0;
  const rad = (s.modAngle || 0) * Math.PI / 180;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  const freq = s.modFrequency || 8;
  const amp = s.modAmplitude === undefined ? 0.5 : s.modAmplitude;
  const cx = w / 2, cy = h / 2;
  const scale = Math.max(w, h) || 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      let phase;
      if (type === 'mod-rings') {
        phase = Math.hypot(x - cx, y - cy) / scale * freq;
      } else if (type === 'mod-lines') {
        phase = ((x * ca + y * sa) / scale) * freq;
      } else {
        // mod-wave — the wave itself is bent by image luminance, so the
        // pattern follows the subject rather than sitting on top of it.
        const lum = luma(r, g, b) / 255;
        phase = ((x * ca + y * sa) / scale) * freq + lum * 2;
      }

      const wv = waveform(s.modWave || 'sine', phase);
      // Blend between a neutral 0.5 threshold and the waveform.
      const t = 0.5 + (wv - 0.5) * amp;

      const c = orderedQuantize(r, g, b, t, spread, q);
      out[idx] = c.r; out[idx + 1] = c.g; out[idx + 2] = c.b; out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

// ── Halftone ────────────────────────────────────────────────
function halftoneDither(data, w, h, q, threshold, cellSize) {
  const out = new Uint8ClampedArray(data.length);
  const half = cellSize / 2;
  const paper = q.mode === 'ramp' ? q.ramp[q.ramp.length - 1]
              : q.mode === 'film' ? q.bright
              : { r: 255, g: 255, b: 255 };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const near = quantize(r, g, b, q);

      let c;
      if (colorDist(r, g, b, near.r, near.g, near.b) <= threshold) {
        c = near;
      } else {
        const gray = luma(r, g, b);
        const cx = (Math.floor(x / cellSize) + 0.5) * cellSize;
        const cy = (Math.floor(y / cellSize) + 0.5) * cellSize;
        const radius = (1 - gray / 255) * half * Math.SQRT2;
        const isInk = Math.hypot(x - cx, y - cy) <= radius;
        c = isInk ? near : paper;
      }
      out[idx] = c.r; out[idx + 1] = c.g; out[idx + 2] = c.b; out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

// ── The dither stage ────────────────────────────────────────
function runDither(data, w, h, s, q, rng) {
  const type = s.ditherType;
  const threshold = s.ditherThreshold;

  // Scale the snap-flat cutoff by the palette's own colour spacing.
  const snap = threshold * (q.spacing !== undefined ? q.spacing : 1);

  if (KERNELS[type] || type === 'ostromoukhov' || type === 'zhou-fang') {
    return errorDiffusionDither(data, w, h, type, q, snap, !!s.serpentine, rng);
  }
  if (type === 'mod-wave' || type === 'mod-lines' || type === 'mod-rings') {
    return modulationDither(data, w, h, type, q, threshold, s);
  }
  if (type === 'halftone') {
    return halftoneDither(data, w, h, q, snap, s.halftoneCellSize || 8);
  }
  switch (type) {
    case 'bayer2':       return orderedDither(data, w, h, BAYER2, 2, q, threshold);
    case 'bayer8':       return orderedDither(data, w, h, BAYER8, 8, q, threshold);
    case 'void-cluster': return orderedDither(data, w, h, VOID_CLUSTER_16, 16, q, threshold);
    case 'bluenoise':    return orderedDither(data, w, h, BLUENOISE_64, 64, q, threshold);
    case 'bayer4':
    default:             return orderedDither(data, w, h, BAYER4, 4, q, threshold);
  }
}

/* ============================================================
   EFFECTS (E2–E7)
   Each takes and returns a Uint8ClampedArray of RGBA.
   ============================================================ */

function fxChromatic(data, w, h, p) {
  const out = new Uint8ClampedArray(data.length);
  const rad = (p.angle || 0) * Math.PI / 180;
  const dx = Math.cos(rad) * p.amount;
  const dy = Math.sin(rad) * p.amount;
  const sample = (x, y, ch) => {
    const sx = Math.max(0, Math.min(w - 1, Math.round(x)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(y)));
    return data[(sy * w + sx) * 4 + ch];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i]     = sample(x + dx, y + dy, 0);   // red leads
      out[i + 1] = data[i + 1];                 // green stays put
      out[i + 2] = sample(x - dx, y - dy, 2);   // blue trails
      out[i + 3] = data[i + 3];
    }
  }
  return out;
}

function fxGlow(data, w, h, p) {
  // Isolate the highlights, blur them, screen them back over the image.
  const bright = new Uint8ClampedArray(data.length);
  const cut = p.threshold * 255;
  for (let i = 0; i < data.length; i += 4) {
    const l = luma(data[i], data[i + 1], data[i + 2]);
    const on = l >= cut;
    bright[i]     = on ? data[i] : 0;
    bright[i + 1] = on ? data[i + 1] : 0;
    bright[i + 2] = on ? data[i + 2] : 0;
    bright[i + 3] = 255;
  }
  const blurred = gaussianBlur(bright, w, h, p.radius);
  const out = new Uint8ClampedArray(data.length);
  const k = p.strength;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const a = data[i + c] / 255, b = (blurred[i + c] / 255) * k;
      out[i + c] = 255 * (1 - (1 - a) * (1 - Math.min(1, b)));   // screen blend
    }
    out[i + 3] = data[i + 3];
  }
  return out;
}

/**
 * CRT scanlines. A real CRT paints one horizontal sweep at a time, so the
 * dark lines run HORIZONTALLY — across the screen, stacked vertically.
 *
 * The phosphor mask is a different thing entirely: aperture-grille /
 * shadow-mask R/G/B stripes are the physical colour grid of the tube, and
 * they run PERPENDICULAR to the scan lines — the beam sweeps across them.
 * It's a separate, off-by-default control so that "scanlines" means scanlines.
 *
 * Runs after upscaling. Both features lock to blockSize — the on-screen size
 * of one pixelated pixel — so the whole CRT grid rides the pixel grid:
 *   · the scan lines repeat every blockSize ACROSS the lines, so there is one
 *     line per pixel row and the dark gaps land on pixel boundaries;
 *   · the phosphor triad repeats every blockSize ALONG the lines, so each
 *     pixel is one R/G/B cell — the width mirror of the scan line, exact
 *     because the pixels are square.
 * That's why there is no spacing control: the pixel size IS the spacing.
 * THICKNESS still chooses how many of the blockSize rows the line darkens.
 */
function fxScanlines(data, w, h, p, blockSize) {
  const out = new Uint8ClampedArray(data);
  const vertical = p.orientation === 'vertical';
  const period = Math.max(2, blockSize | 0);
  const thickness = Math.max(1, Math.min(period - 1, p.thickness | 0));
  const strength = p.strength;
  const mask = p.mask || 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // `across` steps perpendicular to the lines, `along` runs with them.
      const across = vertical ? x : y;
      const along  = vertical ? y : x;

      const dark = (across % period) < thickness ? (1 - strength) : 1;

      let mr = 1, mg = 1, mb = 1;
      if (mask > 0) {
        // One R/G/B triad per pixel: split each pixel cell (blockSize wide,
        // measured along the lines) into three sub-stripes so the mask locks
        // to the pixel grid instead of drifting at a fixed 3-px pitch. A cell
        // narrower than 3 px can't show all three phosphors — the same tiny-
        // pixel corner where the scan-line period bottoms out.
        const phase = Math.floor((along % period) * 3 / period);
        mr = phase === 0 ? 1 : 1 - mask;
        mg = phase === 1 ? 1 : 1 - mask;
        mb = phase === 2 ? 1 : 1 - mask;
      }

      const i = (y * w + x) * 4;
      out[i]     = data[i]     * dark * mr;
      out[i + 1] = data[i + 1] * dark * mg;
      out[i + 2] = data[i + 2] * dark * mb;
    }
  }
  return out;
}

function fxNoise(data, w, h, p, rng, q) {
  const out = new Uint8ClampedArray(data);
  const palette = p.paletteSafe === false ? null : activePaletteList(q);

  // Palette-safe grain: nudge each pixel a step or two along the palette.
  // Because the palette is ordered by lightness, that reads as tonal grain
  // rather than the colour speckle you'd get from offsetting raw channels.
  if (palette && palette.length > 1) {
    const indexOf = paletteIndexer(palette);
    const span = p.amount * 4;              // ±4 palette steps at full amount
    const last = palette.length - 1;
    for (let i = 0; i < data.length; i += 4) {
      const offset = Math.round((rng() - 0.5) * 2 * span);
      if (offset === 0) continue;
      const idx = indexOf(data[i], data[i + 1], data[i + 2]);
      // Clamp rather than wrap: grain should not flip black to white.
      const c = palette[Math.max(0, Math.min(last, idx + offset))];
      out[i] = c.r; out[i + 1] = c.g; out[i + 2] = c.b;
    }
    return out;
  }

  const amt = p.amount * 255;
  for (let i = 0; i < data.length; i += 4) {
    if (p.mono) {
      const n = (rng() - 0.5) * 2 * amt;
      out[i] = data[i] + n; out[i + 1] = data[i + 1] + n; out[i + 2] = data[i + 2] + n;
    } else {
      out[i]     = data[i]     + (rng() - 0.5) * 2 * amt;
      out[i + 1] = data[i + 1] + (rng() - 0.5) * 2 * amt;
      out[i + 2] = data[i + 2] + (rng() - 0.5) * 2 * amt;
    }
  }
  return out;
}

function fxPixelSort(data, w, h, p) {
  const out = new Uint8ClampedArray(data);

  // Band, not cutoff — and tolerate the two ends being dragged past each other.
  let lo = p.lower === undefined ? 0.25 : p.lower;
  let hi = p.upper === undefined ? 0.9 : p.upper;
  if (lo > hi) { const t = lo; lo = hi; hi = t; }
  const loCut = lo * 255, hiCut = hi * 255;
  const maxRun = Math.max(0, p.maxRun | 0);      // 0 = unlimited

  const major = p.vertical ? h : w;      // length of the line being sorted
  const minor = p.vertical ? w : h;      // number of lines

  for (let m = 0; m < minor; m++) {
    let run = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const pixels = run.map(i => [data[i], data[i + 1], data[i + 2], data[i + 3]]);
      pixels.sort((a, b) => luma(a[0], a[1], a[2]) - luma(b[0], b[1], b[2]));
      if (p.reverse) pixels.reverse();
      run.forEach((idx, k) => {
        out[idx] = pixels[k][0]; out[idx + 1] = pixels[k][1];
        out[idx + 2] = pixels[k][2]; out[idx + 3] = pixels[k][3];
      });
      run = [];
    };

    for (let j = 0; j < major; j++) {
      const x = p.vertical ? m : j;
      const y = p.vertical ? j : m;
      const i = (y * w + x) * 4;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      if (l >= loCut && l <= hiCut) {
        run.push(i);
        // Break long streaks into segments so one run can't consume a
        // whole row and turn a small slider nudge into a total redraw.
        if (maxRun && run.length >= maxRun) flush();
      } else {
        flush();
      }
    }
    flush();
  }
  return out;
}

/**
 * The colours a given quantizer can legally emit, ordered dark → light.
 * Used by palette-safe effects so glitching can't invent colours that
 * aren't in the palette.
 */
function activePaletteList(q) {
  if (!q) return null;
  switch (q.mode) {
    case 'fullcolor': return FULL_COLOR_SORTED;
    case 'mono':      return [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }];
    case 'film':      return sortByLightness([q.dark, q.bright]);
    case 'filmcolor': return q.palette || null;
    case 'ramp':      return q.ramp || q.palette || null;
    default:          return null;
  }
}
const FULL_COLOR_SORTED = sortByLightness(FULL_COLOR_PALETTE);

/** Index of the closest palette entry, in LAB. */
function nearestIndex(r, g, b, palette, lab) {
  const [L, A, B_] = rgbToLab(r, g, b);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < lab.length; i++) {
    const d = (L - lab[i][0]) ** 2 + (A - lab[i][1]) ** 2 + (B_ - lab[i][2]) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Memoised RGB → palette index lookup.
 *
 * Post-dither input only contains palette colours, so the cache holds a
 * handful of entries and the LAB search runs a few times instead of once
 * per pixel. Matters most for JPEG, whose decoded output is continuous-tone
 * against a possibly 180-entry palette.
 */
function paletteIndexer(palette) {
  const lab = paletteToLab(palette);
  const cache = new Map();
  return function indexOf(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    let v = cache.get(key);
    if (v === undefined) {
      v = nearestIndex(r, g, b, palette, lab);
      cache.set(key, v);
    }
    return v;
  };
}

/** Force every pixel onto the palette, preserving alpha. */
function snapToPalette(data, palette) {
  const indexOf = paletteIndexer(palette);
  for (let i = 0; i < data.length; i += 4) {
    const c = palette[indexOf(data[i], data[i + 1], data[i + 2])];
    data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b;
  }
  return data;
}

/* ── PIXEL ART ───────────────────────────────────────────────
   The passes a pixel artist runs by hand once the image is on the grid,
   drawn from saint11, Derek Yu and Pixel Parmesan.

   All five work at the pixelated resolution, so this node can sit either
   side of DITHER: before, it hands the dither clean shapes to spread error
   across; after, it tidies the quantized result.

   Every pass that "repaints" copies the colour of an existing neighbour
   rather than inventing one. That keeps the whole node palette-safe by
   construction — the same trick the NOISE and DATABEND nodes use — and it
   means running before DITHER doesn't quietly quantize the image and steal
   the dither's job.

   Region identity is a local LAB distance rather than a global labelling:
   at this resolution a flood fill would chain straight across a gradient
   and swallow the image, and every rule here only ever needs to know
   whether two touching pixels read as the same colour.
   ─────────────────────────────────────────────────────────── */

// ΔE at which two neighbouring pixels stop reading as the same colour.
const PA_EDGE_TOL2 = 10 * 10;

function paBuildLab(data, n) {
  const lab = new Float32Array(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const o = i * 4;
    const c = rgbToLab(data[o], data[o + 1], data[o + 2]);
    lab[p] = c[0]; lab[p + 1] = c[1]; lab[p + 2] = c[2];
  }
  return lab;
}

function paDist2(lab, i, j) {
  const a = i * 3, b = j * 3;
  const dl = lab[a] - lab[b], da = lab[a + 1] - lab[b + 1], db = lab[a + 2] - lab[b + 2];
  return dl * dl + da * da + db * db;
}

function paCopy(dst, di, src, si) {
  dst[di] = src[si]; dst[di + 1] = src[si + 1];
  dst[di + 2] = src[si + 2]; dst[di + 3] = src[si + 3];
}

function fxPixelArt(data, w, h, p, q) {
  let buf = data;
  const snap = p.snap === undefined ? 0.6 : p.snap;
  const jaggies = p.jaggies === undefined ? 0.4 : p.jaggies;
  const aaSteps = p.aaSteps === undefined ? 2 : p.aaSteps | 0;

  if (snap > 0)          buf = paEdgeSnap(buf, w, h, snap);
  if (p.orphans !== false) buf = paOrphans(buf, w, h);
  if (jaggies > 0)       buf = paJaggies(buf, w, h, jaggies);
  if (aaSteps < 4)       buf = paLimitAA(buf, w, h, aaSteps);
  if (p.outline && p.outline !== 'off') buf = paOutline(buf, w, h, p);
  return buf;
}

/**
 * Is this pixel a blend of the two pixels on either side of it, and if so, how
 * far along? Shared by EDGE SNAP and AA STEPS, which are the same question asked
 * with different answers.
 *
 * The reference pair is the pixel's own opposing neighbours — left/right or
 * up/down, whichever pair is further apart — and not the extremes of a 3×3
 * window. That distinction is the whole correctness of this file.
 *
 * A window model assumes the neighbourhood holds two regions with blends
 * stranded between them. Around an eye it holds four: the white, the iris, the
 * brow and the skin. Forced onto the two extremes, skin is "closer to" the eye
 * white and gets committed to it, so the white dilates and swallows the iris —
 * the pass eats the feature it was supposed to sharpen. Asking a pixel's actual
 * neighbours cannot make that mistake: skin sits at one END of the skin→white
 * pair, not between them, so it is left alone.
 *
 * Returns null unless the pixel is genuinely intermediate and genuinely on the
 * line between the two — a colour off that line is its own colour, not a mix.
 */
function paBlendAxis(lab, w, h, x, y) {
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return null;
  const c = y * w + x;
  const hL = c - 1, hR = c + 1, vU = c - w, vD = c + w;
  const dh = paDist2(lab, hL, hR), dv = paDist2(lab, vU, vD);
  const useH = dh >= dv;
  const a = useH ? hL : vU, b = useH ? hR : vD;
  const span = useH ? dh : dv;
  if (span < PA_EDGE_TOL2) return null;          // no edge here to resolve

  const pa = a * 3, pb = b * 3, pc = c * 3;
  const ex = lab[pb] - lab[pa], ey = lab[pb + 1] - lab[pa + 1], ez = lab[pb + 2] - lab[pa + 2];
  const vx = lab[pc] - lab[pa], vy = lab[pc + 1] - lab[pa + 1], vz = lab[pc + 2] - lab[pa + 2];
  const t = (vx * ex + vy * ey + vz * ez) / span;
  if (t <= 0.02 || t >= 0.98) return null;       // already committed to a side
  const rx = vx - t * ex, ry = vy - t * ey, rz = vz - t * ez;
  if (rx * rx + ry * ry + rz * rz > PA_EDGE_TOL2) return null;
  return { a, b, t };
}

/** Write the colour at position `t` along the a→b pair. */
function paWriteBlend(out, data, c, a, b, t) {
  const oa = a * 4, ob = b * 4, oc = c * 4;
  out[oc]     = data[oa]     + (data[ob]     - data[oa])     * t;
  out[oc + 1] = data[oa + 1] + (data[ob + 1] - data[oa + 1]) * t;
  out[oc + 2] = data[oa + 2] + (data[ob + 2] - data[oa + 2]) * t;
}

/**
 * EDGE SNAP — the de-antialiasing pass, and the one that does most of the work.
 *
 * A pixel stranded between two colours is anti-aliasing: it belongs to no
 * feature, and at this resolution there is no colour budget for it. That is what
 * makes a pixelated photo read as a blurry photo rather than as pixel art.
 *
 * So each blend pixel is pushed toward whichever of its two neighbours it
 * already leans to, by STRENGTH. At 1 it commits fully and the edge goes hard;
 * below that it keeps some of the blend. The edge itself never moves — only the
 * pixels that were sitting on the fence pick a side of it.
 */
function paEdgeSnap(data, w, h, strength) {
  const lab = paBuildLab(data, w * h);
  const out = new Uint8ClampedArray(data);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ax = paBlendAxis(lab, w, h, x, y);
      if (!ax) continue;
      const commit = ax.t < 0.5 ? 0 : 1;
      paWriteBlend(out, data, y * w + x, ax.a, ax.b, ax.t + (commit - ax.t) * strength);
    }
  }
  return out;
}

/**
 * CLEAN ORPHANS — a pixel with no company is noise, not a feature.
 *
 * Canonical rule: at this resolution a single stray pixel reads as dirt on the
 * screen. A pixel with no matching neighbour at all is replaced by the
 * neighbourhood's modal colour — the neighbour that the most other neighbours
 * agree with.
 *
 * Two guards, both learned the hard way, because loneliness alone is not
 * evidence of noise — at this size an eye *is* a lone pixel:
 *
 *   · Strictly no matching neighbour, not "at most one". A two-pixel pair is
 *     how an eye or a highlight gets spelled here, and each half of it has
 *     exactly one match.
 *   · Only low-contrast strays. A lone pixel that barely differs from its
 *     surroundings is resampling residue; one that differs sharply is a mark
 *     someone would have placed on purpose. This is also what stops the pass
 *     from eating a dither's own scattered pixels when it runs after DITHER,
 *     since those sit a full palette step away from their neighbours.
 */
// ΔE above which a lone pixel is treated as a deliberate accent, not as dirt.
const PA_ACCENT_TOL2 = 30 * 30;
function paOrphans(data, w, h) {
  const n = w * h;
  const lab = paBuildLab(data, n);
  const out = new Uint8ClampedArray(data);
  const nb = new Int32Array(8);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      let m = 0, kin = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const i = yy * w + xx;
          nb[m++] = i;
          if (paDist2(lab, c, i) < PA_EDGE_TOL2) kin++;
        }
      }
      if (m < 3 || kin > 0) continue;

      // Modal neighbour: the one the most other neighbours agree with.
      let best = -1, bestVotes = -1;
      for (let k = 0; k < m; k++) {
        let votes = 0;
        for (let j = 0; j < m; j++) {
          if (paDist2(lab, nb[k], nb[j]) < PA_EDGE_TOL2) votes++;
        }
        if (votes > bestVotes) { bestVotes = votes; best = nb[k]; }
      }
      if (best < 0 || bestVotes < 2) continue;
      if (paDist2(lab, c, best) >= PA_ACCENT_TOL2) continue;   // an accent, not dirt
      paCopy(out, c * 4, data, best * 4);
    }
  }
  return out;
}

/**
 * FIX JAGGIES — regularize the staircase.
 *
 * A hand-drawn pixel line has an even rhythm: runs of 2, or of 3, or a run
 * length that grows smoothly along a curve. What a resampler produces instead
 * is 2,2,1,2,2 — one short run that breaks the cadence and reads as a dent.
 * That single-pixel break is the "jaggy" every pixel art tutorial opens with.
 *
 * So the boundary between two colours is traced into a chain of runs, each run
 * length is compared against the median of its five-run neighbourhood, and runs
 * that break the local rhythm are resized to match. The median window is what
 * keeps curves intact: along a curve the run lengths change gradually, so the
 * median tracks them, and only a genuine outlier gets corrected.
 *
 * Runs at the ends of a chain are left alone — they are cut short by wherever
 * the trace happened to stop, so their length is not evidence of anything.
 *
 * The pass runs twice: once as written (near-vertical boundaries) and once on
 * the transposed image (near-horizontal ones).
 */
function paJaggies(data, w, h, strength) {
  // Integer run lengths mean the correction is a threshold, not a blend:
  // a light touch fixes only breaks of two or more, a firm one fixes every
  // single-pixel break.
  const dev = strength > 0.5 ? 1 : 2;
  let buf = paJaggiesPass(data, w, h, dev);
  const t = paTranspose(buf, w, h);
  buf = paJaggiesPass(t, h, w, dev);
  return paTranspose(buf, h, w);
}

function paTranspose(data, w, h) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) paCopy(out, (x * h + y) * 4, data, (y * w + x) * 4);
  }
  return out;
}

function paJaggiesPass(data, w, h, dev) {
  const n = w * h;
  const lab = paBuildLab(data, n);
  const out = new Uint8ClampedArray(data);
  const seen = new Uint8Array(n);            // crossing at (x,y) = between x and x+1
  const xs = new Int32Array(h);

  const isEdge = (x, y) => x >= 0 && x < w - 1 &&
    paDist2(lab, y * w + x, y * w + x + 1) >= PA_EDGE_TOL2;

  // The same boundary, one row down: within one column, and with both sides
  // still the colours we started with. Without the colour check a trace hops
  // onto whatever unrelated edge happens to pass nearby.
  const follow = (x, y, ny) => {
    const l = y * w + x, r = l + 1;
    let best = -1, bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      if (!isEdge(nx, ny) || seen[ny * w + nx]) continue;
      const nl = ny * w + nx, nr = nl + 1;
      if (paDist2(lab, l, nl) >= PA_EDGE_TOL2) continue;
      if (paDist2(lab, r, nr) >= PA_EDGE_TOL2) continue;
      const d = Math.abs(dx);
      if (d < bestD) { bestD = d; best = nx; }
    }
    return best;
  };

  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w - 1; x0++) {
      if (seen[y0 * w + x0] || !isEdge(x0, y0)) continue;

      // Walk the chain downward from this seed. Seeds are visited top-to-bottom,
      // so a chain is always entered at its top.
      let len = 0, x = x0;
      for (let y = y0; y < h; y++) {
        seen[y * w + x] = 1;
        xs[len++] = x;
        if (y === h - 1) break;
        const nx = follow(x, y, y + 1);
        if (nx < 0) break;
        x = nx;
      }
      if (len < 4) continue;

      // Runs of constant x.
      const runLen = [], runX = [];
      for (let i = 0; i < len; ) {
        let j = i;
        while (j < len && xs[j] === xs[i]) j++;
        runLen.push(j - i); runX.push(xs[i]);
        i = j;
      }
      const k = runLen.length;
      if (k < 4) continue;                    // not enough rhythm to judge

      // Median of the five-run window, then rebuild the chain from the
      // corrected lengths, anchored at the first run.
      const target = runLen.slice();
      for (let j = 1; j < k - 1; j++) {
        const lo = Math.max(0, j - 2), hi = Math.min(k - 1, j + 2);
        const win = runLen.slice(lo, hi + 1).sort((a, b) => a - b);
        const med = win[win.length >> 1];
        if (Math.abs(runLen[j] - med) >= dev) target[j] = med;
      }

      // Correct locally, one row at a time.
      //
      // Rebuilding the whole chain from the corrected run lengths is the obvious
      // move and it is wrong: the chain is anchored at its first run, so a single
      // corrected length shifts every row below it, and the "fix" arrives as a
      // long horizontal smear across the image. A jaggy is a one-pixel break in
      // the rhythm, so its repair may move one row by one column and no more.
      // Runs that are too short borrow the row below them; runs that are too long
      // hand their last row to the next run.
      const orig = xs.slice(0, len);
      const runStart = [];
      for (let j = 0, r = 0; j < k; j++) { runStart.push(r); r += runLen[j]; }

      for (let j = 1; j < k - 1; j++) {
        if (target[j] === runLen[j]) continue;
        if (target[j] > runLen[j]) {
          const row = runStart[j] + runLen[j];
          if (row < len) xs[row] = runX[j];
        } else {
          const row = runStart[j] + runLen[j] - 1;
          if (row > runStart[j]) xs[row] = runX[j + 1];
        }
      }

      // Repaint: the boundary moved one column, so the pixels it swept over
      // change sides. They take the colour of the pixel that already holds the
      // side they are joining — never a colour the image did not have.
      for (let i = 0, y = y0; i < len; i++, y++) {
        const from = orig[i];
        const to = xs[i];
        if (from === to || Math.abs(to - from) > 1) continue;
        const row4 = y * w;
        if (to > from) {
          for (let c = from + 1; c <= to && c < w; c++) paCopy(out, (row4 + c) * 4, data, (row4 + from) * 4);
        } else {
          for (let c = to + 1; c <= from && c < w; c++) paCopy(out, (row4 + c) * 4, data, (row4 + from + 1) * 4);
        }
      }
    }
  }
  return out;
}

/**
 * AA STEPS — cap how many intermediate shades an edge is allowed.
 *
 * A pixel sitting between two colours is anti-aliasing whether anyone chose it
 * or not. Pixel Parmesan's rule is that AA earns its place in small doses and
 * never on a line that is already clean, so: take how far along the blend the
 * pixel sits and round it to one of `steps + 1` levels. steps = 0 gives a hard
 * edge, 1 gives exactly one intermediate shade, and so on.
 *
 * Pure verticals, horizontals and true 45° diagonals get the hard edge
 * regardless of the setting — those lines read as clean on their own, and AA
 * on them only makes them look soft.
 */
function paLimitAA(data, w, h, steps) {
  const lab = paBuildLab(data, w * h);
  const out = new Uint8ClampedArray(data);
  const levels = Math.max(1, steps + 1);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ax = paBlendAxis(lab, w, h, x, y);
      if (!ax) continue;
      const t = paIsCleanLine(lab, w, h, x, y)
        ? Math.round(ax.t)
        : Math.round(ax.t * levels) / levels;
      paWriteBlend(out, data, y * w + x, ax.a, ax.b, t);
    }
  }
  return out;
}

/** Is the local edge axis-aligned or a true 45°? Sobel on L*, snapped. */
function paIsCleanLine(lab, w, h, x, y) {
  let gx = 0, gy = 0;
  const L = (xx, yy) => lab[(Math.min(h - 1, Math.max(0, yy)) * w +
                             Math.min(w - 1, Math.max(0, xx))) * 3];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const v = L(x + dx, y + dy);
      const wgt = (dx === 0 || dy === 0) ? 2 : 1;
      gx += wgt * dx * v; gy += wgt * dy * v;
    }
  }
  if (gx * gx + gy * gy < 1) return false;
  let ang = Math.atan2(gy, gx) * 180 / Math.PI;
  ang = ((ang % 45) + 45) % 45;
  return ang < 7 || ang > 38;
}

/**
 * OUTLINE — ink laid over the edges, not a colour swapped in.
 *
 * Two decisions, kept separate because they are separate:
 *
 * WHERE. Every pixel on the darker side of a boundary, and nothing cleverer.
 * Three filters were tried on top of this — contour length, edge strength, and
 * region area — and all three were worse in the picture even where they looked
 * better in a test: they each threw away real edges along with the specks, and
 * the figure came back muddy. Plain boundary detection follows the drawing
 * closely, which is what matters; if it also picks up small detail, that is
 * detail the picture actually has.
 *
 * WHAT. DARKNESS lays black over the pixel and HIGHLIGHT lays white, both as an
 * overlay at the slider's opacity — the same thing as dropping a black layer on
 * top at 10%. Overlay multiplies against what is underneath, so a red rim goes
 * to a darker red; it never washes toward grey.
 *
 * The colour is written straight out, deliberately. An earlier version resolved
 * the mix onto the nearest colour the image already had, which sounds tidy and
 * was the entire bug: if the image owned a grey at that lightness, every rim
 * became that grey no matter what colour it started as. The node runs before
 * DITHER, which re-decides every colour anyway, so there was nothing to gain.
 */
function paOutline(data, w, h, p) {
  const n = w * h;
  const lab = paBuildLab(data, n);
  const out = new Uint8ClampedArray(data);
  const kDark = p.outlineDarkness === undefined ? 0.5 : p.outlineDarkness;
  const kHigh = p.outlineHighlight === undefined ? 0 : p.outlineHighlight;
  const selout = p.outline === 'selout';
  const width = Math.max(1, Math.min(4, (p.outlineWidth | 0) || 1));
  if (kDark <= 0 && kHigh <= 0) return out;

  const rad = ((p.lightAngle === undefined ? 135 : p.lightAngle) * Math.PI) / 180;
  const lx = Math.cos(rad), ly = -Math.sin(rad);       // screen space: y grows down

  // ── Seeds: one pixel deep, on the darker side of every boundary.
  const marked = new Uint8Array(n);
  const factor = new Float32Array(n);
  let frontier = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y * w + x;
      const cp = c * 3;

      let edge = false, darker = true;
      let gx = 0, gy = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
        const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (paDist2(lab, c, j) < PA_EDGE_TOL2) continue;
        edge = true;
        if (lab[j * 3] < lab[cp]) darker = false;      // a darker neighbour outranks us
        const dL = lab[j * 3] - lab[cp];
        gx += (nx - x) * dL; gy += (ny - y) * dL;      // gradient toward light tones
      }
      if (!edge || !darker) continue;

      let f = 1;
      if (selout) {
        const g = Math.hypot(gx, gy);
        if (g < 1e-3) continue;
        // Bright side pointing away from the light means this rim is in
        // shadow; pointing toward it means the rim is catching light.
        f = -((gx / g) * lx + (gy / g) * ly);
        if (Math.abs(f) < 0.05) continue;
        if (f < 0) f *= 0.5;                           // lift the lit rim gently
      }

      marked[c] = 1; factor[c] = f;
      frontier.push(c);
    }
  }

  // ── Width: grow inward, one ring at a time, and only into pixels of the same
  //    region as the seed. Crossing the boundary would put the line on the wrong
  //    side of the form; staying inside keeps it a thicker version of the same
  //    line rather than a smear across the edge.
  for (let ring = 1; ring < width && frontier.length; ring++) {
    const next = [];
    for (const i of frontier) {
      const ix = i % w, iy = (i / w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = ix + (d === 0 ? -1 : d === 1 ? 1 : 0);
        const ny = iy + (d === 2 ? -1 : d === 3 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (marked[j]) continue;
        if (paDist2(lab, i, j) >= PA_EDGE_TOL2) continue;
        marked[j] = 1; factor[j] = factor[i];
        next.push(j);
      }
    }
    frontier = next;
  }

  // ── Apply.
  for (let c = 0; c < n; c++) {
    if (!marked[c]) continue;
    const o = c * 4;
    const f = factor[c];
    // f > 0 is the shadowed rim, f < 0 the lit one. Each side has its own
    // amount, and a side whose amount is zero is simply not drawn.
    const dark = f > 0 ? kDark * f : 0;
    const high = f < 0 ? kHigh * -f : 0;
    if (dark <= 0.001 && high <= 0.001) continue;

    for (let ch = 0; ch < 3; ch++) {
      let b = data[o + ch] / 255;
      if (dark > 0) b += (paOverlay(b, 0) - b) * dark;
      if (high > 0) b += (paOverlay(b, 1) - b) * high;
      out[o + ch] = b * 255;
    }
  }
  return out;
}

/** Standard overlay blend of `s` over `b`, both 0–1. */
function paOverlay(b, s) {
  return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
}

function fxDatabend(data, w, h, p, rng, q) {
  const out = new Uint8ClampedArray(data);
  const chunk = Math.max(1, p.chunk | 0);
  const rowBytes = w * 4;
  const ops = Math.floor(p.amount * (h / 2));

  // Palette-relative corruption: shift each hit pixel a few entries along the
  // palette instead of writing a random byte. Because the palette is ordered
  // by lightness, the damage reads as tonal banding within the image's own
  // colours rather than random confetti.
  const palette = p.paletteSafe === false ? null : activePaletteList(q);
  const usePalette = !!(palette && palette.length > 1);
  const indexOf = usePalette ? paletteIndexer(palette) : null;
  const drift = Math.max(1, p.drift | 0 || 3);

  // In palette-safe mode every offset is snapped to a pixel boundary.
  // An unaligned copy slides the channels along (R←G, G←B), which
  // manufactures colours that were never in the palette — that alone breaks
  // palette purity even before any deliberate corruption. Raw mode keeps the
  // unaligned behaviour, since that channel-smearing IS the byte-level look.
  const align = usePalette ? 4 : 1;
  const snap = v => Math.floor(v / align) * align;

  for (let n = 0; n < ops; n++) {
    const y = Math.floor(rng() * h);
    const len = Math.min(rowBytes, chunk * 4);
    const from = snap(Math.floor(rng() * Math.max(1, rowBytes - len)));
    const to   = snap(Math.floor(rng() * Math.max(1, rowBytes - len)));
    const base = y * rowBytes;
    const kind = rng();

    if (kind < 0.45) {
      // Copy a run from elsewhere in the row.
      out.copyWithin(base + to, base + from, base + from + len);
    } else if (kind < 0.8) {
      // Shift the whole row.
      const shift = Math.floor((rng() - 0.5) * 2 * chunk) * 4;
      const row = out.slice(base, base + rowBytes);
      for (let x = 0; x < rowBytes; x += 4) {
        const sx = ((x + shift) % rowBytes + rowBytes) % rowBytes;
        out[base + x]     = row[sx];
        out[base + x + 1] = row[sx + 1];
        out[base + x + 2] = row[sx + 2];
      }
    } else if (usePalette) {
      // Index-space corruption — stays inside the palette.
      for (let k = 0; k < len; k += 4) {
        const i = base + ((to + k) % rowBytes);
        const idx = indexOf(out[i], out[i + 1], out[i + 2]);
        const step = 1 + Math.floor(rng() * drift);
        const j = (idx + (rng() < 0.5 ? -step : step) + palette.length * 32) % palette.length;
        const c = palette[j];
        out[i] = c.r; out[i + 1] = c.g; out[i + 2] = c.b;
      }
    } else {
      // Raw byte corruption — the original behaviour, kept for when
      // PALETTE SAFE is off or no palette applies.
      for (let k = 0; k < len; k += 4) {
        const i = base + ((to + k) % rowBytes);
        out[i + (Math.floor(rng() * 3))] = Math.floor(rng() * 256);
      }
    }
  }
  return out;
}

function fxWave(data, w, h, p) {
  const out = new Uint8ClampedArray(data.length);
  const amp = p.amplitude, freq = p.frequency;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let sx = x, sy = y;
      if (p.vertical) sy = Math.round(y + Math.sin((x / w) * Math.PI * 2 * freq) * amp);
      else            sx = Math.round(x + Math.sin((y / h) * Math.PI * 2 * freq) * amp);
      sx = Math.max(0, Math.min(w - 1, sx));
      sy = Math.max(0, Math.min(h - 1, sy));
      const si = (sy * w + sx) * 4;
      out[i] = data[si]; out[i + 1] = data[si + 1];
      out[i + 2] = data[si + 2]; out[i + 3] = data[si + 3];
    }
  }
  return out;
}

const CAN_OFFSCREEN = typeof OffscreenCanvas === 'function' &&
                      typeof createImageBitmap === 'function';

async function fxJpeg(data, w, h, p, rng, q) {
  if (!CAN_OFFSCREEN) return data;                 // unsupported browser: no-op

  // JPEG is a continuous-tone codec — whatever goes in, arbitrary RGB comes
  // out. It can't be made palette-safe internally, so the decoded result is
  // re-snapped afterwards. The block artifacts survive; the colour drift
  // doesn't.
  const palette = p.paletteSafe === false ? null : activePaletteList(q);
  const finish = out => (palette && palette.length > 1 ? snapToPalette(out, palette) : out);

  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: p.quality });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Corrupt only well past the header — hitting the SOI/DQT/SOF
    // markers yields an undecodable file rather than a glitch.
    const safeStart = Math.min(bytes.length - 1, Math.max(64, Math.floor(bytes.length * 0.12)));
    const hits = Math.floor(p.corruption * 40);
    for (let i = 0; i < hits; i++) {
      const at = safeStart + Math.floor(rng() * (bytes.length - safeStart - 1));
      bytes[at] = Math.floor(rng() * 256);
    }

    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return finish(ctx.getImageData(0, 0, w, h).data);
    } catch {
      // Corruption killed the decoder — fall back to the clean
      // recompression so the stage still contributes its artifacts.
      const bmp = await createImageBitmap(blob);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      return finish(ctx.getImageData(0, 0, w, h).data);
    }
  } catch {
    return data;
  }
}

// ── Effect dispatch ─────────────────────────────────────────
async function applyEffect(item, data, w, h, s, q, index, blockSize) {
  const p = item.params || {};
  // Each effect draws from its own deterministic stream, keyed by
  // effect id + position, so reordering one doesn't reshuffle the rest.
  const rng = makeStream(s.seed >>> 0, item.id + ':' + index);

  switch (item.id) {
    case 'dither':    return runDither(data, w, h, s, q, rng);
    case 'pixelart':  return fxPixelArt(data, w, h, p, q);
    case 'chromatic': return fxChromatic(data, w, h, p);
    case 'glow':      return fxGlow(data, w, h, p);
    case 'scanlines': return fxScanlines(data, w, h, p, blockSize);
    case 'noise':     return fxNoise(data, w, h, p, rng, q);
    case 'pixelsort': return fxPixelSort(data, w, h, p);
    case 'databend':  return fxDatabend(data, w, h, p, rng, q);
    case 'wave':      return fxWave(data, w, h, p);
    case 'jpeg':      return await fxJpeg(data, w, h, p, rng, q);
    default:          return data;
  }
}

// ── Main pipeline ───────────────────────────────────────────
self.onmessage = async function (e) {
  const { jobId, imageData, width, height, settings: s, palette, outputSpaceIds } = e.data;

  try {
    // 0. Bypass — hand the source straight back, untouched.
    if (s.bypass) {
      const passthrough = new Uint8ClampedArray(imageData);
      self.postMessage({ jobId, result: passthrough, width, height }, [passthrough.buffer]);
      return;
    }

    // 1. Downscale
    const { data: small, width: w, height: h, blockSize } =
      downscale(imageData, width, height, s.pixelation, s, palette);

    // 2. Adjustments
    let buf = small;
    buf = applyBrightnessContrast(buf, s.brightness || 0, s.contrast || 0);
    if (s.blur > 0) buf = gaussianBlur(buf, w, h, s.blur);
    buf = applyBias(buf, Math.log(s.bias) / Math.log(0.5));

    // 3. Quantizer context, then the stack in order
    const q = buildQuantizer(s.colorMode, palette || [], s, buf);

    const stack = Array.isArray(s.effects) && s.effects.length
      ? s.effects
      : [{ id: 'dither', enabled: true, params: {} }];

    // Most effects belong in image space, at the dithered resolution, so they
    // see the same chunky pixels the dither produced. A few are screen-space
    // (scanlines) and must run at output resolution or their geometry gets
    // multiplied by the pixel-block size. The id list comes from the registry
    // so there's one source of truth.
    const screenSpace = new Set(outputSpaceIds || []);
    const imageStage = [], outputStage = [];
    stack.forEach((item, i) => {
      if (!item || item.enabled === false) return;
      (screenSpace.has(item.id) ? outputStage : imageStage).push({ item, i });
    });

    for (const { item, i } of imageStage) {
      buf = await applyEffect(item, buf, w, h, s, q, i);
    }

    // 4. Upscale, then run the screen-space effects at full resolution.
    //    blockSize is handed through so screen-space effects can lock their
    //    geometry to the pixel grid (SCANLINES uses it as the line period).
    let result = upscale(buf, w, h, width, height, blockSize);
    for (const { item, i } of outputStage) {
      result = await applyEffect(item, result, width, height, s, q, i, blockSize);
    }

    self.postMessage({ jobId, result, width, height }, [result.buffer]);
  } catch (err) {
    self.postMessage({ jobId, error: String(err && err.message || err) });
  }
};
