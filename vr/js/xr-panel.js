// Panel de control dentro de VR, anclado a la muñeca izquierda.
//
// Es un lienzo 2D pintado sobre un plano: se apunta con el otro mando (o con el índice,
// si vas con hand tracking) y se pulsa con el gatillo / pellizco. Sin esto, una vez te
// pones las gafas no puedes cambiar de modelo ni tocar nada.

import * as THREE from 'three';
import { player, camera, onFrame } from './viewer.js';
import { events, inputs, inputByHand } from './xr.js';
import * as S from './state.js';

const W = 512, H = 760;
const PANEL_W = 0.20, PANEL_H = PANEL_W * H / W;
const ROWS = 5;                       // modelos visibles a la vez

// Desplazamiento respecto al mando/muñeca. Puede querer un retoque fino según cómo
// sujetes el mando: sube/baja el .y y el ángulo hasta que se lea cómodo.
const OFFSET_CONTROLLER = { pos: [0.005, 0.055, -0.055], rotX: -0.95 };
const OFFSET_HAND       = { pos: [0.0, 0.015, -0.095],   rotX: -1.25 };

const C = {
  bg: '#12141c', bgSoft: '#1b1e29', border: '#2f3444',
  text: '#e7e9ef', muted: '#9aa0b0', accent: '#5b8cff', ok: '#37d399', warn: '#ffb454',
};

const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');

const texture = new THREE.CanvasTexture(canvas);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = 8;
texture.minFilter = THREE.LinearFilter;
texture.generateMipmaps = false;

const panel = new THREE.Mesh(
  new THREE.PlaneGeometry(PANEL_W, PANEL_H),
  new THREE.MeshBasicMaterial({
    map: texture, transparent: true, toneMapped: false,
    depthTest: false, side: THREE.DoubleSide,
  })
);
panel.renderOrder = 999;
panel.visible = false;
player.add(panel);

const cursor = new THREE.Mesh(
  new THREE.CircleGeometry(0.004, 12),
  new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 })
);
cursor.renderOrder = 1000;
cursor.visible = false;
player.add(cursor);

// ---------- Modelo de la interfaz ----------

let actions = {};
let getEntries = () => [];
let listOffset = 0;
let hovered = null;
let regions = [];
let dirty = true;

export function configure(opts) {
  actions = opts.actions || {};
  getEntries = opts.getEntries || getEntries;
  dirty = true;
}

export function refresh() { dirty = true; }

/** Al entrar en otra carpeta la lista vuelve arriba. */
export function resetScroll() { listOffset = 0; dirty = true; }

function buildRegions() {
  const entries = getEntries();
  const maxOffset = Math.max(0, entries.length - ROWS);
  listOffset = Math.min(listOffset, maxOffset);

  const r = [];
  const pad = 18;
  const colW = (W - pad * 2 - 12 * 3) / 4;

  // Fila 1: interruptores
  const toggles = [
    { id: 'clay', label: 'Clay', on: () => S.get('clay') },
    { id: 'ao', label: 'AO', on: () => S.get('ao') },
    { id: 'wire', label: 'Malla', on: () => S.get('wire') },
    { id: 'grid', label: 'Rejilla', on: () => S.get('grid') },
  ];
  toggles.forEach((t, i) => r.push({
    ...t, kind: 'toggle', x: pad + i * (colW + 12), y: 118, w: colW, h: 62,
  }));

  // Fila 2: giros
  ['x', 'y', 'z'].forEach((axis, i) => r.push({
    id: 'rot' + axis, kind: 'action', label: '⟲ ' + axis.toUpperCase(),
    x: pad + i * ((W - pad * 2 - 24) / 3 + 12), y: 194, w: (W - pad * 2 - 24) / 3, h: 58,
  }));

  // Fila 3: encuadre y escala
  const trio = [
    { id: 'fit', label: 'Centrar' },
    { id: 'reset', label: 'Reiniciar' },
    { id: 'real', label: '1:1', on: () => S.get('realScale') },
  ];
  trio.forEach((t, i) => r.push({
    ...t, kind: t.on ? 'toggle' : 'action',
    x: pad + i * ((W - pad * 2 - 24) / 3 + 12), y: 266, w: (W - pad * 2 - 24) / 3, h: 58,
  }));

  // Lista de modelos
  const listTop = 386;
  const rowH = 62;
  const visible = entries.slice(listOffset, listOffset + ROWS);
  visible.forEach((entry, i) => r.push({
    id: 'entry:' + entry.id, kind: 'entry', entry,
    x: pad, y: listTop + i * (rowH + 8), w: W - pad * 2 - 56, h: rowH,
  }));

  const arrowX = W - pad - 46;
  r.push({ id: 'up', kind: 'arrow', label: '▲', x: arrowX, y: listTop, w: 46, h: 46, disabled: listOffset <= 0 });
  r.push({ id: 'down', kind: 'arrow', label: '▼', x: arrowX, y: listTop + ROWS * (rowH + 8) - 54, w: 46, h: 46, disabled: listOffset >= maxOffset });

  regions = r;
  return entries;
}

// ---------- Dibujo ----------

function roundRect(x, y, w, h, radius) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, radius); return; }
  // Los navegadores de Quest antiguos no traen roundRect.
  const r = Math.min(radius, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw() {
  const entries = buildRegions();

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg;
  roundRect(0, 0, W, H, 26); ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 3;
  roundRect(1.5, 1.5, W - 3, H - 3, 26); ctx.stroke();

  // Cabecera
  ctx.fillStyle = C.accent;
  ctx.font = '600 22px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('VISOR VR', 20, 36);

  ctx.fillStyle = C.text;
  ctx.font = '600 30px system-ui, -apple-system, sans-serif';
  const name = S.get('modelName') || 'Sin modelo';
  ctx.fillText(clip(name, 26), 20, 78);

  for (const region of regions) {
    if (region.kind === 'entry') drawEntry(region);
    else drawButton(region);
  }

  ctx.fillStyle = C.muted;
  ctx.font = '500 20px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const total = entries.length;
  ctx.fillText(total ? `Modelos ${Math.min(listOffset + 1, total)}–${Math.min(listOffset + ROWS, total)} de ${total}` : 'Catálogo vacío', 20, 356);

  ctx.fillStyle = '#6a7183';
  ctx.font = '500 18px system-ui, sans-serif';
  ctx.fillText('Gatillo: pulsar · Agarre: coger el modelo', 20, H - 26);

  texture.needsUpdate = true;
}

function drawButton(region) {
  const isHover = hovered && hovered.id === region.id;
  const on = region.on ? region.on() : false;
  ctx.fillStyle = region.disabled ? '#161923' : (isHover ? '#262b39' : C.bgSoft);
  roundRect(region.x, region.y, region.w, region.h, 14); ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = on ? C.ok : (isHover ? C.accent : C.border);
  roundRect(region.x, region.y, region.w, region.h, 14); ctx.stroke();

  ctx.fillStyle = region.disabled ? '#4a5060' : (on ? C.ok : C.text);
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(region.label, region.x + region.w / 2, region.y + region.h / 2 + 1);
  ctx.textAlign = 'left';
}

function drawEntry(region) {
  const entry = region.entry;
  const isHover = hovered && hovered.id === region.id;
  const isActive = S.get('activeId') === entry.id;
  const isFolder = entry.kind === 'dir';
  const isUp = entry.kind === 'up';

  ctx.fillStyle = isHover ? '#262b39' : C.bgSoft;
  roundRect(region.x, region.y, region.w, region.h, 14); ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = isActive ? C.accent : (isHover ? '#4b5468' : C.border);
  roundRect(region.x, region.y, region.w, region.h, 14); ctx.stroke();

  // Franja lateral para distinguir carpetas de modelos de un vistazo.
  if (isFolder || isUp) {
    ctx.fillStyle = isUp ? C.accent : C.warn;
    roundRect(region.x + 3, region.y + 10, 5, region.h - 20, 3); ctx.fill();
  }

  ctx.fillStyle = entry.supported === false ? C.warn : C.text;
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const label = isFolder ? '📁  ' + entry.name : entry.name;
  ctx.fillText(clip(label, 24), region.x + 16, region.y + (entry.sub ? 24 : region.h / 2));

  if (entry.sub) {
    ctx.fillStyle = C.muted;
    ctx.font = '500 18px system-ui, sans-serif';
    ctx.fillText(clip(entry.sub, 30), region.x + 16, region.y + 47);
  }
}

function clip(text, max) {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// ---------- Anclaje a la muñeca ----------

const _m = new THREE.Matrix4();
const _offset = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _normal = new THREE.Vector3();
const _toCamera = new THREE.Vector3();
const _panelPos = new THREE.Vector3();

function anchorFor(input) {
  if (!input || !input.connected) return null;
  if (input.isHand) return input.hand.joints?.['wrist'] || null;
  return input.grip;
}

function updateAnchor() {
  const left = inputByHand('left') || inputs.find(i => i.connected);
  const anchor = anchorFor(left);
  if (!anchor) { panel.visible = false; return false; }

  const cfg = left.isHand ? OFFSET_HAND : OFFSET_CONTROLLER;
  _offset.makeRotationX(cfg.rotX);
  _offset.setPosition(cfg.pos[0], cfg.pos[1], cfg.pos[2]);

  anchor.updateMatrixWorld();
  player.updateMatrixWorld();
  _inv.copy(player.matrixWorld).invert();
  _m.multiplyMatrices(_inv, anchor.matrixWorld).multiply(_offset);
  _m.decompose(panel.position, panel.quaternion, panel.scale);
  panel.scale.setScalar(1);
  panel.updateMatrixWorld();

  // Solo se muestra cuando lo tienes girado hacia ti, como mirar un reloj.
  _normal.set(0, 0, 1).applyQuaternion(panel.getWorldQuaternion(new THREE.Quaternion()));
  panel.getWorldPosition(_panelPos);
  camera.getWorldPosition(_toCamera).sub(_panelPos).normalize();
  panel.visible = _normal.dot(_toCamera) > 0.25;
  return panel.visible;
}

// ---------- Puntero ----------

const raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _rot = new THREE.Matrix4();

function pointerRayFrom(input) {
  if (input.isHand) {
    const tip = input.hand.joints?.['index-finger-tip'];
    const knuckle = input.hand.joints?.['index-finger-phalanx-proximal'];
    if (!tip || !knuckle) return false;
    tip.getWorldPosition(_origin);
    _dir.copy(_origin).sub(knuckle.getWorldPosition(new THREE.Vector3())).normalize();
    return true;
  }
  _rot.identity().extractRotation(input.controller.matrixWorld);
  _origin.setFromMatrixPosition(input.controller.matrixWorld);
  _dir.set(0, 0, -1).applyMatrix4(_rot).normalize();
  return true;
}

function hitTest(input) {
  if (!panel.visible || !pointerRayFrom(input)) return null;
  raycaster.set(_origin, _dir);
  raycaster.far = 3;
  const hit = raycaster.intersectObject(panel, false)[0];
  if (!hit || !hit.uv) return null;
  const px = hit.uv.x * W;
  const py = (1 - hit.uv.y) * H;
  const region = regions.find(r => !r.disabled && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
  return { region, point: hit.point, distance: hit.distance };
}

/** El input que apunta al panel: cualquiera que no sea el que lo lleva puesto. */
function pointerInput() {
  const left = inputByHand('left') || inputs.find(i => i.connected);
  return inputs.find(i => i.connected && i !== left) || null;
}

function activate(region) {
  if (!region) return;
  // Una fila puede ser un modelo, una subcarpeta o el «atrás»: lo resuelve main.
  if (region.kind === 'entry') { actions.open?.(region.entry); return; }
  switch (region.id) {
    case 'clay': case 'ao': case 'wire': case 'grid': S.toggle(region.id); break;
    case 'rotx': case 'roty': case 'rotz': actions.rotate?.(region.id.slice(3)); break;
    case 'fit': actions.fit?.(); break;
    case 'reset': actions.reset?.(); break;
    case 'real': actions.toggleRealScale?.(); break;
    case 'up': listOffset = Math.max(0, listOffset - ROWS); break;
    case 'down': listOffset += ROWS; break;
  }
  dirty = true;
}

events.addEventListener('point-start', e => {
  const input = e.detail.input;
  if (input !== pointerInput()) return;
  const hit = hitTest(input);
  if (!hit?.region) return;
  input.pointerConsumed = true;     // el panel se queda el gesto: ni teletransporte ni agarre
  activate(hit.region);
});

onFrame((dt, presenting) => {
  if (!presenting) { panel.visible = false; cursor.visible = false; return; }
  if (!updateAnchor()) { cursor.visible = false; hovered = null; return; }

  const input = pointerInput();
  const hit = input ? hitTest(input) : null;
  const nextHovered = hit?.region || null;
  if (nextHovered?.id !== hovered?.id) { hovered = nextHovered; dirty = true; }

  if (hit) {
    cursor.visible = true;
    cursor.position.copy(player.worldToLocal(hit.point.clone()));
    cursor.quaternion.copy(panel.quaternion);
    if (input && !input.isHand) input.ray.scale.z = hit.distance;
  } else {
    cursor.visible = false;
    if (input && !input.isHand) input.ray.scale.z = 5;
  }

  if (dirty) { dirty = false; draw(); }
});

S.on(['clay', 'ao', 'wire', 'grid', 'realScale', 'modelName', 'activeId'], () => { dirty = true; });

draw();
export { panel };
