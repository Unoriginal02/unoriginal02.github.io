/* ============================================================
   DITHERPUNK — Main App
   ============================================================ */

'use strict';

// ── State ───────────────────────────────────────────────────
const state = {
  sourceImage: null,       // ImageData of original
  sourceWidth: 0,
  sourceHeight: 0,
  colorMode: 'fullcolor',
  ditherType: 'floyd-steinberg',
  pixelation: 0.25,
  bias: 0.50,
  ditherThreshold: 0.50,
  filmPalettes: {},        // name → [{r,g,b}]
  selectedFilm: null,
  favorites: new Set(),
  currentView: 'processed',
  processing: false,
  worker: null,
  debounceTimer: null,
};

const DEFAULTS = {
  colorMode: 'fullcolor',
  ditherType: 'floyd-steinberg',
  pixelation: 0.25,
  bias: 0.50,
  ditherThreshold: 0.50,
  halftoneCellSize: 8,
  selectedFilm: null,
};
const MAX_DIM = 1920;

// ── DOM refs ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  dropZone:          $('dropZone'),
  fileInput:         $('fileInput'),
  imageInfo:         $('imageInfo'),
  imageInfoText:     $('imageInfoText'),
  modeFullColor:     $('modeFullColor'),
  modeMono:          $('modeMono'),
  modeFilm:          $('modeFilm'),
  modeFilmColor:     $('modeFilmColor'),
  ditherSelect:      $('ditherSelect'),
  pixelationSlider:  $('pixelationSlider'),
  pixelationValue:   $('pixelationValue'),
  ditherThresholdSlider: $('ditherThresholdSlider'),
  ditherThresholdValue:  $('ditherThresholdValue'),
  halftoneCellRow:       $('halftoneCellRow'),
  halftoneCellSlider:    $('halftoneCellSlider'),
  halftoneCellValue:     $('halftoneCellValue'),
  biasSlider:        $('biasSlider'),
  biasValue:         $('biasValue'),
  filmSection:       $('filmSection'),
  loadFolderBtn:     $('loadFolderBtn'),
  filmLoadStatus:    $('filmLoadStatus'),
  filmSelectBtn:     $('filmSelectBtn'),
  filmSelectedName:  $('filmSelectedName'),
  filmDropdown:      $('filmDropdown'),
  filmDropdownEmpty: $('filmDropdownEmpty'),
  filmPrevBtn:       $('filmPrevBtn'),
  filmNextBtn:       $('filmNextBtn'),
  filmFavBtn:        $('filmFavBtn'),
  paletteStripWrap:  $('paletteStripWrap'),
  paletteStrip:      $('paletteStrip'),
  paletteStripLabel: $('paletteStripLabel'),
  downloadBtn:       $('downloadBtn'),
  resetBtn:          $('resetBtn'),
  canvasPlaceholder: $('canvasPlaceholder'),
  viewProcessedWrap: $('viewProcessedWrap'),
  viewOriginalWrap:  $('viewOriginalWrap'),
  viewSplitWrap:     $('viewSplitWrap'),
  outputCanvas:      $('outputCanvas'),
  originalCanvas:    $('originalCanvas'),
  splitOriginalCanvas: $('splitOriginalCanvas'),
  splitOutputCanvas: $('splitOutputCanvas'),
  canvasFrame:       $('canvasFrame'),
  processingIndicator: $('processingIndicator'),
  viewProcessed:     $('viewProcessed'),
  viewOriginal:      $('viewOriginal'),
  viewSplit:         $('viewSplit'),
  previewMeta:       $('previewMeta'),
  statusDot:         $('statusDot'),
  statusText:        $('statusText'),
  tooltipPopup:      $('tooltipPopup'),
};

// ── Worker setup ────────────────────────────────────────────
function initWorker() {
  state.worker = new Worker('worker.js');
  state.worker.onmessage = onWorkerResult;
  state.worker.onerror = err => {
    console.error('Worker error:', err);
    setProcessingState(false);
  };
}

function onWorkerResult(e) {
  const { result, width, height } = e.data;
  const imageData = new ImageData(new Uint8ClampedArray(result), width, height);
  renderOutput(imageData);
  setProcessingState(false);
}

// ── Processing state UI ─────────────────────────────────────
function setProcessingState(active) {
  state.processing = active;
  els.statusDot.classList.toggle('processing', active);
  els.statusText.textContent = active ? 'PROCESSING' : 'READY';
  els.canvasFrame.classList.toggle('processing-active', active);
  els.processingIndicator.classList.toggle('visible', active);
}

// ── Trigger pipeline ────────────────────────────────────────
function triggerProcessing() {
  if (!state.sourceImage) return;
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(runPipeline, 90);
}

function runPipeline() {
  if (!state.sourceImage || state.processing) return;
  setProcessingState(true);

  const filmPalette = (state.colorMode !== 'fullcolor' && state.colorMode !== 'mono' && state.selectedFilm)
    ? state.filmPalettes[state.selectedFilm] || []
    : [];

  // Transfer imageData buffer to worker
  const srcCopy = new Uint8ClampedArray(state.sourceImage.data);

  state.worker.postMessage({
    imageData: srcCopy,
    width: state.sourceWidth,
    height: state.sourceHeight,
    settings: {
      pixelation: state.pixelation,
      bias: state.bias,
      colorMode: state.colorMode,
      ditherType: state.ditherType,
      ditherThreshold: state.ditherThreshold,
      halftoneCellSize: state.halftoneCellSize,
    },
    filmPalette,
  }, [srcCopy.buffer]);
}

// ── Render output ────────────────────────────────────────────
function renderOutput(imageData) {
  const { width, height } = imageData;

  // Set canvas pixel dimensions — CSS handles display scaling
  const ctx = els.outputCanvas.getContext('2d');
  els.outputCanvas.width = width;
  els.outputCanvas.height = height;
  ctx.putImageData(imageData, 0, 0);

  const sCtx = els.splitOutputCanvas.getContext('2d');
  els.splitOutputCanvas.width = width;
  els.splitOutputCanvas.height = height;
  sCtx.putImageData(imageData, 0, 0);

  els.downloadBtn.disabled = false;
  updatePreviewMeta(width, height);
  applyZoom();
}

function updatePreviewMeta(w, h) {
  const film = state.selectedFilm ? ` · ${formatFilmName(state.selectedFilm)}` : '';
  els.previewMeta.textContent = `${w}×${h}px · ${state.colorMode.toUpperCase()} · ${state.ditherType}${film}`;
}

// ── Load image ───────────────────────────────────────────────
function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // Cap to MAX_DIM on largest axis, preserve aspect ratio
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_DIM || h > MAX_DIM) {
      if (w >= h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
      else        { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    state.sourceImage = ctx.getImageData(0, 0, w, h);
    state.sourceWidth = w;
    state.sourceHeight = h;
    URL.revokeObjectURL(url);

    // Update pixelation slider min so 1px is reachable
    const maxDim = Math.max(w, h);
    const minScale = 1 / maxDim;
    els.pixelationSlider.min = minScale.toFixed(6);
    // Clamp current value if needed
    if (state.pixelation < minScale) {
      state.pixelation = minScale;
      els.pixelationSlider.value = minScale;
      els.pixelationValue.textContent = minScale.toFixed(4);
    }
    updateSliderFill(els.pixelationSlider);

    // Draw original canvases
    drawOriginalCanvases(img, w, h);

    // Show preview
    els.canvasPlaceholder.style.display = 'none';
    setView(state.currentView);

    // Image info
    els.imageInfo.style.display = 'block';
    els.imageInfoText.textContent = `${file.name} · ${w}×${h}`;

    triggerProcessing();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function drawOriginalCanvases(img, w, h) {
  for (const canvas of [els.originalCanvas, els.splitOriginalCanvas]) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.getContext('2d').drawImage(img, 0, 0);
  }
  applyZoom();
}

// ── View toggle ──────────────────────────────────────────────
function setView(view) {
  state.currentView = view;
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

// ── Zoom system ──────────────────────────────────────────────
const zoomState = { level: null }; // null = fit mode

function getZoomEl() {
  return {
    zoomOut:  document.getElementById('zoomOut'),
    zoomIn:   document.getElementById('zoomIn'),
    zoomFit:  document.getElementById('zoomFit'),
    zoom100:  document.getElementById('zoom100'),
    zoomLevel: document.getElementById('zoomLevel'),
  };
}

function applyZoom() {
  const z = getZoomEl();
  const canvases = [
    els.outputCanvas,
    els.originalCanvas,
    els.splitOriginalCanvas,
    els.splitOutputCanvas,
  ];

  if (zoomState.level === null) {
    // Fit mode: let CSS constrain the canvas
    canvases.forEach(c => {
      c.style.width = '';
      c.style.height = '';
      c.style.maxWidth = '100%';
      c.style.maxHeight = 'calc(100vh - 120px)';
    });
    z.zoomLevel.textContent = 'FIT';
    z.zoomFit.classList.add('active');
    z.zoom100.classList.remove('active');
  } else {
    // Fixed zoom: set explicit pixel size
    canvases.forEach(c => {
      if (!c.width) return;
      c.style.maxWidth = 'none';
      c.style.maxHeight = 'none';
      c.style.width = Math.round(c.width * zoomState.level) + 'px';
      c.style.height = Math.round(c.height * zoomState.level) + 'px';
    });
    z.zoomLevel.textContent = Math.round(zoomState.level * 100) + '%';
    z.zoomFit.classList.remove('active');
    z.zoom100.classList.toggle('active', zoomState.level === 1);
  }
}

function setZoom(level) {
  zoomState.level = level;
  applyZoom();
}

function initZoom() {
  const z = getZoomEl();
  const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

  z.zoomFit.addEventListener('click', () => setZoom(null));
  z.zoom100.addEventListener('click', () => setZoom(1));

  z.zoomIn.addEventListener('click', () => {
    if (zoomState.level === null) {
      setZoom(1);
      return;
    }
    const next = STEPS.find(s => s > zoomState.level);
    if (next) setZoom(next);
  });

  z.zoomOut.addEventListener('click', () => {
    if (zoomState.level === null) return;
    const prev = [...STEPS].reverse().find(s => s < zoomState.level);
    if (prev) setZoom(prev);
    else setZoom(null);
  });

  // Scroll wheel zoom on canvas container
  document.getElementById('canvasContainer').addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
    if (e.deltaY < 0) {
      // zoom in
      if (zoomState.level === null) { setZoom(1); return; }
      const next = STEPS.find(s => s > zoomState.level);
      if (next) setZoom(next);
    } else {
      // zoom out
      if (zoomState.level === null) return;
      const prev = [...STEPS].reverse().find(s => s < zoomState.level);
      if (prev) setZoom(prev); else setZoom(null);
    }
  }, { passive: false });
}


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
  return filename
    .replace(/\.hex$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function loadFilmSimulationsFromManifest() {
  try {
    const res = await fetch('Film Simulations/manifest.json');
    if (!res.ok) return false;
    const files = await res.json();
    for (const fname of files) {
      try {
        const r = await fetch(`Film Simulations/${fname}`);
        if (!r.ok) continue;
        const text = await r.text();
        const palette = parseHexFile(text);
        if (palette.length > 0) state.filmPalettes[fname] = palette;
      } catch {}
    }
    return Object.keys(state.filmPalettes).length > 0;
  } catch {
    return false;
  }
}

async function loadFilmSimulationsFromFolder() {
  if (!window.showDirectoryPicker) {
    alert('File System Access API not supported in this browser. Try Chrome or Edge.');
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker();
    state.filmPalettes = {};
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === 'file' && name.toLowerCase().endsWith('.hex')) {
        const file = await handle.getFile();
        const text = await file.text();
        const palette = parseHexFile(text);
        if (palette.length > 0) state.filmPalettes[name] = palette;
      }
    }
    rebuildFilmDropdown();
    const count = Object.keys(state.filmPalettes).length;
    els.filmLoadStatus.textContent = count > 0 ? `${count} PALETTES` : 'NO .HEX FILES FOUND';
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

function rebuildFilmDropdown() {
  const names = Object.keys(state.filmPalettes).sort();
  const favs = names.filter(n => state.favorites.has(n));
  const rest = names.filter(n => !state.favorites.has(n));

  els.filmDropdown.innerHTML = '';

  if (names.length === 0) {
    els.filmDropdown.appendChild(els.filmDropdownEmpty);
    return;
  }

  if (favs.length > 0) {
    const label = document.createElement('div');
    label.className = 'film-dropdown-section-label';
    label.textContent = '★ FAVORITES';
    els.filmDropdown.appendChild(label);
    favs.forEach(n => els.filmDropdown.appendChild(buildFilmOption(n)));
  }

  if (rest.length > 0) {
    const label = document.createElement('div');
    label.className = 'film-dropdown-section-label';
    label.textContent = favs.length > 0 ? 'ALL PALETTES' : 'PALETTES';
    els.filmDropdown.appendChild(label);
    rest.forEach(n => els.filmDropdown.appendChild(buildFilmOption(n)));
  }

  const count = names.length;
  els.filmLoadStatus.textContent = `${count} PALETTE${count !== 1 ? 'S' : ''}`;
}

function buildFilmOption(name) {
  const palette = state.filmPalettes[name];
  const div = document.createElement('div');
  div.className = 'film-option' + (state.selectedFilm === name ? ' selected' : '');
  div.setAttribute('role', 'option');
  div.setAttribute('aria-selected', state.selectedFilm === name);
  div.dataset.name = name;

  // Swatch strip (first 10 colors)
  const swatchWrap = document.createElement('div');
  swatchWrap.className = 'film-option-swatch';
  const swatchColors = palette.slice(0, 10);
  swatchColors.forEach(c => {
    const s = document.createElement('div');
    s.className = 'film-swatch-color';
    s.style.background = `rgb(${c.r},${c.g},${c.b})`;
    swatchWrap.appendChild(s);
  });

  const nameEl = document.createElement('div');
  nameEl.className = 'film-option-name';
  nameEl.textContent = (state.favorites.has(name) ? '★ ' : '') + formatFilmName(name);

  const star = document.createElement('span');
  star.className = 'film-star' + (state.favorites.has(name) ? ' starred' : '');
  star.textContent = '★';
  star.title = 'Toggle favorite';
  star.addEventListener('click', e => {
    e.stopPropagation();
    toggleFavorite(name);
  });

  div.appendChild(swatchWrap);
  div.appendChild(nameEl);
  div.appendChild(star);

  div.addEventListener('click', () => selectFilm(name));
  return div;
}

function selectFilm(name) {
  state.selectedFilm = name;
  els.filmSelectedName.textContent = formatFilmName(name);
  closeFilmDropdown();
  updatePaletteStrip();
  updateFavBtn();
  savePrefs();
  if (state.colorMode !== 'fullcolor' && state.colorMode !== 'mono') {
    triggerProcessing();
  }
}

function toggleFavorite(name) {
  if (state.favorites.has(name)) {
    state.favorites.delete(name);
  } else {
    state.favorites.add(name);
  }
  savePrefs();
  updateFavBtn();
  rebuildFilmDropdown();
}

function updatePaletteStrip() {
  if (!state.selectedFilm || !state.filmPalettes[state.selectedFilm]) {
    els.paletteStripWrap.style.display = 'none';
    return;
  }
  const palette = state.filmPalettes[state.selectedFilm];
  els.paletteStrip.innerHTML = '';
  palette.forEach(c => {
    const s = document.createElement('div');
    s.className = 'palette-strip-swatch';
    s.style.background = `rgb(${c.r},${c.g},${c.b})`;
    els.paletteStrip.appendChild(s);
  });
  els.paletteStripLabel.textContent = `${palette.length} COLORS · ${formatFilmName(state.selectedFilm)}`;
  els.paletteStripWrap.style.display = 'block';
}

function getSortedPaletteNames() {
  const names = Object.keys(state.filmPalettes).sort();
  const favs = names.filter(n => state.favorites.has(n));
  const rest = names.filter(n => !state.favorites.has(n));
  return [...favs, ...rest];
}

function navigateFilm(dir) {
  const names = getSortedPaletteNames();
  if (names.length === 0) return;
  const idx = state.selectedFilm ? names.indexOf(state.selectedFilm) : -1;
  const next = (idx + dir + names.length) % names.length;
  selectFilm(names[next]);
}

function updateFavBtn() {
  if (!els.filmFavBtn) return;
  const isStarred = state.selectedFilm && state.favorites.has(state.selectedFilm);
  els.filmFavBtn.classList.toggle('starred', !!isStarred);
  els.filmFavBtn.title = isStarred ? 'Remove from favorites' : 'Add to favorites';
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

// ── Slider track fill ────────────────────────────────────────
function updateSliderFill(slider) {
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const val = parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--pct', pct + '%');
}

// ── Preferences ──────────────────────────────────────────────
function savePrefs() {
  try {
    localStorage.setItem('ditherpunk_prefs', JSON.stringify({
      colorMode: state.colorMode,
      ditherType: state.ditherType,
      pixelation: state.pixelation,
      bias: state.bias,
      ditherThreshold: state.ditherThreshold,
      halftoneCellSize: state.halftoneCellSize,
      selectedFilm: state.selectedFilm,
      favorites: [...state.favorites],
    }));
  } catch {}
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem('ditherpunk_prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.colorMode) state.colorMode = p.colorMode;
    if (p.ditherType) state.ditherType = p.ditherType;
    if (typeof p.pixelation === 'number') state.pixelation = p.pixelation;
    if (typeof p.bias === 'number') state.bias = p.bias;
    if (typeof p.ditherThreshold === 'number') state.ditherThreshold = p.ditherThreshold;
    if (typeof p.halftoneCellSize === 'number') state.halftoneCellSize = p.halftoneCellSize;
    if (p.selectedFilm) state.selectedFilm = p.selectedFilm;
    if (Array.isArray(p.favorites)) state.favorites = new Set(p.favorites);
  } catch {}
}

function applyPrefsToUI() {
  // Color mode
  document.querySelectorAll('.seg-btn[data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.colorMode);
  });

  // Dither
  els.ditherSelect.value = state.ditherType;

  // Sliders
  els.pixelationSlider.value = state.pixelation;
  els.pixelationValue.textContent = state.pixelation.toFixed(2);
  updateSliderFill(els.pixelationSlider);

  els.biasSlider.value = state.bias;
  els.biasValue.textContent = state.bias.toFixed(2);
  updateSliderFill(els.biasSlider);

  els.ditherThresholdSlider.value = state.ditherThreshold;
  els.ditherThresholdValue.textContent = state.ditherThreshold.toFixed(2);
  updateSliderFill(els.ditherThresholdSlider);

  els.halftoneCellSlider.value = state.halftoneCellSize;
  els.halftoneCellValue.textContent = state.halftoneCellSize;
  updateSliderFill(els.halftoneCellSlider);
  els.halftoneCellRow.style.display = state.ditherType === 'halftone' ? '' : 'none';

  // Film mode UI
  updateFilmSectionState();

  // Film selected
  if (state.selectedFilm && state.filmPalettes[state.selectedFilm]) {
    els.filmSelectedName.textContent = formatFilmName(state.selectedFilm);
    updatePaletteStrip();
    updateFavBtn();
  }
}

function updateFilmSectionState() {
  const filmActive = state.colorMode === 'film' || state.colorMode === 'filmcolor';
  els.filmSection.classList.toggle('disabled', !filmActive);
}

function resetToDefaults() {
  state.colorMode = DEFAULTS.colorMode;
  state.ditherType = DEFAULTS.ditherType;
  state.pixelation = DEFAULTS.pixelation;
  state.bias = DEFAULTS.bias;
  state.ditherThreshold = DEFAULTS.ditherThreshold;
  state.halftoneCellSize = DEFAULTS.halftoneCellSize;
  applyPrefsToUI();
  savePrefs();
  triggerProcessing();
}

// ── Tooltip system ───────────────────────────────────────────
function initTooltips() {
  document.querySelectorAll('.info-tip').forEach(tip => {
    tip.addEventListener('mouseenter', e => {
      const text = tip.dataset.tip;
      if (!text) return;
      els.tooltipPopup.textContent = text;
      els.tooltipPopup.classList.add('visible');
      positionTooltip(e);
    });
    tip.addEventListener('mousemove', positionTooltip);
    tip.addEventListener('mouseleave', () => {
      els.tooltipPopup.classList.remove('visible');
    });
  });
}

function positionTooltip(e) {
  const x = e.clientX + 12;
  const y = e.clientY + 12;
  const tw = els.tooltipPopup.offsetWidth;
  const th = els.tooltipPopup.offsetHeight;
  els.tooltipPopup.style.left = Math.min(x, window.innerWidth - tw - 8) + 'px';
  els.tooltipPopup.style.top = Math.min(y, window.innerHeight - th - 8) + 'px';
}

// ── Download ─────────────────────────────────────────────────
function downloadImage() {
  const canvas = els.outputCanvas;
  if (!canvas.width) return;
  const filmPart = state.selectedFilm ? `-${state.selectedFilm.replace(/\.hex$/i, '')}` : '';
  const ts = Date.now();
  const filename = `ditherpunk${filmPart}-${ts}.png`;
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ── Event wiring ─────────────────────────────────────────────
function initEvents() {
  // Drop zone
  els.dropZone.addEventListener('click', () => els.fileInput.click());
  els.dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadImage(e.target.files[0]);
  });

  // Drag and drop
  els.dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    els.dropZone.classList.add('drag-over');
  });
  els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('drag-over'));
  els.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    els.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadImage(file);
  });

  // Global drag-drop on body
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  // Color mode buttons
  document.querySelectorAll('.seg-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.colorMode = btn.dataset.mode;
      document.querySelectorAll('.seg-btn[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateFilmSectionState();
      savePrefs();
      triggerProcessing();
    });
  });

  // Dither select
  els.ditherSelect.addEventListener('change', () => {
    state.ditherType = els.ditherSelect.value;
    els.halftoneCellRow.style.display = state.ditherType === 'halftone' ? '' : 'none';
    savePrefs();
    triggerProcessing();
  });

  // Sliders
  els.pixelationSlider.addEventListener('input', () => {
    state.pixelation = parseFloat(els.pixelationSlider.value);
    els.pixelationValue.textContent = state.pixelation.toFixed(2);
    updateSliderFill(els.pixelationSlider);
    savePrefs();
    triggerProcessing();
  });

  els.biasSlider.addEventListener('input', () => {
    state.bias = parseFloat(els.biasSlider.value);
    els.biasValue.textContent = state.bias.toFixed(2);
    updateSliderFill(els.biasSlider);
    savePrefs();
    triggerProcessing();
  });

  els.ditherThresholdSlider.addEventListener('input', () => {
    state.ditherThreshold = parseFloat(els.ditherThresholdSlider.value);
    els.ditherThresholdValue.textContent = state.ditherThreshold.toFixed(2);
    updateSliderFill(els.ditherThresholdSlider);
    savePrefs();
    triggerProcessing();
  });

  els.halftoneCellSlider.addEventListener('input', () => {
    state.halftoneCellSize = parseInt(els.halftoneCellSlider.value, 10);
    els.halftoneCellValue.textContent = state.halftoneCellSize;
    updateSliderFill(els.halftoneCellSlider);
    savePrefs();
    triggerProcessing();
  });

  // Film dropdown toggle
  els.filmSelectBtn.addEventListener('click', () => {
    if (els.filmDropdown.classList.contains('open')) {
      closeFilmDropdown();
    } else {
      openFilmDropdown();
    }
  });

  els.filmSelectBtn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.filmSelectBtn.click();
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', e => {
    if (!els.filmDropdown.contains(e.target) && !els.filmSelectBtn.contains(e.target)) {
      closeFilmDropdown();
    }
  });

  // Load folder button
  els.loadFolderBtn.addEventListener('click', loadFilmSimulationsFromFolder);

  // Film prev/next/fav buttons
  els.filmPrevBtn.addEventListener('click', () => navigateFilm(-1));
  els.filmNextBtn.addEventListener('click', () => navigateFilm(1));
  els.filmFavBtn.addEventListener('click', () => {
    if (state.selectedFilm) toggleFavorite(state.selectedFilm);
  });

  // View toggle
  [els.viewProcessed, els.viewOriginal, els.viewSplit].forEach(btn => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  // Download
  els.downloadBtn.addEventListener('click', downloadImage);

  // Reset
  els.resetBtn.addEventListener('click', resetToDefaults);
}

// ── Init ─────────────────────────────────────────────────────
async function init() {
  loadPrefs();
  initWorker();
  initEvents();
  initTooltips();
  initZoom();
  applyPrefsToUI();

  // Try loading from manifest (works when served via HTTP)
  const loaded = await loadFilmSimulationsFromManifest();
  if (loaded) {
    rebuildFilmDropdown();
    // Restore selected film if still available
    if (state.selectedFilm && state.filmPalettes[state.selectedFilm]) {
      els.filmSelectedName.textContent = formatFilmName(state.selectedFilm);
      updatePaletteStrip();
    }
  } else {
    // file:// protocol or missing manifest — prompt user to load folder
    els.filmLoadStatus.textContent = 'USE LOAD FOLDER ↑';
  }
}

init();
