// Interfaz de escritorio. Solo toca el DOM: todo lo que cambia el estado pasa por
// state.js, que es lo que mantiene sincronizado el panel de dentro de las gafas.

import * as S from './state.js';
import { CLAY_COLORS } from './state.js';
import { humanSize } from './sources.js';

const $ = id => document.getElementById(id);

const el = {
  list: $('list'), crumbs: $('crumbs'), back: $('backBtn'), reload: $('reloadBtn'),
  status: $('status'), placeholder: $('placeholder'),
  settings: $('settings'), legend: $('legend'), legendBody: $('legendBody'),
  walkhint: $('walkhint'), swatches: $('swatches'),
};

const LEGEND = {
  orbit: '<b>Ratón</b> orbitar · rueda zoom · <b>Caminar</b> para recorrerlo por dentro<br>' +
         '<b>En VR</b> stick izq. andar · stick der. girar · gatillo teletransporte<br>' +
         '<b>Agarre</b> arrastrarte por el mundo · con los dos, escalarte y girar',
  walk: '<b>Caminar</b> · haz clic para mirar<br>' +
        '<span class="k">W A S D</span> mover · <span class="k">Espacio / C</span> subir y bajar · ' +
        '<span class="k">Shift</span> correr · <span class="k">Esc</span> salir',
};

let actions = {};

// ---------- Estado visible ----------

let statusTimer = 0;

export function status(message, type = '', fraction = null) {
  clearTimeout(statusTimer);
  if (!message) { el.status.className = ''; return; }
  const spinner = type === 'load' && fraction === null ? '<span class="spinner"></span>' : '';
  const bar = fraction !== null
    ? `<span class="bar"><i style="width:${Math.round(fraction * 100)}%"></i></span>` : '';
  el.status.innerHTML = `${spinner}<span>${message}</span>${bar}`;
  el.status.className = 'show' + (type === 'err' ? ' err' : '');
  if (type === 'ok') statusTimer = setTimeout(() => el.status.classList.remove('show'), 1800);
}

export function setPlaceholderVisible(visible) {
  el.placeholder.style.display = visible ? 'grid' : 'none';
}

// ---------- Lista lateral ----------

let activeRow = null;

function row(item, onClick) {
  const node = document.createElement('div');
  const supported = item.supported !== false;
  const isFolder = item.kind === 'dir';
  node.className = 'item' + (isFolder ? ' folder' : '') + (supported ? '' : ' disabled');
  node.dataset.id = item.id;
  const tag = isFolder ? 'DIR' : (item.ext || '').toUpperCase().slice(0, 4);
  node.innerHTML = `<div class="ico">${tag}</div>
    <div class="meta"><div class="name"></div><div class="sub"></div></div>
    ${isFolder ? '' : `<span class="badge ${supported ? '' : 'no'}">${supported ? item.ext : 'no'}</span>`}`;
  node.querySelector('.name').textContent = item.name;
  node.querySelector('.sub').textContent = item.sub || '';
  if (supported) node.onclick = () => onClick(item, node);
  return node;
}

export function renderList(items, { onPick, emptyHtml } = {}) {
  el.list.innerHTML = '';
  activeRow = null;
  if (!items.length) {
    el.list.innerHTML = `<div class="empty">${emptyHtml || 'Nada que mostrar.'}</div>`;
    return;
  }
  for (const item of items) el.list.appendChild(row(item, onPick));
  markActive(S.get('activeId'));
}

export function markActive(id) {
  activeRow?.classList.remove('active');
  activeRow = id ? el.list.querySelector(`.item[data-id="${id}"]`) : null;
  activeRow?.classList.add('active');
}

export function setCrumbs(html) { el.crumbs.innerHTML = html; }
export function setBackVisible(visible) { el.back.hidden = !visible; }

// ---------- Cableado ----------

export function init(a) {
  actions = a;

  el.back.onclick = () => actions.goUp?.();
  el.reload.onclick = () => actions.reload?.();

  bindToggle('clayBtn', 'clay');
  bindToggle('aoBtn', 'ao');
  bindToggle('wireBtn', 'wire');
  bindToggle('gridBtn', 'grid');

  $('rotX').onclick = () => actions.rotate?.('x');
  $('rotY').onclick = () => actions.rotate?.('y');
  $('rotZ').onclick = () => actions.rotate?.('z');
  $('fitBtn').onclick = () => actions.fit?.();
  $('realBtn').onclick = () => actions.toggleRealScale?.();
  $('walkBtn').onclick = () => actions.setMode?.(S.get('mode') === 'walk' ? 'orbit' : 'walk');
  $('cfgBtn').onclick = () => { el.settings.hidden = !el.settings.hidden; };

  bindRange('rngExposure', 'outExposure', 'exposure', v => v.toFixed(2));
  bindRange('rngAo', 'outAo', 'aoStrength', v => Math.round(v * 100) + '%');
  bindRange('rngContact', 'outContact', 'contactOpacity', v => Math.round(v * 100) + '%');
  bindRange('rngSoft', 'outSoft', 'shadowSoftness', v => v.toFixed(1));

  const quality = $('selQuality');
  quality.value = S.get('quality');
  quality.onchange = () => S.set({ quality: quality.value });

  CLAY_COLORS.forEach(color => {
    const swatch = document.createElement('span');
    swatch.style.background = '#' + color.hex.toString(16).padStart(6, '0');
    swatch.title = color.name;
    swatch.dataset.hex = color.hex;
    swatch.onclick = () => S.set({ clayColor: color.hex });
    el.swatches.appendChild(swatch);
  });
  const paintSwatches = () => el.swatches.querySelectorAll('span')
    .forEach(s => s.classList.toggle('active', Number(s.dataset.hex) === S.get('clayColor')));
  S.on('clayColor', paintSwatches);
  paintSwatches();

  $('legendToggle').onclick = () => el.legend.classList.toggle('collapsed');

  syncButtons();

  S.on(['clay', 'ao', 'wire', 'grid', 'realScale', 'mode'], syncButtons);
  S.on('mode', mode => {
    el.legendBody.innerHTML = LEGEND[mode] || LEGEND.orbit;
    el.walkhint.classList.toggle('show', mode === 'walk');
  });
  S.on('presenting', presenting => {
    document.querySelectorAll('.toolbar button').forEach(b => { b.disabled = presenting; });
    if (presenting) status('Sesión VR en marcha · el control está en el panel de tu muñeca izquierda', 'ok');
  });
  S.on('activeId', markActive);
  el.legendBody.innerHTML = LEGEND.orbit;
}

function bindToggle(id, key) {
  const button = $(id);
  button.onclick = () => S.toggle(key);
}

function bindRange(rangeId, outId, key, format) {
  const range = $(rangeId), out = $(outId);
  range.value = S.get(key);
  out.textContent = format(Number(range.value));
  range.oninput = () => {
    const value = Number(range.value);
    out.textContent = format(value);
    S.set({ [key]: value });
  };
  S.on(key, value => {
    if (Number(range.value) === value) return;
    range.value = value;
    out.textContent = format(value);
  });
}

function syncButtons() {
  const map = { clayBtn: 'clay', aoBtn: 'ao', wireBtn: 'wire', gridBtn: 'grid', realBtn: 'realScale' };
  for (const [id, key] of Object.entries(map)) $(id).classList.toggle('on', !!S.get(key));
  $('walkBtn').classList.toggle('on', S.get('mode') === 'walk');
  $('aoBtn').disabled = !S.get('aoAvailable');
  $('aoBtn').title = S.get('aoAvailable')
    ? 'Oclusión ambiental horneada en los vértices'
    : 'Sin AO horneada para este modelo (malla demasiado densa o sin vértices suficientes)';
}
S.on('aoAvailable', syncButtons);

export { humanSize };
