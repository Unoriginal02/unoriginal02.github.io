// Sesión WebXR: mandos, manos, desplazamiento y teletransporte.
//
// Reparto de botones (Quest 2):
//   gatillo (trigger)  → puntero: pulsa el panel de muñeca, o teletransporta al suelo
//   agarre  (grip)     → coger el modelo; con los dos a la vez, escalar y girar
//   stick izquierdo    → andar          stick derecho → giro a saltos de 30°
// Con hand tracking (sin mandos), el pellizco hace de puntero y de agarre.

import * as THREE from 'three';
import { renderer, scene, camera, player, onFrame, standInFrontOfModel, controls } from './viewer.js';
import * as S from './state.js';

const UP = new THREE.Vector3(0, 1, 0);
const DEADZONE = 0.15;
const JOINTS = 25;

export const events = new EventTarget();
export const inputs = [];

function emit(type, input) { events.dispatchEvent(new CustomEvent(type, { detail: { input } })); }

// ---------- Construcción de mandos y manos ----------

const rayGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1),
]);

function buildInput(index) {
  const controller = renderer.xr.getController(index);
  const grip = renderer.xr.getControllerGrip(index);
  const hand = renderer.xr.getHand(index);

  const ray = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({
    color: 0x5b8cff, transparent: true, opacity: 0.85,
  }));
  ray.scale.z = 5;
  ray.visible = false;
  controller.add(ray);

  // Proxy del mando: un cilindro pequeño. Evita depender de los modelos de mando
  // remotos, que en Quest tardan o fallan según la conexión.
  const proxy = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.018, 0.06, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x30343f, roughness: 0.6, metalness: 0.1 })
  );
  proxy.rotation.x = -Math.PI / 3;
  proxy.visible = false;
  grip.add(proxy);

  const jointDots = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshStandardMaterial({ color: 0xd8dbe4, roughness: 0.8 }),
    JOINTS
  );
  jointDots.frustumCulled = false;
  jointDots.visible = false;
  hand.add(jointDots);

  player.add(controller, grip, hand);

  const input = {
    index, controller, grip, hand, ray, proxy, jointDots,
    handedness: index === 0 ? 'left' : 'right',
    isHand: false, connected: false,
    pointing: false, grabbing: false,
    pointerConsumed: false,
    gamepad: null,
  };

  controller.addEventListener('connected', e => {
    input.connected = true;
    input.handedness = e.data.handedness === 'none' ? input.handedness : e.data.handedness;
    input.isHand = !!e.data.hand;
    input.gamepad = e.data.gamepad || null;
    input.ray.visible = !input.isHand;
    input.proxy.visible = !input.isHand;
  });
  controller.addEventListener('disconnected', () => {
    input.connected = false;
    input.gamepad = null;
    input.ray.visible = false;
    input.proxy.visible = false;
    input.jointDots.visible = false;
    if (input.pointing) { input.pointing = false; emit('point-end', input); }
    if (input.grabbing) { input.grabbing = false; emit('grab-end', input); }
  });

  // Mando físico: gatillo = puntero, agarre = coger.
  controller.addEventListener('selectstart', () => { if (!input.isHand) startPoint(input); });
  controller.addEventListener('selectend',   () => { if (!input.isHand) endPoint(input); });
  controller.addEventListener('squeezestart', () => { if (!input.isHand) startGrab(input); });
  controller.addEventListener('squeezeend',   () => { if (!input.isHand) endGrab(input); });

  // Manos: el pellizco es puntero Y agarre. Se lanza primero el puntero para que el
  // panel pueda quedárselo antes de que el agarre mueva el modelo sin querer.
  hand.addEventListener('pinchstart', () => { startPoint(input); startGrab(input); });
  hand.addEventListener('pinchend',   () => { endGrab(input); endPoint(input); });

  return input;
}

function startPoint(input) { input.pointing = true; input.pointerConsumed = false; emit('point-start', input); }
function endPoint(input) {
  if (!input.pointing) return;
  input.pointing = false;
  emit('point-end', input);
  // Se limpia DESPUÉS de avisar: quien escuche todavía necesita saber si el panel se
  // quedó el gesto. Y hay que limpiarlo, o el agarre de ese mando se queda muerto hasta
  // el siguiente disparo al aire.
  input.pointerConsumed = false;
}
function startGrab(input)  { input.grabbing = true; emit('grab-start', input); }
function endGrab(input)    { if (!input.grabbing) return; input.grabbing = false; emit('grab-end', input); }

inputs.push(buildInput(0), buildInput(1));

export function inputByHand(handedness) {
  return inputs.find(i => i.connected && i.handedness === handedness) || null;
}

// ---------- Puntos de las manos ----------

const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
const _dummy = new THREE.Object3D();

function updateHandDots(input) {
  const joints = input.hand.joints;
  if (!input.isHand || !joints || !joints['wrist']) { input.jointDots.visible = false; return; }
  input.jointDots.visible = true;
  for (let i = 0; i < JOINTS; i++) {
    const joint = joints[JOINT_NAMES[i]];
    if (!joint) { _dummy.scale.setScalar(0); }
    else {
      _dummy.position.copy(joint.position);
      _dummy.quaternion.copy(joint.quaternion);
      _dummy.scale.setScalar(Math.max(0.004, joint.jointRadius || 0.008));
    }
    _dummy.updateMatrix();
    input.jointDots.setMatrixAt(i, _dummy.matrix);
  }
  input.jointDots.instanceMatrix.needsUpdate = true;
}

// ---------- Teletransporte ----------

const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.16, 0.22, 24),
  new THREE.MeshBasicMaterial({ color: 0x5b8cff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false })
);
marker.rotation.x = -Math.PI / 2;
marker.renderOrder = 5;
marker.visible = false;
scene.add(marker);

const _mat = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Punto del suelo (y=0) al que apunta un mando, o null si no apunta hacia abajo. */
export function floorHit(input, target = new THREE.Vector3()) {
  _mat.identity().extractRotation(input.controller.matrixWorld);
  _origin.setFromMatrixPosition(input.controller.matrixWorld);
  _dir.set(0, 0, -1).applyMatrix4(_mat).normalize();
  if (_dir.y >= -0.05) return null;
  const t = -_origin.y / _dir.y;
  if (t < 0.2 || t > 60) return null;
  return target.copy(_origin).addScaledVector(_dir, t);
}

export function teleportTo(point) {
  const head = camera.getWorldPosition(new THREE.Vector3());
  player.position.x += point.x - head.x;
  player.position.z += point.z - head.z;
}

// Al soltar el gatillo se salta al punto marcado. Si el panel se quedó el gesto, o si
// estabas agarrando el modelo, no hay teletransporte.
const _land = new THREE.Vector3();
events.addEventListener('point-end', e => {
  const input = e.detail.input;
  if (input.isHand || input.pointerConsumed || input.grabbing) return;
  if (floorHit(input, _land)) teleportTo(_land);
});

// ---------- Desplazamiento con los sticks ----------

let snapReady = true;
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _before = new THREE.Vector3();
const _after = new THREE.Vector3();

function snapTurn(angle) {
  // Girar alrededor de la cabeza, no del origen de la plataforma: si no, te desplazas.
  camera.getWorldPosition(_before);
  player.rotateY(angle);
  player.updateMatrixWorld(true);
  camera.getWorldPosition(_after);
  player.position.add(_before.sub(_after));
}

function readStick(input) {
  const axes = input.gamepad?.axes;
  if (!axes || !axes.length) return null;
  const x = axes.length > 2 ? axes[2] : axes[0];
  const y = axes.length > 3 ? axes[3] : axes[1];
  return { x: x || 0, y: y || 0 };
}

function updateLocomotion(dt) {
  let move = null, turn = 0;
  for (const input of inputs) {
    if (!input.connected || input.isHand) continue;
    const stick = readStick(input);
    if (!stick) continue;
    if (input.handedness === 'right') turn = stick.x;
    else move = stick;
  }

  if (move && (Math.abs(move.x) > DEADZONE || Math.abs(move.y) > DEADZONE)) {
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.crossVectors(_fwd, UP).normalize();
    const speed = 2.2;
    player.position.addScaledVector(_fwd, -move.y * speed * dt);
    player.position.addScaledVector(_right, move.x * speed * dt);
  }

  if (Math.abs(turn) > 0.7) {
    if (snapReady) { snapTurn(turn > 0 ? -Math.PI / 6 : Math.PI / 6); snapReady = false; }
  } else if (Math.abs(turn) < 0.3) {
    snapReady = true;
  }
}

// ---------- Bucle ----------

const _hit = new THREE.Vector3();

onFrame((dt, presenting) => {
  if (!presenting) { marker.visible = false; return; }
  updateLocomotion(dt);

  let showMarker = false;
  for (const input of inputs) {
    if (!input.connected) continue;
    updateHandDots(input);
    if (input.isHand || !input.pointing || input.pointerConsumed || input.grabbing) continue;
    if (floorHit(input, _hit)) {
      marker.position.copy(_hit);
      marker.position.y += 0.01;
      showMarker = true;
    }
  }
  marker.visible = showMarker;
});

// ---------- Sesión ----------

let session = null;

export async function initXRButton(button) {
  if (!navigator.xr) {
    button.textContent = 'VR no disponible';
    button.title = 'Este navegador no expone WebXR. Necesitas HTTPS y un navegador con soporte.';
    return;
  }
  let supported = false;
  try { supported = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* ignora */ }
  if (!supported) {
    button.textContent = 'VR no soportada';
    button.title = 'No hay visor disponible. En Quest, abre esta página en el navegador del propio visor.';
    return;
  }
  button.disabled = false;
  button.textContent = 'Entrar en VR';
  button.onclick = () => (session ? session.end() : enterVR(button));
}

async function enterVR(button) {
  try {
    button.disabled = true;
    renderer.xr.setFramebufferScaleFactor(S.quality().framebuffer);
    const s = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
    });
    await renderer.xr.setSession(s);
  } catch (err) {
    button.textContent = 'Entrar en VR';
    console.error(err);
  } finally {
    button.disabled = false;
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  session = renderer.xr.getSession();
  // Foveación fija: en Quest 2 es lo que separa ir a 72 fps de ir a tirones.
  try { renderer.xr.setFoveation(S.quality().foveation); } catch { /* no soportado */ }
  controls.enabled = false;
  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  standInFrontOfModel();
  S.set({ presenting: true });
  session.addEventListener('end', () => {
    session = null;
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
    marker.visible = false;
    controls.enabled = S.get('mode') === 'orbit';
    S.set({ presenting: false });
  });
});

export function xrButtonLabel() { return session ? 'Salir de VR' : 'Entrar en VR'; }
S.on('presenting', () => {
  const btn = document.getElementById('xrBtn');
  if (btn && !btn.disabled) btn.textContent = xrButtonLabel();
});
