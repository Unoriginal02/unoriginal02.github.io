/* ============================================================
   DITHERPUNK — Main App

   No control holds state. Every control is generated from the
   parameter registry in state.js and mirrors the Store; the Store
   is the only source of truth, which is what makes presets,
   randomize and undo/redo work uniformly across all of them.
   ============================================================ */

'use strict';

// ── Session ─────────────────────────────────────────────────
// Runtime-only. Never serialized, never part of a preset, never
// touched by undo/redo.
const session = {
  sourceImage: null,
  sourceWidth: 0,
  sourceHeight: 0,
  filmPalettes: {},
  currentView: 'processed',
  processing: false,
  worker: null,
  debounceTimer: null,
  pendingRun: false,
  jobId: 0,
  watchdog: null,
  extractCache: null,      // { token, count, palette }
  imageToken: 0,
};

// Live alias — Store.data is mutated in place, never reassigned.
const settings = Store.data;

const MAX_DIM = 1920;

// ── DOM refs ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'),
  imageInfo: $('imageInfo'), imageInfoText: $('imageInfoText'),
  colorControls: $('colorControls'), ditherControls: $('ditherControls'),
  adjustmentControls: $('adjustmentControls'), exportControls: $('exportControls'),
  rampSection: $('rampSection'), rampList: $('rampList'), rampPreview: $('rampPreview'),
  rampAddBtn: $('rampAddBtn'), rampFromPaletteBtn: $('rampFromPaletteBtn'),
  rampFromImageBtn: $('rampFromImageBtn'),
  effectStack: $('effectStack'), addEffectSelect: $('addEffectSelect'), addEffectBtn: $('addEffectBtn'),
  presetSelect: $('presetSelect'), presetSaveBtn: $('presetSaveBtn'),
  presetDeleteBtn: $('presetDeleteBtn'), presetExportBtn: $('presetExportBtn'),
  presetImportBtn: $('presetImportBtn'),
  filmSection: $('filmSection'), loadFolderBtn: $('loadFolderBtn'),
  filmLoadStatus: $('filmLoadStatus'), filmSelectBtn: $('filmSelectBtn'),
  filmSelectedName: $('filmSelectedName'), filmDropdown: $('filmDropdown'),
  filmDropdownEmpty: $('filmDropdownEmpty'), filmPrevBtn: $('filmPrevBtn'),
  filmNextBtn: $('filmNextBtn'), filmFavBtn: $('filmFavBtn'),
  paletteStripWrap: $('paletteStripWrap'), paletteStrip: $('paletteStrip'),
  paletteStripLabel: $('paletteStripLabel'),
  downloadBtn: $('downloadBtn'), resetBtn: $('resetBtn'),
  resetAllBtn: $('resetAllBtn'), bypassControl: $('bypassControl'),
  undoBtn: $('undoBtn'), redoBtn: $('redoBtn'), randomizeBtn: $('randomizeBtn'),
  canvasPlaceholder: $('canvasPlaceholder'),
  viewProcessedWrap: $('viewProcessedWrap'), viewOriginalWrap: $('viewOriginalWrap'),
  viewSplitWrap: $('viewSplitWrap'),
  outputCanvas: $('outputCanvas'), originalCanvas: $('originalCanvas'),
  splitOriginalCanvas: $('splitOriginalCanvas'), splitOutputCanvas: $('splitOutputCanvas'),
  canvasFrame: $('canvasFrame'), processingIndicator: $('processingIndicator'),
  viewProcessed: $('viewProcessed'), viewOriginal: $('viewOriginal'), viewSplit: $('viewSplit'),
  previewMeta: $('previewMeta'), statusDot: $('statusDot'), statusText: $('statusText'),
  tooltipPopup: $('tooltipPopup'),
  modalOverlay: $('modalOverlay'), modalTitle: $('modalTitle'), modalInput: $('modalInput'),
  modalTextarea: $('modalTextarea'), modalOk: $('modalOk'), modalCancel: $('modalCancel'),
  toast: $('toast'),
};

/* ============================================================
   CONTROL GENERATION
   ============================================================ */

const bindings = [];             // { id, sync() }
const visibilityTargets = [];    // { id, el }

function formatValue(spec, v) {
  if (v === null || v === undefined) return '—';
  if (spec.format) return spec.format(v);
  if (spec.decimals !== undefined) return Number(v).toFixed(spec.decimals);
  return String(v);
}

function updateSliderFill(slider) {
  const min = parseFloat(slider.min), max = parseFloat(slider.max);
  const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty('--pct', pct + '%');
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function tipSpan(text) {
  const s = el('span', 'info-tip', '?');
  s.dataset.tip = text;
  attachTooltip(s);
  return s;
}

/**
 * Slider row. `read` returns the current value, `write` commits one.
 * Used for both registry params and per-effect params.
 */
function makeSlider(spec, read, write, boundsFn) {
  const row = el('div', 'slider-row');
  const head = el('div', 'slider-header');
  const label = el('label', 'slider-label', spec.label);
  if (spec.tip) label.appendChild(tipSpan(spec.tip));
  const val = el('span', 'slider-value');
  head.append(label, val);

  const input = el('input', 'custom-range');
  input.type = 'range';
  input.step = spec.step !== undefined ? spec.step : 1;
  input.min = spec.min; input.max = spec.max;

  // Commit on release, not on every movement.
  //
  // Dragging a slider used to fire a render per step: the queue lagged behind
  // the handle and intermediate values flashed past. The readout still tracks
  // the handle live so there's immediate feedback; only the Store write — and
  // therefore the render — waits for mouse-up. It also makes each drag a
  // single undo step.
  let dragging = false;

  input.addEventListener('input', () => {
    dragging = true;
    row.classList.add('slider-dragging');
    val.textContent = formatValue(spec, parseFloat(input.value));
    updateSliderFill(input);
  });

  const commit = () => {
    if (!dragging) return;
    dragging = false;
    row.classList.remove('slider-dragging');
    write(parseFloat(input.value));
  };

  // `change` covers mouse-up, touch-end and keyboard commits.
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);

  row.append(head, input);

  return {
    el: row,
    sync() {
      // Never yank the handle out from under a drag in progress.
      if (dragging) return;
      const v = read();
      const b = boundsFn ? boundsFn() : { min: spec.min, max: spec.max };
      if (b.min !== undefined) input.min = b.min;
      if (b.max !== undefined) input.max = b.max;
      if (parseFloat(input.value) !== v) input.value = v;
      val.textContent = formatValue(spec, v);
      updateSliderFill(input);
    },
  };
}

function makeSelect(spec, read, write) {
  const row = el('div', 'ctrl-row');
  if (spec.label) {
    const label = el('div', 'ctrl-row-label', spec.label);
    if (spec.tip) label.appendChild(tipSpan(spec.tip));
    row.appendChild(label);
  }
  const wrap = el('div', 'custom-select-wrap');
  const select = el('select', 'custom-select');

  // Group by `section` when the options declare one.
  const sections = new Map();
  for (const o of spec.options) {
    const key = o.section || '';
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(o);
  }
  for (const [name, opts] of sections) {
    const parent = name ? document.createElement('optgroup') : select;
    if (name) { parent.label = `── ${name} ──`; select.appendChild(parent); }
    for (const o of opts) {
      const opt = el('option', null, o.label);
      opt.value = o.value;
      parent.appendChild(opt);
    }
  }

  select.addEventListener('change', () => write(select.value));
  wrap.appendChild(select);
  row.appendChild(wrap);

  return {
    el: row,
    sync() { const v = read(); if (select.value !== String(v)) select.value = v; },
  };
}

function makeToggle(spec, read, write) {
  const row = el('div', 'toggle-row');
  const label = el('span', 'toggle-label', spec.label);
  if (spec.tip) label.appendChild(tipSpan(spec.tip));
  const btn = el('button', 'toggle-btn');
  btn.type = 'button';
  btn.addEventListener('click', () => write(!read()));
  row.append(label, btn);
  return {
    el: row,
    sync() {
      const on = !!read();
      btn.classList.toggle('on', on);
      btn.textContent = on ? 'ON' : 'OFF';
    },
  };
}

function makeSegmented(spec, read, write) {
  const row = el('div', 'ctrl-row');
  if (spec.label) {
    const label = el('div', 'ctrl-row-label', spec.label);
    if (spec.tip) label.appendChild(tipSpan(spec.tip));
    row.appendChild(label);
  }
  const group = el('div', 'segmented-group segmented-wrap');
  const btns = spec.options.map(o => {
    const b = el('button', 'seg-btn', o.label);
    b.type = 'button';
    b.addEventListener('click', () => write(o.value));
    group.appendChild(b);
    return { b, value: o.value };
  });
  row.appendChild(group);
  return {
    el: row,
    sync() { const v = read(); btns.forEach(x => x.b.classList.toggle('active', x.value === v)); },
  };
}

/* ── Colour picker ──────────────────────────────────────────
   The native <input type="color"> dialog closes the moment you pick,
   which makes comparing shades against the live preview impossible.
   This one stays open, updates the image on every move, and closes
   only on DONE, click-outside or Escape.
   ------------------------------------------------------------ */

let activePicker = null;

function closeColorPicker() {
  if (!activePicker) return;
  activePicker.destroy();
  activePicker = null;
  // Rebuilds were suppressed while the picker was open; catch up now so the
  // list re-sorts by lightness and the preview strip refreshes.
  buildRampUI();
}

/**
 * @param anchor  element to position against
 * @param initial current colour, {r,g,b}
 * @param onChange fires continuously while picking
 */
function openColorPicker(anchor, initial, onChange) {
  closeColorPicker();

  const hsv = rgbToHsv(initial.r, initial.g, initial.b);
  let h = hsv.h, s = hsv.s, v = hsv.v;

  const pop = el('div', 'cp-popover');
  const sv = el('div', 'cp-sv');
  const svWhite = el('div', 'cp-sv-layer cp-sv-white');
  const svBlack = el('div', 'cp-sv-layer cp-sv-black');
  const svHandle = el('div', 'cp-sv-handle');
  sv.append(svWhite, svBlack, svHandle);

  const hue = el('div', 'cp-hue');
  const hueHandle = el('div', 'cp-hue-handle');
  hue.appendChild(hueHandle);

  const row = el('div', 'cp-row');
  const preview = el('div', 'cp-preview');
  const hex = el('input', 'cp-hex');
  hex.type = 'text';
  hex.spellcheck = false;
  hex.maxLength = 7;
  const done = el('button', 'btn-retro btn-sm cp-done', 'DONE');
  done.type = 'button';
  row.append(preview, hex, done);

  pop.append(sv, hue, row);
  document.body.appendChild(pop);

  // Position under the anchor, clamped into the viewport.
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8)) + 'px';
  pop.style.top = (r.bottom + ph + 8 > window.innerHeight
    ? Math.max(8, r.top - ph - 6)
    : r.bottom + 6) + 'px';

  let committing = false;
  function paint(emit) {
    const rgb = hsvToRgb(h, s, v);
    const hexStr = rgbToHex(rgb);
    sv.style.background = rgbToHex(hsvToRgb(h, 1, 1));
    svHandle.style.left = (s * 100) + '%';
    svHandle.style.top = ((1 - v) * 100) + '%';
    svHandle.style.background = hexStr;
    hueHandle.style.left = (h / 360 * 100) + '%';
    preview.style.background = hexStr;
    if (document.activeElement !== hex) hex.value = hexStr.toUpperCase();
    if (emit) onChange(rgb);
  }

  // Drag handling shared by both fields.
  function dragify(node, onPos) {
    const update = e => {
      const b = node.getBoundingClientRect();
      onPos(
        Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
        Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)));
      paint(true);
    };
    node.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!committing) { committing = true; History.beginInteraction(); }
      node.setPointerCapture(e.pointerId);
      update(e);
      const move = ev => update(ev);
      const up = ev => {
        node.releasePointerCapture(ev.pointerId);
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', up);
      };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
  }

  dragify(sv, (px, py) => { s = px; v = 1 - py; });
  dragify(hue, px => { h = px * 360; });

  hex.addEventListener('input', () => {
    const rgb = hexToRgb(hex.value);
    if (!rgb) return;
    const c = rgbToHsv(rgb.r, rgb.g, rgb.b);
    h = c.h; s = c.s; v = c.v;
    if (!committing) { committing = true; History.beginInteraction(); }
    paint(true);
  });
  hex.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') closeColorPicker();
  });

  done.addEventListener('click', e => { e.stopPropagation(); closeColorPicker(); });
  pop.addEventListener('pointerdown', e => e.stopPropagation());

  const onOutside = e => {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    closeColorPicker();
  };
  const onKey = e => { if (e.key === 'Escape') closeColorPicker(); };

  // Defer so the click that opened the picker doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);

  paint(false);

  activePicker = {
    destroy() {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onKey);
      pop.remove();
      if (committing) { History.endInteraction(); committing = false; }
      anchor.classList.remove('swatch-active');
    },
  };
  anchor.classList.add('swatch-active');
}

/** Swatch button that opens the picker instead of the native dialog. */
function swatchButton(getRgb, onChange, title) {
  const btn = el('button', 'color-swatch');
  btn.type = 'button';
  if (title) btn.title = title;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (activePicker && btn.classList.contains('swatch-active')) { closeColorPicker(); return; }
    openColorPicker(btn, getRgb(), onChange);
  });
  btn.refresh = () => { btn.style.background = rgbToHex(getRgb()); };
  btn.refresh();
  return btn;
}

function makeColor(spec, read, write) {
  const row = el('div', 'toggle-row');
  const label = el('span', 'toggle-label', spec.label);
  if (spec.tip) label.appendChild(tipSpan(spec.tip));
  const btn = swatchButton(
    () => hexToRgb(read()) || { r: 0, g: 0, b: 0 },
    rgb => write(rgbToHex(rgb)));
  row.append(label, btn);
  return { el: row, sync() { btn.refresh(); } };
}

function makeSeed(spec, read, write) {
  const row = el('div', 'toggle-row');
  const label = el('span', 'toggle-label', spec.label);
  if (spec.tip) label.appendChild(tipSpan(spec.tip));
  const box = el('div', 'seed-box');
  const value = el('span', 'seed-value');
  const btn = el('button', 'btn-retro btn-sm', '⚄ NEW');
  btn.type = 'button';
  btn.title = 'Roll a new seed';
  btn.addEventListener('click', () => write(randomSeed()));
  box.append(value, btn);
  row.append(label, box);
  return { el: row, sync() { value.textContent = read(); } };
}

/** Build the control for a registry param and register its binding. */
function buildParamControl(param) {
  const read  = () => settings[param.id];
  const write = v => Store.set(param.id, v);
  let ctrl;

  switch (param.type) {
    case 'float':
    case 'int':
      ctrl = makeSlider(param, read, write, () => Store.bounds(param.id));
      break;
    case 'enum':
      ctrl = param.options.length <= 3
        ? makeSegmented(param, read, write)
        : makeSelect(param, read, write);
      break;
    case 'bool':  ctrl = makeToggle(param, read, write); break;
    case 'color': ctrl = makeColor(param, read, write); break;
    case 'seed':  ctrl = makeSeed(param, read, write); break;
    default: return null;
  }

  bindings.push({ id: param.id, sync: ctrl.sync });
  if (param.visibleWhen) visibilityTargets.push({ id: param.id, el: ctrl.el });
  return ctrl.el;
}

function buildGroup(container, ids) {
  container.innerHTML = '';
  for (const id of ids) {
    const p = Store.param(id);
    if (!p) continue;
    const node = buildParamControl(p);
    if (node) container.appendChild(node);
  }
}

function applyParamVisibility() {
  for (const { id, el: node } of visibilityTargets) {
    node.style.display = Store.isVisible(id) ? '' : 'none';
  }
}

function syncControls(changed) {
  for (const b of bindings) {
    if (!changed || changed.includes(b.id)) {
      try { b.sync(); } catch (err) { console.error('sync failed for', b.id, err); }
    }
  }
  applyParamVisibility();
}

/* ============================================================
   EFFECTS STACK UI (E1)
   ============================================================ */

function buildEffectStack() {
  const stack = settings.effects;
  els.effectStack.innerHTML = '';

  stack.forEach((item, index) => {
    const def = EFFECT_BY_ID[item.id];
    if (!def) return;

    const card = el('div', 'effect-card' + (item.enabled ? '' : ' disabled') +
                              (def.fixed ? ' effect-fixed' : ''));

    const head = el('div', 'effect-head');
    const grip = el('span', 'effect-index', String(index + 1));
    const name = el('span', 'effect-name', def.label);
    if (def.note) name.appendChild(tipSpan(def.note));

    const btns = el('div', 'effect-btns');
    const mkBtn = (txt, title, fn, disabled) => {
      const b = el('button', 'effect-btn', txt);
      b.type = 'button'; b.title = title; b.disabled = !!disabled;
      b.addEventListener('click', e => { e.stopPropagation(); fn(); });
      return b;
    };
    btns.append(
      mkBtn('▲', 'Move up', () => Store.moveEffect(index, -1), index === 0),
      mkBtn('▼', 'Move down', () => Store.moveEffect(index, 1), index === stack.length - 1),
      mkBtn(item.enabled ? '◉' : '○', item.enabled ? 'Disable' : 'Enable',
            () => Store.toggleEffect(index)),
    );
    if (!def.fixed) {
      btns.appendChild(mkBtn('✕', 'Remove', () => Store.removeEffect(index)));
    }

    head.append(grip, name, btns);
    card.appendChild(head);

    if (def.params.length) {
      const body = el('div', 'effect-body');
      for (const spec of def.params) {
        const read  = () => settings.effects[index].params[spec.id];
        const write = v => Store.setEffectParam(index, spec.id, v);
        let ctrl;
        if (spec.type === 'bool') ctrl = makeToggle(spec, read, write);
        else if (spec.type === 'enum') ctrl = makeSelect(spec, read, write);
        else ctrl = makeSlider(spec, read, write);
        ctrl.sync();
        // Per-effect conditional params, e.g. INDEX DRIFT only matters while
        // PALETTE SAFE is on. The card rebuilds on every stack change, so
        // this re-evaluates itself.
        if (spec.visibleWhen && !spec.visibleWhen(item.params)) {
          ctrl.el.style.display = 'none';
        }
        body.appendChild(ctrl.el);
      }
      card.appendChild(body);
    }

    els.effectStack.appendChild(card);
  });
}

function initAddEffect() {
  els.addEffectSelect.innerHTML = '';
  for (const def of EFFECTS) {
    if (def.fixed) continue;
    const o = el('option', null, def.label);
    o.value = def.id;
    els.addEffectSelect.appendChild(o);
  }
  els.addEffectBtn.addEventListener('click', () => {
    Store.addEffect(els.addEffectSelect.value);
    toast('Effect added');
  });
}

/* ============================================================
   RAMP PALETTE BUILDER (D4 / D9)
   ============================================================ */

function buildRampUI() {
  const pal = settings.customPalette;
  els.rampList.innerHTML = '';

  // Display order is the processing order: sorted dark → light by L*.
  const sorted = sortByLightness(pal);

  sorted.forEach(c => {
    const originalIndex = pal.findIndex(p => p.r === c.r && p.g === c.g && p.b === c.b);
    const row = el('div', 'ramp-row');

    const hex = el('span', 'ramp-hex', rgbToHex(c).toUpperCase());
    const lum = el('span', 'ramp-lum', 'L* ' + Math.round(lightness(c.r, c.g, c.b)));

    // Reads live from the store so the picker keeps working even though
    // rebuilds re-sort the list underneath it.
    const input = swatchButton(
      () => settings.customPalette[originalIndex] || c,
      rgb => {
        Store.setPaletteColor(originalIndex, rgb);
        // Update this row in place — a full rebuild would tear out the
        // popover's anchor mid-drag.
        input.style.background = rgbToHex(rgb);
        hex.textContent = rgbToHex(rgb).toUpperCase();
        lum.textContent = 'L* ' + Math.round(lightness(rgb.r, rgb.g, rgb.b));
      },
      'Click to edit — the picker stays open');

    const del = el('button', 'effect-btn', '✕');
    del.type = 'button';
    del.title = 'Remove color';
    del.disabled = pal.length <= 1;
    del.addEventListener('click', () => Store.removePaletteColor(originalIndex));

    row.append(input, hex, lum, del);
    els.rampList.appendChild(row);
  });

  // Band preview strip
  els.rampPreview.innerHTML = '';
  sorted.forEach(c => {
    const sw = el('div', 'ramp-swatch');
    sw.style.background = rgbToHex(c);
    els.rampPreview.appendChild(sw);
  });
  // Swatches are always shown dark → light; that ordering only *drives*
  // the output in band mode, so say which one is in effect.
  const mode = settings.customMatch === 'bands'
    ? 'LUMINANCE BANDS · DARK → LIGHT'
    : 'NEAREST COLOR MATCH';
  els.rampPreview.appendChild(el('div', 'palette-strip-label',
    `${pal.length} COLOR${pal.length !== 1 ? 'S' : ''} · ${mode}`));
}

function initRampButtons() {
  els.rampAddBtn.addEventListener('click', () => {
    Store.addPaletteColor({ r: 128, g: 128, b: 128 });
  });

  els.rampFromPaletteBtn.addEventListener('click', () => {
    const pal = session.filmPalettes[settings.selectedFilm];
    if (!pal || !pal.length) { toast('No film palette selected'); return; }
    Store.set('customPalette', pal.slice(0, 64));
    toast(`Ramp filled from ${formatFilmName(settings.selectedFilm)}`);
  });

  els.rampFromImageBtn.addEventListener('click', () => {
    if (!session.sourceImage) { toast('Load an image first'); return; }
    const pal = medianCut(session.sourceImage.data, settings.extractCount);
    Store.set('customPalette', pal);
    toast(`Ramp filled with ${pal.length} extracted colors`);
  });
}

/* ============================================================
   PALETTE RESOLUTION (D2 / D3)
   ============================================================ */

function extractedPalette() {
  if (!session.sourceImage) return [];
  const count = settings.extractCount;
  const c = session.extractCache;
  if (c && c.token === session.imageToken && c.count === count) return c.palette;
  const palette = medianCut(session.sourceImage.data, count);
  session.extractCache = { token: session.imageToken, count, palette };
  return palette;
}

/** The palette the worker should quantize against, for the current mode. */
function activePalette() {
  switch (settings.colorMode) {
    case 'ramp':
      return sortByLightness(settings.customPalette);
    case 'film':
      return session.filmPalettes[settings.selectedFilm] || [];
    case 'filmcolor':
      return settings.paletteSource === 'extracted'
        ? extractedPalette()
        : (session.filmPalettes[settings.selectedFilm] || []);
    default:
      return [];
  }
}

/* ============================================================
   PIPELINE
   ============================================================ */

function initWorker() {
  session.worker = new Worker('worker.js');
  session.worker.onmessage = onWorkerResult;
  session.worker.onerror = err => {
    console.error('Worker error:', err);
    setProcessingState(false);
    toast('Processing failed — see console');
  };
}

function onWorkerResult(e) {
  const { jobId, result, width, height, error } = e.data;

  // Stale result from a superseded job — drop it.
  if (jobId !== session.jobId) return;

  clearTimeout(session.watchdog);
  setProcessingState(false);

  if (error) {
    console.error('Worker pipeline error:', error);
    toast('Pipeline error: ' + error);
  } else {
    renderOutput(new ImageData(new Uint8ClampedArray(result), width, height));
  }

  if (session.pendingRun) { session.pendingRun = false; runPipeline(); }
}

function onWorkerStalled(jobId) {
  if (jobId !== session.jobId || !session.processing) return;
  console.warn('Render job', jobId, 'never returned — restarting worker');
  try { session.worker.terminate(); } catch {}
  initWorker();
  session.pendingRun = false;
  setProcessingState(false);
  toast('Render stalled — worker restarted');
}

function setProcessingState(active) {
  session.processing = active;
  els.statusDot.classList.toggle('processing', active);
  // Bypass has to be loud in the header, or a passthrough render is
  // indistinguishable from a broken one.
  els.statusDot.classList.toggle('bypassed', !active && settings.bypass);
  els.statusText.textContent = active ? 'PROCESSING'
                             : settings.bypass ? 'BYPASSED' : 'READY';
  els.canvasFrame.classList.toggle('processing-active', active);
  els.processingIndicator.classList.toggle('visible', active);
}

function triggerProcessing() {
  if (!session.sourceImage) return;
  clearTimeout(session.debounceTimer);
  session.debounceTimer = setTimeout(() => {
    session.debounceTimer = null;
    runPipeline();
  }, 90);
}

function runPipeline() {
  if (!session.sourceImage) return;
  // Renders are single-flight. Park the request instead of dropping it,
  // or a change made mid-render never reaches the canvas.
  if (session.processing) { session.pendingRun = true; return; }
  setProcessingState(true);

  const srcCopy = new Uint8ClampedArray(session.sourceImage.data);
  session.jobId++;

  // If a job never answers — a wedged worker, or a stale cached script
  // replying in an older format — recover instead of freezing forever.
  clearTimeout(session.watchdog);
  session.watchdog = setTimeout(() => onWorkerStalled(session.jobId), 30000);

  session.worker.postMessage({
    jobId: session.jobId,
    imageData: srcCopy,
    width: session.sourceWidth,
    height: session.sourceHeight,
    settings: Store.forWorker(),
    palette: activePalette(),
    // Which effects must run after upscaling — derived from the registry so
    // the worker never keeps its own copy of that list.
    outputSpaceIds: EFFECTS.filter(e => e.outputSpace).map(e => e.id),
  }, [srcCopy.buffer]);
}

function renderOutput(imageData) {
  const { width, height } = imageData;
  for (const canvas of [els.outputCanvas, els.splitOutputCanvas]) {
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }
  els.downloadBtn.disabled = false;
  updatePreviewMeta(width, height);
  applyZoom();
}

function updatePreviewMeta(w, h) {
  if (settings.bypass) {
    els.previewMeta.textContent = `${w}×${h}px · BYPASS — ORIGINAL IMAGE`;
    return;
  }
  const bits = [`${w}×${h}px`,
                settings.colorMode === 'ramp' ? 'CUSTOM' : settings.colorMode.toUpperCase(),
                settings.ditherType];
  if (settings.colorMode === 'ramp') {
    bits.push(`${settings.customPalette.length} COLORS`,
              settings.customMatch === 'bands' ? 'BANDS' : 'NEAREST');
  }
  else if (settings.colorMode === 'filmcolor' && settings.paletteSource === 'extracted')
    bits.push(`${settings.extractCount} EXTRACTED`);
  else if (settings.selectedFilm) bits.push(formatFilmName(settings.selectedFilm));
  const fx = settings.effects.filter(e => e.enabled && e.id !== 'dither').length;
  if (fx) bits.push(`${fx} FX`);
  els.previewMeta.textContent = bits.join(' · ');
}

/* ============================================================
   IMAGE LOADING
   ============================================================ */

function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_DIM || h > MAX_DIM) {
      if (w >= h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
      else        { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    session.sourceImage = ctx.getImageData(0, 0, w, h);
    session.sourceWidth = w;
    session.sourceHeight = h;
    session.imageToken++;
    session.extractCache = null;
    URL.revokeObjectURL(url);

    // Loading an image means you want to see it processed. Leaving bypass on
    // here reads as "the app is broken".
    if (settings.bypass) {
      Store.set('bypass', false);
      toast('Bypass turned off for the new image');
    }

    // Widen the pixelation range so a single pixel is reachable.
    Store.setBounds('pixelation', { min: 1 / Math.max(w, h) });
    syncControls(['pixelation']);

    drawOriginalCanvases(img, w, h);
    els.canvasPlaceholder.style.display = 'none';
    setView(session.currentView);
    els.imageInfo.style.display = 'block';
    els.imageInfoText.textContent = `${file.name} · ${w}×${h}`;

    triggerProcessing();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not load that image'); };
  img.src = url;
}

function drawOriginalCanvases(img, w, h) {
  for (const canvas of [els.originalCanvas, els.splitOriginalCanvas]) {
    canvas.width = w; canvas.height = h;
    canvas.style.width = ''; canvas.style.height = '';
    canvas.getContext('2d').drawImage(img, 0, 0);
  }
  applyZoom();
}

/* ============================================================
   EXPORT (F2 / F5)
   ============================================================ */

async function exportImage() {
  const src = els.outputCanvas;
  if (!src.width) return;

  const scale = parseInt(settings.exportScale, 10) || 1;
  const format = settings.exportFormat;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';

  const out = document.createElement('canvas');
  out.width = src.width * scale;
  out.height = src.height * scale;
  const ctx = out.getContext('2d');

  // JPG has no alpha — fill the matte first or transparent areas go black.
  if (format === 'jpeg') {
    ctx.fillStyle = settings.exportMatte;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  // Nearest-neighbour, or the upscale would blur the dither pattern away.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, out.width, out.height);

  const quality = format === 'png' ? undefined : settings.exportQuality;
  const blob = await new Promise(r => out.toBlob(r, mime, quality));
  if (!blob) { toast('Export failed'); return; }

  const ext = format === 'jpeg' ? 'jpg' : format;
  const palettePart = settings.colorMode === 'ramp' ? '-ramp'
    : settings.selectedFilm ? '-' + settings.selectedFilm.replace(/\.hex$/i, '') : '';
  const name = `ditherpunk${palettePart}-${Date.now()}.${ext}`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = name;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  toast(`Exported ${out.width}×${out.height} ${ext.toUpperCase()}`);
}

/* ============================================================
   PRESETS (G1)
   ============================================================ */

function rebuildPresetList(selected) {
  const all = Presets.all();
  els.presetSelect.innerHTML = '';
  els.presetSelect.appendChild(new Option('— SELECT PRESET —', ''));

  const factory = all.filter(p => p.factory);
  const user = all.filter(p => !p.factory);

  if (factory.length) {
    const g = document.createElement('optgroup');
    g.label = '── BUILT IN ──';
    factory.forEach(p => g.appendChild(new Option(p.name, p.name)));
    els.presetSelect.appendChild(g);
  }
  if (user.length) {
    const g = document.createElement('optgroup');
    g.label = '── SAVED ──';
    user.forEach(p => g.appendChild(new Option(p.name, p.name)));
    els.presetSelect.appendChild(g);
  }
  if (selected) els.presetSelect.value = selected;
}

function initPresets() {
  rebuildPresetList();

  els.presetSelect.addEventListener('change', () => {
    const name = els.presetSelect.value;
    if (!name) return;
    Presets.apply(name);
    toast(`Loaded "${name}"`);
  });

  els.presetSaveBtn.addEventListener('click', async () => {
    const name = await prompt2('SAVE PRESET', 'Preset name');
    if (!name) return;
    Presets.save(name);
    rebuildPresetList(name);
    toast(`Saved "${name}"`);
  });

  els.presetDeleteBtn.addEventListener('click', () => {
    const name = els.presetSelect.value;
    if (!name) { toast('Select a preset first'); return; }
    if (Presets.all().find(p => p.name === name && p.factory)) {
      toast('Built-in presets cannot be deleted');
      return;
    }
    Presets.remove(name);
    rebuildPresetList();
    toast(`Deleted "${name}"`);
  });

  els.presetExportBtn.addEventListener('click', async () => {
    const name = els.presetSelect.value;
    const json = name ? Presets.exportJson(name)
                      : JSON.stringify({ ditherpunk: 1, name: 'CURRENT', settings: Store.serialize().settings }, null, 2);
    await showText('PRESET JSON', json);
  });

  els.presetImportBtn.addEventListener('click', async () => {
    const text = await promptText('IMPORT PRESET JSON', '');
    if (!text) return;
    const name = Presets.importJson(text);
    if (!name) { toast('That JSON is not a valid preset'); return; }
    rebuildPresetList(name);
    Presets.apply(name);
    toast(`Imported "${name}"`);
  });
}

/* ============================================================
   FILM PALETTES
   ============================================================ */

function parseHexFile(text) {
  return text.split('\n')
    .map(l => l.trim().replace(/^0x/i, ''))
    .filter(l => /^[0-9a-fA-F]{6}$/.test(l))
    .map(hex => ({
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }));
}

function formatFilmName(filename) {
  return String(filename || '')
    .replace(/\.hex$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function loadFilmSimulationsFromManifest() {
  try {
    const res = await fetch('Film Simulations/manifest.json');
    if (!res.ok) return false;
    const files = await res.json();
    await Promise.all(files.map(async fname => {
      try {
        const r = await fetch(`Film Simulations/${fname}`);
        if (!r.ok) return;
        const palette = parseHexFile(await r.text());
        if (palette.length) session.filmPalettes[fname] = palette;
      } catch {}
    }));
    return Object.keys(session.filmPalettes).length > 0;
  } catch { return false; }
}

async function loadFilmSimulationsFromFolder() {
  if (!window.showDirectoryPicker) {
    toast('Folder picker needs Chrome or Edge');
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker();
    session.filmPalettes = {};
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.hex')) {
        const palette = parseHexFile(await (await handle.getFile()).text());
        if (palette.length) session.filmPalettes[name] = palette;
      }
    }
    rebuildFilmDropdown();
    syncFilmUI();
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

function rebuildFilmDropdown() {
  const names = Object.keys(session.filmPalettes).sort();
  const favs = names.filter(n => Favorites.has(n));
  const rest = names.filter(n => !Favorites.has(n));

  els.filmDropdown.innerHTML = '';
  if (!names.length) {
    els.filmDropdown.appendChild(els.filmDropdownEmpty);
    els.filmLoadStatus.textContent = 'NO PALETTES LOADED';
    return;
  }
  if (favs.length) {
    els.filmDropdown.appendChild(el('div', 'film-dropdown-section-label', '★ FAVORITES'));
    favs.forEach(n => els.filmDropdown.appendChild(buildFilmOption(n)));
  }
  if (rest.length) {
    els.filmDropdown.appendChild(
      el('div', 'film-dropdown-section-label', favs.length ? 'ALL PALETTES' : 'PALETTES'));
    rest.forEach(n => els.filmDropdown.appendChild(buildFilmOption(n)));
  }
  els.filmLoadStatus.textContent = `${names.length} PALETTE${names.length !== 1 ? 'S' : ''}`;
}

function buildFilmOption(name) {
  const palette = session.filmPalettes[name];
  const div = el('div', 'film-option' + (settings.selectedFilm === name ? ' selected' : ''));
  div.setAttribute('role', 'option');
  div.dataset.name = name;

  const swatchWrap = el('div', 'film-option-swatch');
  palette.slice(0, 10).forEach(c => {
    const s = el('div', 'film-swatch-color');
    s.style.background = `rgb(${c.r},${c.g},${c.b})`;
    swatchWrap.appendChild(s);
  });

  const nameEl = el('div', 'film-option-name',
    (Favorites.has(name) ? '★ ' : '') + formatFilmName(name));

  const star = el('span', 'film-star' + (Favorites.has(name) ? ' starred' : ''), '★');
  star.title = 'Toggle favorite';
  star.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(name); });

  div.append(swatchWrap, nameEl, star);
  div.addEventListener('click', () => selectFilm(name));
  return div;
}

function selectFilm(name) {
  Store.set('selectedFilm', name);
  closeFilmDropdown();
}

function toggleFavorite(name) {
  Favorites.toggle(name);
  updateFavBtn();
  rebuildFilmDropdown();
}

function updatePaletteStrip() {
  const palette = session.filmPalettes[settings.selectedFilm];
  if (!palette) { els.paletteStripWrap.style.display = 'none'; return; }
  els.paletteStrip.innerHTML = '';
  palette.forEach(c => {
    const s = el('div', 'palette-strip-swatch');
    s.style.background = `rgb(${c.r},${c.g},${c.b})`;
    els.paletteStrip.appendChild(s);
  });
  els.paletteStripLabel.textContent =
    `${palette.length} COLORS · ${formatFilmName(settings.selectedFilm)}`;
  els.paletteStripWrap.style.display = 'block';
}

function getSortedPaletteNames() {
  const names = Object.keys(session.filmPalettes).sort();
  return [...names.filter(n => Favorites.has(n)), ...names.filter(n => !Favorites.has(n))];
}

function navigateFilm(dir) {
  const names = getSortedPaletteNames();
  if (!names.length) return;
  const idx = settings.selectedFilm ? names.indexOf(settings.selectedFilm) : -1;
  selectFilm(names[(idx + dir + names.length) % names.length]);
}

function updateFavBtn() {
  const starred = settings.selectedFilm && Favorites.has(settings.selectedFilm);
  els.filmFavBtn.classList.toggle('starred', !!starred);
  els.filmFavBtn.title = starred ? 'Remove from favorites' : 'Add to favorites';
}

function syncFilmUI() {
  els.filmSelectedName.textContent = settings.selectedFilm
    ? formatFilmName(settings.selectedFilm) : '— SELECT PALETTE —';
  updatePaletteStrip();
  updateFavBtn();
}

function updateFilmSectionState() {
  const active = settings.colorMode === 'film' ||
                 (settings.colorMode === 'filmcolor' && settings.paletteSource === 'film');
  els.filmSection.classList.toggle('disabled', !active);
}

function openFilmDropdown() {
  els.filmSelectBtn.classList.add('open');
  els.filmSelectBtn.setAttribute('aria-expanded', 'true');
  els.filmDropdown.classList.add('open');
}

function closeFilmDropdown() {
  els.filmSelectBtn.classList.remove('open');
  els.filmSelectBtn.setAttribute('aria-expanded', 'false');
  els.filmDropdown.classList.remove('open');
}

/* ============================================================
   VIEW / ZOOM
   ============================================================ */

function setView(view) {
  session.currentView = view;
  els.viewProcessedWrap.style.display = 'none';
  els.viewOriginalWrap.style.display = 'none';
  els.viewSplitWrap.style.display = 'none';
  [els.viewProcessed, els.viewOriginal, els.viewSplit].forEach(b => b.classList.remove('active'));

  if (view === 'processed') {
    els.viewProcessedWrap.style.display = 'flex';
    els.viewProcessed.classList.add('active');
  } else if (view === 'original') {
    els.viewOriginalWrap.style.display = 'flex';
    els.viewOriginal.classList.add('active');
  } else {
    els.viewSplitWrap.style.display = 'flex';
    els.viewSplit.classList.add('active');
  }
}

const zoomState = { level: null };
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function applyZoom() {
  const canvases = [els.outputCanvas, els.originalCanvas,
                    els.splitOriginalCanvas, els.splitOutputCanvas];
  const level = $('zoomLevel'), fit = $('zoomFit'), one = $('zoom100');

  if (zoomState.level === null) {
    canvases.forEach(c => {
      c.style.width = ''; c.style.height = '';
      c.style.maxWidth = '100%'; c.style.maxHeight = 'calc(100vh - 120px)';
    });
    level.textContent = 'FIT';
    fit.classList.add('active'); one.classList.remove('active');
  } else {
    canvases.forEach(c => {
      if (!c.width) return;
      c.style.maxWidth = 'none'; c.style.maxHeight = 'none';
      c.style.width = Math.round(c.width * zoomState.level) + 'px';
      c.style.height = Math.round(c.height * zoomState.level) + 'px';
    });
    level.textContent = Math.round(zoomState.level * 100) + '%';
    fit.classList.remove('active');
    one.classList.toggle('active', zoomState.level === 1);
  }
}

function setZoom(level) { zoomState.level = level; applyZoom(); }

function zoomStep(dir) {
  if (dir > 0) {
    if (zoomState.level === null) { setZoom(1); return; }
    const next = ZOOM_STEPS.find(s => s > zoomState.level);
    if (next) setZoom(next);
  } else {
    if (zoomState.level === null) return;
    const prev = [...ZOOM_STEPS].reverse().find(s => s < zoomState.level);
    setZoom(prev !== undefined ? prev : null);
  }
}

function initZoom() {
  $('zoomFit').addEventListener('click', () => setZoom(null));
  $('zoom100').addEventListener('click', () => setZoom(1));
  $('zoomIn').addEventListener('click', () => zoomStep(1));
  $('zoomOut').addEventListener('click', () => zoomStep(-1));
  $('canvasContainer').addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomStep(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

/* ============================================================
   TOOLTIP / TOAST / MODAL
   ============================================================ */

function attachTooltip(tip) {
  tip.addEventListener('mouseenter', e => {
    if (!tip.dataset.tip) return;
    els.tooltipPopup.textContent = tip.dataset.tip;
    els.tooltipPopup.classList.add('visible');
    positionTooltip(e);
  });
  tip.addEventListener('mousemove', positionTooltip);
  tip.addEventListener('mouseleave', () => els.tooltipPopup.classList.remove('visible'));
}

function positionTooltip(e) {
  const tw = els.tooltipPopup.offsetWidth, th = els.tooltipPopup.offsetHeight;
  els.tooltipPopup.style.left = Math.min(e.clientX + 12, window.innerWidth - tw - 8) + 'px';
  els.tooltipPopup.style.top  = Math.min(e.clientY + 12, window.innerHeight - th - 8) + 'px';
}

function initTooltips() {
  document.querySelectorAll('.info-tip').forEach(attachTooltip);
}

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 2200);
}

// Promise-based modal — window.prompt is blocked in some embedded contexts
// and blocks the worker message pump.
function openModal({ title, value, multiline, readonly }) {
  return new Promise(resolve => {
    els.modalTitle.textContent = title;
    els.modalInput.style.display = multiline ? 'none' : '';
    els.modalTextarea.style.display = multiline ? '' : 'none';
    const field = multiline ? els.modalTextarea : els.modalInput;
    field.value = value || '';
    field.readOnly = !!readonly;
    els.modalOverlay.style.display = 'flex';
    setTimeout(() => { field.focus(); if (readonly) field.select(); }, 30);

    const done = result => {
      els.modalOverlay.style.display = 'none';
      els.modalOk.removeEventListener('click', ok);
      els.modalCancel.removeEventListener('click', cancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const ok = () => done(field.value);
    const cancel = () => done(null);
    const onKey = e => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && !multiline) ok();
    };
    els.modalOk.addEventListener('click', ok);
    els.modalCancel.addEventListener('click', cancel);
    document.addEventListener('keydown', onKey);
  });
}

const prompt2   = (title, placeholder) => openModal({ title, value: '' });
const promptText = title => openModal({ title, value: '', multiline: true });
const showText   = (title, text) => openModal({ title, value: text, multiline: true, readonly: true });

/* ============================================================
   SETTINGS SUBSCRIPTION
   ============================================================ */

function shouldRerender(id) {
  const p = Store.param(id);
  if (!p) return false;
  const a = p.affectsRender;
  if (a === undefined) return true;
  if (typeof a === 'function') return a(settings);
  return a;
}

function onSettingsChanged(changed) {
  if (!History.isApplying()) History.record(changed);

  syncControls(changed);

  // Structural UI that isn't a simple control binding.
  if (changed.includes('effects')) buildEffectStack();
  // Never rebuild the swatch list while the picker is open — it would
  // destroy the element the popover is anchored to, mid-drag.
  if ((changed.includes('customPalette') || changed.includes('customMatch')) && !activePicker) {
    buildRampUI();
  }
  if (changed.includes('colorMode')) {
    els.rampSection.style.display = settings.colorMode === 'ramp' ? '' : 'none';
  }
  if (changed.includes('colorMode') || changed.includes('paletteSource')) {
    updateFilmSectionState();
  }
  if (changed.includes('selectedFilm')) syncFilmUI();
  if (changed.includes('bypass')) setProcessingState(session.processing);

  updateHistoryButtons();
  Store.save();

  // Touching any processing control while bypassed means the user wants to
  // see the effect of it. Staying bypassed would make the app look dead.
  // Skipped when bypass itself is part of this change, so RESET ALL — which
  // sets defaults and bypass together — isn't immediately undone.
  if (settings.bypass && !changed.includes('bypass') && changed.some(shouldRerender)) {
    Store.set('bypass', false);
    toast('Processing resumed');
    return;
  }

  if (changed.some(shouldRerender)) triggerProcessing();
}

function updateHistoryButtons() {
  els.undoBtn.disabled = !History.canUndo();
  els.redoBtn.disabled = !History.canRedo();
}

/* ============================================================
   EVENTS
   ============================================================ */

function initEvents() {
  els.dropZone.addEventListener('click', () => els.fileInput.click());
  els.dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });

  els.dropZone.addEventListener('dragover', e => {
    e.preventDefault(); els.dropZone.classList.add('drag-over');
  });
  els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag-over'));
  els.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    els.dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
  });
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) loadImage(f);
  });

  // Colour mode segmented buttons (static markup)
  const modeBtns = [...document.querySelectorAll('.seg-btn[data-mode]')];
  modeBtns.forEach(b => b.addEventListener('click', () => Store.set('colorMode', b.dataset.mode)));
  bindings.push({
    id: 'colorMode',
    sync() { modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === settings.colorMode)); },
  });

  els.filmSelectBtn.addEventListener('click', () => {
    els.filmDropdown.classList.contains('open') ? closeFilmDropdown() : openFilmDropdown();
  });
  els.filmSelectBtn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.filmSelectBtn.click(); }
  });
  document.addEventListener('click', e => {
    if (!els.filmDropdown.contains(e.target) && !els.filmSelectBtn.contains(e.target)) {
      closeFilmDropdown();
    }
  });

  els.loadFolderBtn.addEventListener('click', loadFilmSimulationsFromFolder);
  els.filmPrevBtn.addEventListener('click', () => navigateFilm(-1));
  els.filmNextBtn.addEventListener('click', () => navigateFilm(1));
  els.filmFavBtn.addEventListener('click', () => {
    if (settings.selectedFilm) toggleFavorite(settings.selectedFilm);
  });

  [els.viewProcessed, els.viewOriginal, els.viewSplit].forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  els.downloadBtn.addEventListener('click', exportImage);
  els.resetBtn.addEventListener('click', () => { Store.reset(); toast('Reset to defaults'); });

  // Full wipe: every param back to its default (including the ones RESET
  // deliberately keeps), an empty effect stack, and the pipeline bypassed
  // so the canvas shows the uploaded image exactly as it is.
  els.resetAllBtn.addEventListener('click', () => {
    closeColorPicker();
    Store.transaction(() => {
      Store.patch(Store.defaults());
      Store.set('effects', [makeEffect('dither')]);
      Store.set('bypass', true);
    });
    zoomState.level = null;
    applyZoom();
    toast('Everything reset — showing the image as is');
  });

  els.undoBtn.addEventListener('click', () => { History.undo(); toast('Undo'); });
  els.redoBtn.addEventListener('click', () => { History.redo(); toast('Redo'); });
  els.randomizeBtn.addEventListener('click', () => {
    Randomizer.randomize({ palettes: Object.keys(session.filmPalettes) });
    toast('Randomized');
  });

  History.onChange(updateHistoryButtons);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? History.redo() : History.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      History.redo();
    } else if (!mod && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      Randomizer.randomize({ palettes: Object.keys(session.filmPalettes) });
      toast('Randomized');
    } else if (!mod && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      exportImage();
    }
  });
}

/* ============================================================
   INIT
   ============================================================ */

async function init() {
  Store.load();
  Favorites.load();
  History.init();

  initWorker();
  initEvents();

  // Generate every registry-driven control.
  buildGroup(els.colorControls, ['paletteSource', 'extractCount', 'customMatch', 'rampDistribution']);
  buildGroup(els.ditherControls, ['ditherType', 'serpentine', 'modWave', 'modFrequency', 'modAmplitude', 'modAngle']);
  buildGroup(els.adjustmentControls,
    ['pixelation', 'brightness', 'contrast', 'blur', 'ditherThreshold', 'halftoneCellSize', 'bias', 'seed']);
  buildGroup(els.exportControls, ['exportFormat', 'exportQuality', 'exportScale', 'exportMatte']);
  buildGroup(els.bypassControl, ['bypass']);

  initAddEffect();
  initRampButtons();
  initPresets();
  initTooltips();
  initZoom();

  buildEffectStack();
  buildRampUI();
  els.rampSection.style.display = settings.colorMode === 'ramp' ? '' : 'none';
  updateFilmSectionState();
  syncControls();
  updateHistoryButtons();

  Store.subscribe(onSettingsChanged);

  const loaded = await loadFilmSimulationsFromManifest();
  if (loaded) {
    if (settings.selectedFilm && !session.filmPalettes[settings.selectedFilm]) {
      Store.set('selectedFilm', null);
    }
    rebuildFilmDropdown();
    syncFilmUI();
  } else {
    els.filmLoadStatus.textContent = 'USE LOAD FOLDER ↑';
  }
}

init();
