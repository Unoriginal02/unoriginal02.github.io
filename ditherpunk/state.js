/* ============================================================
   DITHERPUNK — Parameter Registry + Settings Store

   Single source of truth for every serializable setting.

   Everything downstream reads this registry instead of the DOM:
     · control rendering + binding   (no hand-written slider wiring)
     · presets                       (Store.serialize / deserialize)
     · randomize                     (legal ranges live on the param)
     · undo/redo                     (Store.snapshot / restore)
     · the worker payload            (Store.forWorker)

   Adding a parameter = adding one entry to PARAMS. Nothing else
   needs to know it exists.
   ============================================================ */

'use strict';

// ── Algorithm catalogue ─────────────────────────────────────
const ERROR_DIFFUSION = [
  'floyd-steinberg', 'stucki', 'atkinson', 'jjn', 'burkes',
  'sierra', 'sierra2', 'sierra-lite',
  'false-fs', 'fan-93', 'shiau-fan', 'shiau-fan-2',
  'stevenson-arce', 'ostromoukhov', 'zhou-fang',
];
const MODULATION = ['mod-wave', 'mod-lines', 'mod-rings'];

const isErrorDiffusion = t => ERROR_DIFFUSION.includes(t);
const isModulation     = t => MODULATION.includes(t);

// ── Effects registry (E1–E7) ────────────────────────────────
// Each effect declares its own params; the UI, randomizer and
// serializer all read them from here.
const EFFECTS = [
  {
    id: 'dither', label: 'DITHER', fixed: true, params: [],
    note: 'Quantization stage. Reorder it to change what runs before vs. after dithering.',
  },
  {
    id: 'chromatic', label: 'CHROMATIC ABERRATION', params: [
      { id: 'amount', label: 'AMOUNT', type: 'float', min: 0, max: 24, step: 0.1, default: 3, decimals: 1, random: { min: 1, max: 9 } },
      { id: 'angle',  label: 'ANGLE',  type: 'float', min: 0, max: 360, step: 1, default: 0, decimals: 0, random: { min: 0, max: 360 } },
    ],
  },
  {
    id: 'glow', label: 'GLOW', params: [
      { id: 'radius',    label: 'RADIUS',    type: 'float', min: 0.5, max: 24, step: 0.5, default: 4, decimals: 1, random: { min: 2, max: 12 } },
      { id: 'threshold', label: 'THRESHOLD', type: 'float', min: 0, max: 1, step: 0.01, default: 0.6, decimals: 2, random: { min: 0.3, max: 0.8 } },
      { id: 'strength',  label: 'STRENGTH',  type: 'float', min: 0, max: 2, step: 0.01, default: 0.8, decimals: 2, random: { min: 0.3, max: 1.4 } },
    ],
  },
  {
    id: 'scanlines', label: 'SCANLINES / CRT',
    // Screen-space effect: applied after upscaling so the lines stay a fixed
    // thickness on screen instead of being multiplied by the pixel blocks.
    outputSpace: true,
    note: 'Runs in screen space after upscaling, so line spacing is in real pixels and does not change with PIXELATION.',
    params: [
      { id: 'orientation', label: 'ORIENTATION', type: 'enum', default: 'horizontal',
        options: [
          { value: 'horizontal', label: 'HORIZONTAL' },
          { value: 'vertical',   label: 'VERTICAL' },
        ] },
      { id: 'spacing',   label: 'SPACING',   type: 'int',   min: 2, max: 32, step: 1, default: 4, random: { min: 2, max: 8 } },
      { id: 'thickness', label: 'THICKNESS', type: 'int',   min: 1, max: 12, step: 1, default: 1, random: { min: 1, max: 3 } },
      { id: 'strength',  label: 'STRENGTH',  type: 'float', min: 0, max: 1, step: 0.01, default: 0.45, decimals: 2, random: { min: 0.2, max: 0.8 } },
      // Aperture-grille stripes are a separate physical feature of a CRT and
      // run perpendicular to the scan lines. Off by default so SCANLINES
      // alone produces actual scan lines.
      { id: 'mask',      label: 'PHOSPHOR MASK', type: 'float', min: 0, max: 1, step: 0.01, default: 0, decimals: 2, random: { min: 0, max: 0.6 } },
    ],
  },
  {
    id: 'noise', label: 'NOISE / GRAIN',
    note: 'Palette safe: grain is applied by nudging each pixel along the palette instead of offsetting its channels, so no new colours appear.',
    params: [
      { id: 'amount', label: 'AMOUNT', type: 'float', min: 0, max: 1, step: 0.01, default: 0.15, decimals: 2, random: { min: 0.05, max: 0.5 } },
      { id: 'paletteSafe', label: 'PALETTE SAFE', type: 'bool', default: true },
      // Channel-independent grain only means anything when the effect is
      // free to write arbitrary RGB.
      { id: 'mono', label: 'MONOCHROME', type: 'bool', default: true,
        visibleWhen: params => params.paletteSafe === false },
    ],
  },
  {
    id: 'pixelsort', label: 'PIXEL SORT',
    note: 'Sorts runs of pixels whose brightness falls between LOWER and UPPER. Narrow the band to target just highlights or just shadows; MAX RUN caps how long a single sorted streak can get.',
    params: [
      // A brightness band rather than one threshold: with a single cutoff the
      // sorted area jumps around with the image histogram, so the control
      // feels like it does nothing and then everything.
      { id: 'lower',  label: 'LOWER',  type: 'float', min: 0, max: 1, step: 0.01, default: 0.25, decimals: 2, random: { min: 0, max: 0.4 } },
      { id: 'upper',  label: 'UPPER',  type: 'float', min: 0, max: 1, step: 0.01, default: 0.9,  decimals: 2, random: { min: 0.6, max: 1 } },
      // 0 = unlimited. Without a cap one run can swallow an entire row.
      { id: 'maxRun', label: 'MAX RUN', type: 'int', min: 0, max: 512, step: 1, default: 64, random: { min: 8, max: 200 } },
      { id: 'vertical', label: 'VERTICAL', type: 'bool', default: false },
      { id: 'reverse',  label: 'REVERSE',  type: 'bool', default: false },
    ],
  },
  {
    id: 'databend', label: 'DATABEND',
    note: 'Corrupts the image the way a damaged indexed bitmap breaks: copied runs, shifted rows and drifting colour indices.',
    params: [
      { id: 'amount', label: 'AMOUNT', type: 'float', min: 0, max: 1, step: 0.01, default: 0.2, decimals: 2, random: { min: 0.05, max: 0.5 } },
      { id: 'chunk',  label: 'CHUNK',  type: 'int',   min: 1, max: 200, step: 1, default: 24, random: { min: 4, max: 90 } },
      // Corruption in index space rather than byte space: a damaged indexed
      // image still only ever shows colours from its own palette.
      { id: 'paletteSafe', label: 'PALETTE SAFE', type: 'bool', default: true },
      { id: 'drift', label: 'INDEX DRIFT', type: 'int', min: 1, max: 16, step: 1, default: 3, random: { min: 1, max: 8 },
        visibleWhen: params => params.paletteSafe !== false },
    ],
  },
  {
    id: 'wave', label: 'WAVE DISPLACE', params: [
      { id: 'amplitude', label: 'AMPLITUDE', type: 'float', min: 0, max: 40, step: 0.5, default: 6, decimals: 1, random: { min: 2, max: 18 } },
      { id: 'frequency', label: 'FREQUENCY', type: 'float', min: 0.5, max: 40, step: 0.5, default: 6, decimals: 1, random: { min: 2, max: 20 } },
      { id: 'vertical',  label: 'VERTICAL',  type: 'bool', default: false },
    ],
  },
  {
    id: 'jpeg', label: 'JPEG GLITCH',
    note: 'JPEG is a continuous-tone format, so the codec always returns off-palette colours. PALETTE SAFE re-snaps the decoded result to the palette, keeping the block artifacts without the colour drift.',
    params: [
      { id: 'quality',   label: 'QUALITY',   type: 'float', min: 0.01, max: 0.9, step: 0.01, default: 0.15, decimals: 2, random: { min: 0.02, max: 0.4 } },
      { id: 'corruption',label: 'CORRUPTION',type: 'float', min: 0, max: 1, step: 0.01, default: 0.3, decimals: 2, random: { min: 0.05, max: 0.7 } },
      { id: 'paletteSafe', label: 'PALETTE SAFE', type: 'bool', default: true },
    ],
  },
];

const EFFECT_BY_ID = Object.create(null);
for (const e of EFFECTS) EFFECT_BY_ID[e.id] = e;

/** Stack entry with every param filled in from the effect definition. */
function makeEffect(id, enabled) {
  const def = EFFECT_BY_ID[id];
  if (!def) return null;
  const params = Object.create(null);
  for (const p of def.params) params[p.id] = p.default;
  return { id, enabled: enabled !== false, params };
}

// ── Parameter registry ──────────────────────────────────────
const PARAMS = [
  // ── Color ──
  {
    id: 'colorMode', group: 'color', label: 'COLOR MODE', type: 'enum',
    default: 'fullcolor',
    options: [
      { value: 'fullcolor', label: 'FULL COLOR' },
      { value: 'mono',      label: '1-BIT MONO' },
      { value: 'film',      label: '1-BIT FILM' },
      { value: 'filmcolor', label: 'FILM SIM' },
      // Value stays 'ramp' so existing presets keep working.
      { value: 'ramp',      label: 'CUSTOM' },
    ],
    random: ['fullcolor', 'mono', 'film', 'filmcolor', 'ramp'],
  },
  {
    id: 'paletteSource', group: 'color', label: 'PALETTE SOURCE', type: 'enum',
    default: 'film',
    options: [
      { value: 'film',      label: 'FILM PALETTE' },
      { value: 'extracted', label: 'FROM IMAGE' },
    ],
    visibleWhen: s => s.colorMode === 'filmcolor',
    random: ['film', 'extracted'],
    tip: 'Use a loaded film palette, or extract the palette from the image itself.',
  },
  {
    id: 'extractCount', group: 'color', label: 'EXTRACTED COLORS', type: 'int',
    min: 2, max: 64, step: 1, default: 16,
    visibleWhen: s => s.colorMode === 'filmcolor' && s.paletteSource === 'extracted',
    random: { min: 4, max: 32 },
    tip: 'How many colors to pull out of the image with median-cut quantization.',
  },
  {
    id: 'customPalette', group: 'color', label: 'CUSTOM PALETTE', type: 'palette',
    default: [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }],
    keepOnReset: true,
    tip: 'Your own palette. Build it by hand, pull it from a film palette, or extract it from the image.',
  },
  {
    id: 'customMatch', group: 'color', label: 'MATCHING', type: 'enum',
    default: 'nearest',
    options: [
      { value: 'nearest', label: 'NEAREST COLOR' },
      { value: 'bands',   label: 'LUMINANCE BANDS' },
    ],
    visibleWhen: s => s.colorMode === 'ramp',
    random: ['nearest', 'bands'],
    tip: 'NEAREST COLOR maps every pixel to the perceptually closest palette entry (hue and lightness both matter) — the same matching Film Sim uses. LUMINANCE BANDS ignores hue and slices the image\'s tonal range, one band per color, dark to light.',
  },
  {
    id: 'rampDistribution', group: 'color', label: 'BAND DISTRIBUTION', type: 'enum',
    default: 'even',
    options: [
      { value: 'even',     label: 'EVEN' },
      { value: 'adaptive', label: 'ADAPTIVE' },
    ],
    visibleWhen: s => s.colorMode === 'ramp' && s.customMatch === 'bands',
    random: ['even', 'adaptive'],
    tip: 'EVEN splits the lightness range into equal bands. ADAPTIVE sizes bands by the image histogram so each color covers a similar area.',
  },

  // ── Algorithm ──
  {
    id: 'ditherType', group: 'dither', label: 'DITHER ALGORITHM', type: 'enum',
    default: 'floyd-steinberg',
    options: [
      { value: 'floyd-steinberg', label: 'Floyd-Steinberg',      section: 'ERROR DIFFUSION' },
      { value: 'stucki',          label: 'Stucki',               section: 'ERROR DIFFUSION' },
      { value: 'atkinson',        label: 'Atkinson',             section: 'ERROR DIFFUSION' },
      { value: 'jjn',             label: 'Jarvis-Judice-Ninke',  section: 'ERROR DIFFUSION' },
      { value: 'burkes',          label: 'Burkes',               section: 'ERROR DIFFUSION' },
      { value: 'sierra',          label: 'Sierra',               section: 'ERROR DIFFUSION' },
      { value: 'sierra2',         label: 'Sierra Two-Row',       section: 'ERROR DIFFUSION' },
      { value: 'sierra-lite',     label: 'Sierra Lite',          section: 'ERROR DIFFUSION' },
      { value: 'false-fs',        label: 'False Floyd-Steinberg',section: 'ERROR DIFFUSION' },
      { value: 'fan-93',          label: 'Fan 93',               section: 'ERROR DIFFUSION' },
      { value: 'shiau-fan',       label: 'Shiau-Fan',            section: 'ERROR DIFFUSION' },
      { value: 'shiau-fan-2',     label: 'Shiau-Fan 2',          section: 'ERROR DIFFUSION' },
      { value: 'stevenson-arce',  label: 'Stevenson-Arce',       section: 'ERROR DIFFUSION' },
      // Variable-coefficient. Interpolated approximation of the published
      // tables rather than the full 256-entry originals — hence "approx".
      { value: 'ostromoukhov',    label: 'Ostromoukhov (approx)',section: 'ERROR DIFFUSION' },
      { value: 'zhou-fang',       label: 'Zhou-Fang (approx)',   section: 'ERROR DIFFUSION' },
      { value: 'bayer2',          label: 'Bayer 2×2',            section: 'ORDERED' },
      { value: 'bayer4',          label: 'Bayer 4×4',            section: 'ORDERED' },
      { value: 'bayer8',          label: 'Bayer 8×8',            section: 'ORDERED' },
      { value: 'void-cluster',    label: 'Void and Cluster',     section: 'ORDERED' },
      { value: 'bluenoise',       label: 'Blue Noise 64×64',     section: 'ORDERED' },
      { value: 'halftone',        label: 'Halftone',             section: 'ORDERED' },
      { value: 'mod-wave',        label: 'Wave Modulation',      section: 'MODULATION' },
      { value: 'mod-lines',       label: 'Modulation Lines',     section: 'MODULATION' },
      { value: 'mod-rings',       label: 'Radial Rings',         section: 'MODULATION' },
    ],
    randomAll: true,
  },
  {
    id: 'serpentine', group: 'dither', label: 'SERPENTINE SCAN', type: 'bool',
    default: true,
    visibleWhen: s => isErrorDiffusion(s.ditherType),
    random: [true, false],
    tip: 'Alternate the scan direction each row. Breaks up the diagonal "worming" artifacts error diffusion produces on flat gradients.',
  },
  {
    id: 'modWave', group: 'dither', label: 'WAVEFORM', type: 'enum',
    default: 'sine',
    options: [
      { value: 'sine',     label: 'SINE' },
      { value: 'triangle', label: 'TRIANGLE' },
      { value: 'square',   label: 'SQUARE' },
      { value: 'saw',      label: 'SAW' },
    ],
    visibleWhen: s => isModulation(s.ditherType),
    random: ['sine', 'triangle', 'square', 'saw'],
  },
  {
    id: 'modFrequency', group: 'dither', label: 'MOD FREQUENCY', type: 'float',
    min: 0.5, max: 40, step: 0.5, default: 8, decimals: 1,
    visibleWhen: s => isModulation(s.ditherType),
    random: { min: 2, max: 24 },
  },
  {
    id: 'modAmplitude', group: 'dither', label: 'MOD AMPLITUDE', type: 'float',
    min: 0, max: 1, step: 0.01, default: 0.5, decimals: 2,
    visibleWhen: s => isModulation(s.ditherType),
    random: { min: 0.2, max: 0.9 },
  },
  {
    id: 'modAngle', group: 'dither', label: 'MOD ANGLE', type: 'float',
    min: 0, max: 360, step: 1, default: 45, decimals: 0,
    visibleWhen: s => s.ditherType === 'mod-wave' || s.ditherType === 'mod-lines',
    random: { min: 0, max: 360 },
  },

  // ── Adjustments ──
  {
    id: 'pixelation', group: 'adjustments', label: 'PIXELATION', type: 'float',
    min: 0.001, max: 0.95, step: 0.001, default: 0.25,
    format: v => (v < 0.01 ? Number(v).toFixed(4) : Number(v).toFixed(2)),
    random: { min: 0.05, max: 0.6 },
    tip: 'Scales the image down before processing. Lower values = more pixelated. Can go all the way to a single pixel.',
  },
  {
    id: 'brightness', group: 'adjustments', label: 'BRIGHTNESS', type: 'float',
    min: -1, max: 1, step: 0.01, default: 0, decimals: 2,
    random: { min: -0.35, max: 0.35 },
    tip: 'Linear exposure shift applied before quantization.',
  },
  {
    id: 'contrast', group: 'adjustments', label: 'CONTRAST', type: 'float',
    min: -1, max: 1, step: 0.01, default: 0, decimals: 2,
    random: { min: -0.35, max: 0.5 },
    tip: 'Expands or compresses tones around mid-grey before quantization.',
  },
  {
    id: 'blur', group: 'adjustments', label: 'BLUR', type: 'float',
    min: 0, max: 12, step: 0.1, default: 0, decimals: 1,
    random: { min: 0, max: 3 },
    tip: 'Gaussian softening before dithering. Smooths noisy source images so the dither pattern reads cleanly.',
  },
  {
    id: 'ditherThreshold', group: 'adjustments', label: 'DITHER STRENGTH', type: 'float',
    min: 0, max: 1, step: 0.01, default: 0.5, decimals: 2,
    random: { min: 0.15, max: 0.85 },
    tip: 'For ordered dithering: how strongly the threshold matrix perturbs each pixel. For error diffusion: pixels close to a palette color snap flat without diffusion.',
  },
  {
    id: 'halftoneCellSize', group: 'adjustments', label: 'HALFTONE CELL SIZE', type: 'int',
    min: 2, max: 24, step: 1, default: 8,
    random: { min: 3, max: 14 },
    visibleWhen: s => s.ditherType === 'halftone',
    tip: 'Dot size in halftone mode. Larger values = bigger, more visible dots.',
  },
  {
    id: 'bias', group: 'adjustments', label: 'BIAS', type: 'float',
    min: 0.01, max: 0.99, step: 0.01, default: 0.5, decimals: 2,
    random: { min: 0.3, max: 0.7 },
    tip: 'Power-curve tone adjustment before quantization. 0.5 = neutral. Below darkens, above brightens.',
  },

  // ── Palette selection ──
  {
    id: 'selectedFilm', group: 'palette', label: 'FILM SIMULATION', type: 'ref',
    default: null,
    affectsRender: s => (s.colorMode === 'film') ||
                        (s.colorMode === 'filmcolor' && s.paletteSource === 'film'),
    keepOnReset: true,
  },

  // ── Effects stack (E1) ──
  {
    id: 'effects', group: 'effects', label: 'EFFECTS', type: 'stack',
    default: [makeEffect('dither')],
  },

  // ── Export ──
  {
    id: 'exportFormat', group: 'export', label: 'FORMAT', type: 'enum',
    default: 'png',
    options: [
      { value: 'png',  label: 'PNG' },
      { value: 'jpeg', label: 'JPG' },
      { value: 'webp', label: 'WEBP' },
    ],
    affectsRender: false,
  },
  {
    id: 'exportQuality', group: 'export', label: 'QUALITY', type: 'float',
    min: 0.1, max: 1, step: 0.01, default: 0.92, decimals: 2,
    visibleWhen: s => s.exportFormat !== 'png',
    affectsRender: false,
  },
  {
    id: 'exportScale', group: 'export', label: 'SIZE', type: 'enum',
    default: '1',
    options: [
      { value: '1', label: '1×' },
      { value: '2', label: '2×' },
      { value: '4', label: '4×' },
    ],
    affectsRender: false,
  },
  {
    id: 'exportMatte', group: 'export', label: 'JPG MATTE', type: 'color',
    default: '#000000',
    visibleWhen: s => s.exportFormat === 'jpeg',
    affectsRender: false,
    tip: 'JPG has no alpha — transparent areas are filled with this color.',
  },

  // ── Bypass ──
  {
    id: 'bypass', group: 'system', label: 'BYPASS PIPELINE', type: 'bool',
    default: false,
    // Never persisted and never stored in a preset. A leftover bypass on the
    // next page load looks exactly like "the app stopped working".
    transient: true,
    tip: 'Show the uploaded image exactly as it is — no dithering, no adjustments, no effects. Turn it off to resume processing. Resets when you load a new image.',
  },

  // ── Reproducibility ──
  {
    id: 'seed', group: 'system', label: 'SEED', type: 'seed', default: 1,
    tip: 'Drives every random stage. The same seed always reproduces the same result.',
  },
];

const PARAM_BY_ID = Object.create(null);
for (const p of PARAMS) PARAM_BY_ID[p.id] = p;

// ── Store ───────────────────────────────────────────────────
const Store = (() => {
  const SCHEMA_VERSION = 3;
  const LS_SETTINGS = 'ditherpunk_settings';
  const LS_LEGACY   = 'ditherpunk_prefs';

  const data = Object.create(null);
  const bounds = Object.create(null);
  const listeners = [];

  let txDepth = 0;
  let txChanged = null;

  const clone = v => (typeof structuredClone === 'function'
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v)));

  function defaults() {
    const o = Object.create(null);
    for (const p of PARAMS) {
      o[p.id] = (p.type === 'stack' || p.type === 'palette') ? clone(p.default) : p.default;
    }
    return o;
  }

  function boundsFor(p) {
    const b = bounds[p.id];
    return {
      min: b && b.min !== undefined ? b.min : p.min,
      max: b && b.max !== undefined ? b.max : p.max,
    };
  }

  function clampNum(spec, value, isInt, override) {
    let v = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(v)) return undefined;
    if (isInt) v = Math.round(v);
    const min = override && override.min !== undefined ? override.min : spec.min;
    const max = override && override.max !== undefined ? override.max : spec.max;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  /** Coerce one effect-param value against its spec. */
  function coerceEffectParam(spec, value) {
    switch (spec.type) {
      case 'int':   return clampNum(spec, value, true);
      case 'float': return clampNum(spec, value, false);
      case 'bool':  return !!value;
      case 'enum':  return spec.options.some(o => o.value === value) ? value : spec.default;
      default:      return value;
    }
  }

  /** Validate an effects stack, filling gaps from the registry. */
  function coerceStack(value) {
    if (!Array.isArray(value)) return undefined;
    const out = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const def = EFFECT_BY_ID[item.id];
      if (!def) continue;                       // unknown effect from a newer build
      const params = Object.create(null);
      for (const spec of def.params) {
        const raw = item.params ? item.params[spec.id] : undefined;
        params[spec.id] = raw === undefined ? spec.default : coerceEffectParam(spec, raw);
      }
      out.push({ id: def.id, enabled: item.enabled !== false, params });
    }
    // The dither node is mandatory and unique.
    const dithers = out.filter(e => e.id === 'dither');
    if (dithers.length === 0) out.push(makeEffect('dither'));
    else if (dithers.length > 1) {
      let seen = false;
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].id !== 'dither') continue;
        if (seen) out.splice(i, 1); else seen = true;
      }
    }
    return out;
  }

  function coercePalette(value) {
    if (!Array.isArray(value)) return undefined;
    const out = [];
    for (const c of value) {
      if (!c) continue;
      const r = clampNum({ min: 0, max: 255 }, c.r, true);
      const g = clampNum({ min: 0, max: 255 }, c.g, true);
      const b = clampNum({ min: 0, max: 255 }, c.b, true);
      if (r === undefined || g === undefined || b === undefined) continue;
      out.push({ r, g, b });
    }
    return out.length ? out : undefined;
  }

  function coerce(id, value) {
    const p = PARAM_BY_ID[id];
    if (!p) return undefined;
    switch (p.type) {
      case 'float': return clampNum(p, value, false, boundsFor(p));
      case 'int':   return clampNum(p, value, true,  boundsFor(p));
      case 'enum':  return p.options.some(o => o.value === value) ? value : undefined;
      case 'bool':  return !!value;
      case 'seed': {
        const v = typeof value === 'number' ? value : parseInt(value, 10);
        return Number.isFinite(v) ? (v >>> 0) : undefined;
      }
      case 'color': return /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
      case 'stack': return coerceStack(value);
      case 'palette': return coercePalette(value);
      case 'ref':
      default:      return value;
    }
  }

  // Deep-ish equality: scalars by ===, structured params by JSON.
  function same(p, a, b) {
    if (p.type === 'stack' || p.type === 'palette') {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
  }

  function notify(changed) {
    if (!changed.length) return;
    if (txDepth > 0) {
      for (const id of changed) if (!txChanged.includes(id)) txChanged.push(id);
      return;
    }
    for (const fn of listeners.slice()) fn(changed);
  }

  const api = {
    data, PARAMS, PARAM_BY_ID, EFFECTS, EFFECT_BY_ID,

    get(id) { return data[id]; },
    param(id) { return PARAM_BY_ID[id]; },

    set(id, value) {
      const p = PARAM_BY_ID[id];
      if (!p) return false;
      const v = coerce(id, value);
      if (v === undefined || same(p, data[id], v)) return false;
      data[id] = v;
      notify([id]);
      return true;
    },

    patch(obj) {
      const changed = [];
      for (const id of Object.keys(obj)) {
        const p = PARAM_BY_ID[id];
        if (!p) continue;
        const v = coerce(id, obj[id]);
        if (v === undefined || same(p, data[id], v)) continue;
        data[id] = v;
        changed.push(id);
      }
      notify(changed);
      return changed;
    },

    transaction(fn) {
      txDepth++;
      if (txDepth === 1) txChanged = [];
      try { fn(); }
      finally {
        txDepth--;
        if (txDepth === 0) { const c = txChanged; txChanged = null; notify(c); }
      }
    },

    setBounds(id, next) {
      if (!PARAM_BY_ID[id]) return;
      bounds[id] = Object.assign({}, bounds[id], next);
      const re = coerce(id, data[id]);
      if (re !== undefined && re !== data[id]) { data[id] = re; notify([id]); }
    },

    bounds(id) {
      const p = PARAM_BY_ID[id];
      return p ? boundsFor(p) : {};
    },

    isVisible(id) {
      const p = PARAM_BY_ID[id];
      if (!p) return false;
      return p.visibleWhen ? !!p.visibleWhen(data) : true;
    },

    subscribe(fn) {
      listeners.push(fn);
      return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    },

    reset() {
      const d = defaults();
      for (const p of PARAMS) if (p.keepOnReset) delete d[p.id];
      api.patch(d);
    },

    defaults,

    // ── Effects stack helpers ──
    stack() { return data.effects; },

    addEffect(id) {
      const e = makeEffect(id);
      if (!e) return false;
      const next = clone(data.effects);
      // New effects land after the dither node by default — post-dither
      // is where glitch work reads best.
      const di = next.findIndex(x => x.id === 'dither');
      next.splice(di < 0 ? next.length : di + 1, 0, e);
      return api.set('effects', next);
    },

    removeEffect(index) {
      const next = clone(data.effects);
      if (index < 0 || index >= next.length) return false;
      if (next[index].id === 'dither') return false;      // not removable
      next.splice(index, 1);
      return api.set('effects', next);
    },

    moveEffect(index, delta) {
      const next = clone(data.effects);
      const to = index + delta;
      if (index < 0 || index >= next.length || to < 0 || to >= next.length) return false;
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return api.set('effects', next);
    },

    toggleEffect(index) {
      const next = clone(data.effects);
      if (!next[index]) return false;
      next[index].enabled = !next[index].enabled;
      return api.set('effects', next);
    },

    setEffectParam(index, paramId, value) {
      const next = clone(data.effects);
      const item = next[index];
      if (!item) return false;
      const def = EFFECT_BY_ID[item.id];
      const spec = def && def.params.find(p => p.id === paramId);
      if (!spec) return false;
      item.params[paramId] = coerceEffectParam(spec, value);
      return api.set('effects', next);
    },

    // ── Custom palette helpers (D4) ──
    addPaletteColor(rgb) {
      const next = clone(data.customPalette);
      next.push(rgb || { r: 128, g: 128, b: 128 });
      return api.set('customPalette', next);
    },

    removePaletteColor(index) {
      const next = clone(data.customPalette);
      if (next.length <= 1) return false;
      next.splice(index, 1);
      return api.set('customPalette', next);
    },

    setPaletteColor(index, rgb) {
      const next = clone(data.customPalette);
      if (!next[index]) return false;
      next[index] = rgb;
      return api.set('customPalette', next);
    },

    // ── Snapshot / restore — the substrate for undo/redo ──
    snapshot() { return clone(Object.assign({}, data)); },
    restore(snap) { return api.patch(snap); },

    forWorker() { return clone(Object.assign({}, data)); },

    // ── Serialization ──
    // Transient params are left out entirely: they must not persist across
    // reloads and must not travel inside a shared preset. Undo/redo uses
    // snapshot/restore instead, so it still captures them.
    serialize() {
      const settings = clone(Object.assign({}, data));
      for (const p of PARAMS) if (p.transient) delete settings[p.id];
      return { version: SCHEMA_VERSION, settings };
    },

    deserialize(raw) {
      if (!raw || typeof raw !== 'object') return [];
      const src = raw.settings && typeof raw.settings === 'object' ? raw.settings : raw;
      const incoming = Object.assign({}, src);
      // Also strip on the way in, so blobs written by an older build (or a
      // hand-edited preset) can't switch bypass back on.
      for (const p of PARAMS) if (p.transient) delete incoming[p.id];
      return api.patch(incoming);
    },

    save() {
      try { localStorage.setItem(LS_SETTINGS, JSON.stringify(api.serialize())); } catch {}
    },

    load() {
      try {
        const raw = localStorage.getItem(LS_SETTINGS);
        if (raw) { api.deserialize(JSON.parse(raw)); return true; }
      } catch {}
      return api.migrateLegacy();
    },

    migrateLegacy() {
      try {
        const raw = localStorage.getItem(LS_LEGACY);
        if (!raw) return false;
        const p = JSON.parse(raw);
        api.patch({
          colorMode: p.colorMode, ditherType: p.ditherType, pixelation: p.pixelation,
          bias: p.bias, ditherThreshold: p.ditherThreshold,
          halftoneCellSize: p.halftoneCellSize, selectedFilm: p.selectedFilm,
        });
        api.save();
        return true;
      } catch { return false; }
    },
  };

  Object.assign(data, defaults());
  return api;
})();

// ── Randomize (G4) ──────────────────────────────────────────
const Randomizer = (() => {
  // Effects that read well when stacked at random.
  const POOL = ['chromatic', 'glow', 'scanlines', 'noise', 'pixelsort', 'databend', 'wave', 'jpeg'];

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  function randomValue(rng, p) {
    if (Array.isArray(p.random)) return pick(rng, p.random);
    if (p.randomAll && p.options) return pick(rng, p.options.map(o => o.value));
    if (p.random && typeof p.random === 'object') {
      const { min, max } = p.random;
      const v = min + rng() * (max - min);
      return p.type === 'int' ? Math.round(v) : v;
    }
    return undefined;
  }

  function randomEffectParams(rng, def) {
    const params = Object.create(null);
    for (const spec of def.params) {
      if (spec.type === 'bool') { params[spec.id] = rng() < 0.5; continue; }
      const v = randomValue(rng, spec);
      params[spec.id] = v === undefined ? spec.default : v;
    }
    return params;
  }

  /**
   * @param opts.effects  also rebuild the effect stack
   * @param opts.palettes list of loadable film palette names
   */
  function randomize(opts) {
    opts = opts || {};
    const seed = randomSeed();
    const rng = makeRng(seed);

    const next = { seed };
    for (const p of PARAMS) {
      if (p.group === 'export' || p.type === 'stack' || p.type === 'palette') continue;
      if (p.id === 'selectedFilm') continue;
      const v = randomValue(rng, p);
      if (v !== undefined) next[p.id] = v;
    }

    if (opts.palettes && opts.palettes.length) {
      next.selectedFilm = pick(rng, opts.palettes);
    }

    if (opts.effects !== false) {
      const count = Math.floor(rng() * 3);           // 0–2 extra effects
      const chosen = [];
      const pool = POOL.slice();
      for (let i = 0; i < count && pool.length; i++) {
        const idx = Math.floor(rng() * pool.length) % pool.length;
        chosen.push(pool.splice(idx, 1)[0]);
      }
      const stack = [makeEffect('dither')];
      for (const id of chosen) {
        const def = EFFECT_BY_ID[id];
        stack.push({ id, enabled: true, params: randomEffectParams(rng, def) });
      }
      next.effects = stack;
    }

    Store.transaction(() => Store.patch(next));
    return next;
  }

  return { randomize };
})();

// ── Undo / redo (G5) ────────────────────────────────────────
const History = (() => {
  const LIMIT = 60;
  const past = [];
  const future = [];
  let applying = false;
  let pendingId = null;
  let pendingTimer = null;
  let current = null;
  let interacting = false;
  let interactionFirst = false;
  const listeners = [];

  function emit() { for (const fn of listeners) fn(); }

  function commit(snap) {
    past.push(snap);
    if (past.length > LIMIT) past.shift();
    future.length = 0;
    emit();
  }

  return {
    /** Seed the baseline once the initial settings are loaded. */
    init() { current = Store.snapshot(); },

    /**
     * Record a change. Consecutive edits to the same slider inside 600ms
     * coalesce, so a drag is one undo steprather than fifty.
     *
     * Only continuous params coalesce. Discrete edits — adding a palette
     * colour, reordering the stack, flipping a toggle — are each their own
     * step even when they touch the same param id repeatedly.
     */
    /**
     * Wrap a continuous gesture (dragging in the colour picker) so the whole
     * gesture collapses to a single undo step, regardless of param type.
     */
    beginInteraction() { interacting = true; interactionFirst = true; },
    endInteraction() { interacting = false; pendingId = null; },

    record(changed) {
      if (applying || !current) return;

      if (interacting) {
        if (interactionFirst) { commit(current); interactionFirst = false; }
        current = Store.snapshot();
        return;
      }

      const single = changed.length === 1 ? changed[0] : null;
      const type = single && PARAM_BY_ID[single] && PARAM_BY_ID[single].type;
      const continuous = type === 'float' || type === 'int' || type === 'seed';
      const coalesce = continuous && single === pendingId;

      if (!coalesce) commit(current);

      current = Store.snapshot();
      pendingId = continuous ? single : null;
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { pendingId = null; }, 600);
    },

    undo() {
      if (!past.length) return false;
      const snap = past.pop();
      future.push(Store.snapshot());
      applying = true;
      try { Store.restore(snap); } finally { applying = false; }
      current = Store.snapshot();
      pendingId = null;
      emit();
      return true;
    },

    redo() {
      if (!future.length) return false;
      const snap = future.pop();
      past.push(Store.snapshot());
      applying = true;
      try { Store.restore(snap); } finally { applying = false; }
      current = Store.snapshot();
      pendingId = null;
      emit();
      return true;
    },

    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    isApplying: () => applying,
    onChange(fn) { listeners.push(fn); },
    clear() { past.length = 0; future.length = 0; current = Store.snapshot(); emit(); },
  };
})();

// ── Presets (G1) ────────────────────────────────────────────
const Presets = (() => {
  const LS_KEY = 'ditherpunk_presets';

  // Shipped starting points. Stored as partial settings — anything they
  // don't mention keeps its current value.
  const FACTORY = [
    { name: 'NEWSPRINT', factory: true, settings: {
      colorMode: 'mono', ditherType: 'halftone', halftoneCellSize: 6,
      pixelation: 0.5, contrast: 0.25, bias: 0.52, effects: [makeEffect('dither')] } },
    { name: 'GAME BOY', factory: true, settings: {
      colorMode: 'ramp', ditherType: 'bayer4', pixelation: 0.2, ditherThreshold: 0.6,
      customPalette: [{ r: 15, g: 56, b: 15 }, { r: 48, g: 98, b: 48 },
                      { r: 139, g: 172, b: 15 }, { r: 155, g: 188, b: 15 }],
      effects: [makeEffect('dither')] } },
    { name: 'CRT TERMINAL', factory: true, settings: {
      colorMode: 'ramp', ditherType: 'bluenoise', pixelation: 0.35, contrast: 0.3,
      customPalette: [{ r: 0, g: 8, b: 4 }, { r: 0, g: 255, b: 128 }],
      effects: [
        makeEffect('dither'),
        { id: 'glow',      enabled: true, params: { radius: 5, threshold: 0.4, strength: 1 } },
        { id: 'scanlines', enabled: true, params: { spacing: 3, strength: 0.5, mask: 0.35 } },
      ] } },
    { name: 'DATA CORRUPTION', factory: true, settings: {
      colorMode: 'fullcolor', ditherType: 'atkinson', pixelation: 0.4, serpentine: true,
      effects: [
        { id: 'chromatic', enabled: true, params: { amount: 5, angle: 12 } },
        makeEffect('dither'),
        { id: 'pixelsort', enabled: true, params: { lower: 0.3, upper: 0.95, maxRun: 96, vertical: false, reverse: false } },
        { id: 'databend',  enabled: true, params: { amount: 0.25, chunk: 32 } },
      ] } },
    { name: 'RISO DUOTONE', factory: true, settings: {
      colorMode: 'ramp', ditherType: 'mod-wave', modWave: 'sine', modFrequency: 10,
      modAmplitude: 0.6, modAngle: 45, pixelation: 0.45,
      customPalette: [{ r: 24, g: 24, b: 60 }, { r: 255, g: 72, b: 130 }],
      effects: [makeEffect('dither'), { id: 'noise', enabled: true, params: { amount: 0.12, mono: true } }] } },
  ];

  function readUser() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
  }

  function writeUser(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch { return false; }
  }

  return {
    all() { return FACTORY.concat(readUser()); },
    user: readUser,

    save(name) {
      name = String(name || '').trim();
      if (!name) return false;
      const list = readUser().filter(p => p.name !== name);
      list.push({ name, settings: Store.serialize().settings });
      writeUser(list);
      return true;
    },

    remove(name) {
      writeUser(readUser().filter(p => p.name !== name));
      return true;
    },

    apply(name) {
      const p = Presets.all().find(x => x.name === name);
      if (!p) return false;
      Store.transaction(() => Store.deserialize(p.settings));
      return true;
    },

    /** Preset → JSON text for sharing. */
    exportJson(name) {
      const p = Presets.all().find(x => x.name === name);
      if (!p) return null;
      return JSON.stringify({ ditherpunk: 1, name: p.name, settings: p.settings }, null, 2);
    },

    importJson(text) {
      try {
        const o = JSON.parse(text);
        if (!o || !o.settings) return false;
        const name = String(o.name || 'IMPORTED').trim();
        const list = readUser().filter(p => p.name !== name);
        list.push({ name, settings: o.settings });
        writeUser(list);
        return name;
      } catch { return false; }
    },
  };
})();

// ── Favorites — a user preference, not a setting ────────────
const Favorites = (() => {
  const LS_KEY = 'ditherpunk_favorites';
  const LS_LEGACY = 'ditherpunk_prefs';
  const set = new Set();

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify([...set])); } catch {}
  }

  return {
    load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) { JSON.parse(raw).forEach(n => set.add(n)); return; }
        const legacy = localStorage.getItem(LS_LEGACY);
        if (legacy) {
          const p = JSON.parse(legacy);
          if (Array.isArray(p.favorites)) { p.favorites.forEach(n => set.add(n)); save(); }
        }
      } catch {}
    },
    has: n => set.has(n),
    all: () => [...set],
    toggle(n) {
      if (set.has(n)) set.delete(n); else set.add(n);
      save();
      return set.has(n);
    },
  };
})();

if (typeof window !== 'undefined') {
  Object.assign(window, {
    Store, Favorites, Presets, History, Randomizer,
    PARAMS, EFFECTS, EFFECT_BY_ID, makeEffect,
    ERROR_DIFFUSION, MODULATION, isErrorDiffusion, isModulation,
  });
}
