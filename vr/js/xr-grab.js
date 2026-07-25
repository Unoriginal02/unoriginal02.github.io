// Coger el modelo con las manos.
//
// Una mano  → el modelo sigue la mano (posición y giro).
// Dos manos → además, la distancia entre manos escala y el vector entre ellas gira,
//             igual que un "pinch-zoom" pero en 3D.
//
// Se trabaja con matrices: en el momento de agarrar se guarda la matriz del modelo y la
// de las manos; cada fotograma se aplica el DELTA. Así no hay que reparentar nada y las
// dos manos se combinan sin pelearse.

import * as THREE from 'three';
import { modelGroup, onFrame } from './viewer.js';
import { events, inputs } from './xr.js';
import * as S from './state.js';

const MIN_SCALE = 0.01;
const MAX_SCALE = 400;

let active = [];               // inputs agarrando ahora mismo
let startModel = new THREE.Matrix4();
let startA = new THREE.Matrix4();
let startB = new THREE.Matrix4();
let startCenter = new THREE.Vector3();
let startSpan = new THREE.Vector3();
let startDistance = 1;
let baseScale = 1;

const onRelease = new Set();
/** Avisa cuando se suelta el modelo (para rehornear la sombra de contacto). */
export function onGrabRelease(fn) { onRelease.add(fn); return () => onRelease.delete(fn); }

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _center = new THREE.Vector3();
const _span = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _rot = new THREE.Quaternion();
const _scl = new THREE.Vector3();

function handMatrix(input) {
  // Con mando se usa el agarre (la empuñadura); con la mano, la muñeca.
  const source = input.isHand ? (input.hand.joints?.['wrist'] || input.hand) : input.grip;
  source.updateMatrixWorld();
  return source.matrixWorld;
}

function beginGrab() {
  if (!active.length || !modelGroup.children.length) return;
  modelGroup.updateMatrixWorld(true);
  startModel.copy(modelGroup.matrix);
  baseScale = modelGroup.scale.x;

  startA.copy(handMatrix(active[0]));
  if (active.length > 1) {
    startB.copy(handMatrix(active[1]));
    _a.setFromMatrixPosition(startA);
    _b.setFromMatrixPosition(startB);
    startCenter.addVectors(_a, _b).multiplyScalar(0.5);
    startSpan.subVectors(_b, _a);
    startDistance = Math.max(1e-4, startSpan.length());
  }
  S.set({ grabbing: true });
}

function updateGrab() {
  if (!active.length) return;

  if (active.length === 1) {
    // delta = manoAhora * manoInicio⁻¹
    _m.copy(handMatrix(active[0]));
    _inv.copy(startA).invert();
    _m.multiply(_inv);
    _m.multiply(startModel);
  } else {
    _a.setFromMatrixPosition(handMatrix(active[0]));
    _b.setFromMatrixPosition(handMatrix(active[1]));
    _center.addVectors(_a, _b).multiplyScalar(0.5);
    _span.subVectors(_b, _a);
    const distance = Math.max(1e-4, _span.length());

    let scale = distance / startDistance;
    const target = THREE.MathUtils.clamp(baseScale * scale, MIN_SCALE, MAX_SCALE);
    scale = target / baseScale;

    _q.setFromUnitVectors(startSpan.clone().normalize(), _span.clone().normalize());

    // T(centroAhora) · R · S · T(-centroInicio) · modeloInicial
    _m.makeTranslation(_center.x, _center.y, _center.z);
    _m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(_q));
    _m.multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
    _m.multiply(new THREE.Matrix4().makeTranslation(-startCenter.x, -startCenter.y, -startCenter.z));
    _m.multiply(startModel);
  }

  _m.decompose(_pos, _rot, _scl);
  modelGroup.position.copy(_pos);
  modelGroup.quaternion.copy(_rot);
  modelGroup.scale.setScalar(THREE.MathUtils.clamp(_scl.x, MIN_SCALE, MAX_SCALE));
}

events.addEventListener('grab-start', e => {
  const input = e.detail.input;
  // Si el puntero ya lo ha consumido (has pulsado el panel), no se agarra.
  if (input.pointerConsumed) return;
  if (active.includes(input)) return;
  active.push(input);
  beginGrab();
});

events.addEventListener('grab-end', e => {
  const input = e.detail.input;
  const i = active.indexOf(input);
  if (i === -1) return;
  active.splice(i, 1);
  if (active.length) {
    beginGrab();               // reengancha con la mano que queda
  } else {
    S.set({ grabbing: false });
    for (const fn of onRelease) fn();
  }
});

onFrame((dt, presenting) => {
  if (!presenting) { if (active.length) { active = []; S.set({ grabbing: false }); } return; }
  updateGrab();
});

/** Devuelve el modelo a su sitio: centrado, apoyado en el suelo y a escala 1. */
export function resetTransform() {
  modelGroup.position.set(0, 0, 0);
  modelGroup.quaternion.identity();
  modelGroup.scale.setScalar(1);
  active = [];
  S.set({ grabbing: false });
  for (const fn of onRelease) fn();
}

export function isGrabbing() { return active.length > 0; }
export function grabbingInputs() { return active; }
export { inputs };
