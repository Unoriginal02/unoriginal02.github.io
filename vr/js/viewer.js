// Renderizador, escena, cámara y bucle. Sin postproceso: lo que se ve en el monitor
// es exactamente lo que se ve en las gafas (y era el postproceso —GTAOPass— el que
// pintaba el rectángulo negro sobre el modelo).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import * as S from './state.js';

export const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  // alpha:false → el lienzo es opaco; una capa menos que componer por fotograma.
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = S.get('exposure');
renderer.shadowMap.enabled = true;
// VSM es el único tipo cuyo `radius` difumina de verdad: es lo que da la sombra
// blanda de un clay render en lugar del borde duro del mapa de sombras clásico.
renderer.shadowMap.type = THREE.VSMShadowMap;
// El modelo está quieto casi siempre: recalcular el mapa de sombras cada fotograma es
// una pasada entera de escena más el desenfoque VSM tirados a la basura. Se recalcula a
// mano (invalidateShadows) cuando algo cambia de verdad.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
camera.position.set(2, 1.6, 3);

/** Plataforma del jugador: en VR movemos este grupo, que lleva dentro cámara y mandos. */
export const player = new THREE.Group();
player.add(camera);
scene.add(player);

/** Todo lo que se carga cuelga de aquí. Es lo que se agarra, escala y gira. */
export const modelGroup = new THREE.Group();
scene.add(modelGroup);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1, 0);

export const walk = new PointerLockControls(camera, renderer.domElement);

let wrap = null;
const frameCallbacks = new Set();
const clock = new THREE.Clock();

/** Registra una función que se llama cada fotograma: fn(dt, presenting). */
export function onFrame(fn) { frameCallbacks.add(fn); return () => frameCallbacks.delete(fn); }

// Dentro de VR el `requestAnimationFrame` de la ventana NO se dispara: los fotogramas los
// pide la sesión XR. Todo lo que quiera trocear trabajo entre fotogramas tiene que esperar
// a este bucle, o se queda colgado en cuanto te pones las gafas.
const waiters = [];

/** Promesa que se resuelve en el siguiente fotograma, dentro y fuera de VR. */
export function nextFrame() { return new Promise(resolve => waiters.push(resolve)); }

/**
 * Ejecuta trabajo que pinta en render targets propios. Dentro de una sesión XR hay que
 * apagar `xr.enabled` mientras dura: si no, three cambia tu cámara por la estéreo del
 * casco y las pasadas acaban en el framebuffer del visor.
 */
export function offscreen(fn) {
  const wasEnabled = renderer.xr.enabled;
  const wasAuto = renderer.shadowMap.autoUpdate;
  const wasNeeded = renderer.shadowMap.needsUpdate;
  renderer.xr.enabled = false;
  // Estas pasadas esconden media escena y ponen un overrideMaterial: si de paso se
  // recalculara el mapa de sombras, saldría hecho con esa escena falsa.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = false;
  try {
    return fn();
  } finally {
    renderer.xr.enabled = wasEnabled;
    renderer.shadowMap.autoUpdate = wasAuto;
    renderer.shadowMap.needsUpdate = wasNeeded;
  }
}

/** Pide un recálculo del mapa de sombras en el próximo fotograma. */
export function invalidateShadows() { renderer.shadowMap.needsUpdate = true; }

export function mount(el) {
  wrap = el;
  wrap.appendChild(renderer.domElement);
  resize();
  window.addEventListener('resize', resize);
  renderer.setAnimationLoop(tick);
}

export function resize() {
  if (!wrap) return;
  const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const presenting = renderer.xr.isPresenting;
  if (waiters.length) waiters.splice(0).forEach(resolve => resolve());
  for (const fn of frameCallbacks) fn(dt, presenting);
  if (!presenting && controls.enabled && S.get('mode') === 'orbit') controls.update();
  renderer.render(scene, camera);
}

// ---------- Encuadre ----------

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

export function modelBox(target = new THREE.Box3()) {
  target.makeEmpty();
  if (modelGroup.children.length) target.setFromObject(modelGroup);
  return target;
}

/** Radio característico del modelo (mitad de su dimensión mayor), 1 si no hay nada. */
export function modelRadius() {
  modelBox(_box);
  if (_box.isEmpty()) return 1;
  return Math.max(0.05, _box.getSize(_v).length() * 0.5);
}

/** Recentra la cámara de escritorio sobre el modelo. */
export function fitView() {
  modelBox(_box);
  if (_box.isEmpty()) return;
  const c = _box.getCenter(new THREE.Vector3());
  const s = _box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) || 1;

  controls.target.copy(c);
  camera.position.set(c.x + r * 1.5, c.y + r * 0.9, c.z + r * 1.9);
  // Rango de profundidad ajustado al modelo, pero con el plano cercano acotado: three
  // pasa este near/far a la sesión XR, y un near minúsculo con un far lejano deja el
  // buffer de profundidad sin precisión — en las gafas eso es parpadeo de superficies.
  camera.near = THREE.MathUtils.clamp(r / 500, 0.05, 0.5);
  camera.far = r * 30 + 80;
  camera.updateProjectionMatrix();
  controls.update();
}

/** Coloca al jugador de pie delante del modelo (modo caminar y entrada en VR). */
export function standInFrontOfModel(distance) {
  modelBox(_box);
  let d = distance ?? 3;
  let cx = 0, cz = 0;
  if (!_box.isEmpty()) {
    const s = _box.getSize(new THREE.Vector3());
    const c = _box.getCenter(new THREE.Vector3());
    cx = c.x; cz = c.z;
    d = distance ?? (Math.max(s.x, s.z) * 0.75 + 1.6);
  }
  player.position.set(cx, 0, cz + d);
  player.rotation.set(0, 0, 0);
  player.updateMatrixWorld(true);
}

// ---------- Modo caminar (escritorio, teclado + ratón) ----------

const EYE = 1.6;                 // altura de los ojos sobre el suelo que estés pisando
const WALKABLE = 0.4;            // más inclinado que esto es pared o techo: no se pisa

const keys = Object.create(null);

/** Con el foco en un control de los ajustes, el teclado es suyo. */
function typing(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !!target?.isContentEditable;
}

const RISE_KEYS = new Set(['Space', 'KeyE', 'PageUp', 'KeyC', 'KeyQ', 'PageDown']);

addEventListener('keydown', e => {
  if (renderer.xr.isPresenting || typing(e.target)) return;
  // Andando hace falta tener el ratón capturado; orbitando basta con no estar escribiendo.
  if (S.get('mode') === 'walk' && !walk.isLocked) return;
  keys[e.code] = true;
  if (e.code === 'KeyF' && S.get('mode') === 'walk') snapToFloorBelow();
  if (RISE_KEYS.has(e.code)) {
    // Un botón de la barra con el foco se queda el Espacio y se vuelve a pulsar solo.
    if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur();
    e.preventDefault();
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
// Si la ventana pierde el foco con una tecla pulsada, el `keyup` no llega nunca y te
// quedarías subiendo solo para siempre.
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

renderer.domElement.addEventListener('click', () => {
  if (S.get('mode') === 'walk' && !renderer.xr.isPresenting) walk.lock();
});

export function setMode(mode) {
  const walking = mode === 'walk';
  S.set({ mode });
  controls.enabled = !walking && !renderer.xr.isPresenting;
  if (walking) {
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
    standInFrontOfModel();
    camera.position.set(0, EYE, 0);
    camera.rotation.set(0, 0, 0);
  } else {
    walk.unlock();
    for (const k in keys) keys[k] = false;
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
    fitView();
  }
}

/**
 * Te deja de pie sobre la primera superficie pisable que haya bajo tus pies: sube volando
 * con Espacio hasta pasar el forjado y pulsa F para plantarte en la planta de arriba.
 * Si no hay nada debajo, vuelve al suelo virtual de y=0.
 */
const downRay = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _eye = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _n = new THREE.Vector3();

export function snapToFloorBelow() {
  camera.getWorldPosition(_eye);
  let floorY = 0;
  if (modelGroup.children.length) {
    downRay.set(_eye, _down);
    downRay.near = 0.02;
    downRay.far = 500;
    for (const hit of downRay.intersectObject(modelGroup, true)) {
      if (!hit.face) continue;
      _nm.getNormalMatrix(hit.object.matrixWorld);
      _n.copy(hit.face.normal).applyMatrix3(_nm).normalize();
      if (_n.y < WALKABLE) continue;      // techo o pared vista desde arriba
      floorY = hit.point.y;
      break;
    }
  }
  camera.position.y = floorY - player.position.y + EYE;
}

/** Cuánto se pide subir (+1) o bajar (−1) con el teclado. */
function riseInput() {
  const up = keys['Space'] || keys['KeyE'] || keys['PageUp'];
  const down = keys['KeyC'] || keys['KeyQ'] || keys['PageDown'];
  return (up ? 1 : 0) - (down ? 1 : 0);
}

// Orbitando también se sube y se baja: se lleva la cámara y su punto de mira a la vez, que
// es lo que hace falta para mirar la planta de arriba sin perder el encuadre.
onFrame((dt, presenting) => {
  if (presenting || S.get('mode') === 'walk') return;
  const rise = riseInput();
  if (!rise) return;
  // Proporcional a lo lejos que estés: a un metro de la maqueta, 2 m/s la perdería de vista.
  const step = rise * camera.position.distanceTo(controls.target) * 0.7 * dt;
  camera.position.y += step;
  controls.target.y += step;
});

onFrame((dt, presenting) => {
  if (presenting || S.get('mode') !== 'walk' || !walk.isLocked) return;
  let speed = 2.2 * dt;
  if (keys['ShiftLeft'] || keys['ShiftRight']) speed *= 4;
  if (keys['KeyW'] || keys['ArrowUp']) walk.moveForward(speed);
  if (keys['KeyS'] || keys['ArrowDown']) walk.moveForward(-speed);
  if (keys['KeyA'] || keys['ArrowLeft']) walk.moveRight(-speed);
  if (keys['KeyD'] || keys['ArrowRight']) walk.moveRight(speed);
  // Subir y bajar: Espacio/C, o Q/E y AvPág/RePág para quien tenga esa costumbre.
  camera.position.y += riseInput() * speed;
});

// ---------- Reacciones al estado ----------

S.on('exposure', v => { renderer.toneMappingExposure = v; });
