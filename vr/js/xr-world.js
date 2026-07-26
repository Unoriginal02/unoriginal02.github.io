// Navegación: se agarra el MUNDO, no el modelo.
//
// Una mano  → te arrastras por el escenario: el punto que agarraste se queda pegado a la
//             mano, así que tirar hacia ti es acercarte.
// Dos manos → además te escalas y giras: separar las manos agranda el mundo (o sea, te
//             hace pequeño), juntarlas te hace gigante.
//
// Lo que se mueve es la plataforma del jugador, nunca el modelo. El modelo se queda
// clavado donde está —con sus sombras horneadas intactas— y lo que cambia es dónde estás
// y de qué tamaño eres. Por eso ya no hace falta rehornear nada al soltar.
//
// El arrastre a una mano es en las tres direcciones, la vertical incluida: tirando hacia
// abajo te izas, que es la forma de subir a la planta de arriba sin soltar el mundo.
// Escalarse a dos manos, en cambio, mantiene la altura: si al ponerte a escala te subiera
// o te bajara, el suelo real y el virtual dejarían de coincidir y no podrías andar.
//
// La altura vive en `player.position.y`, el plano del suelo bajo tus pies. «Reiniciar» en
// el panel te devuelve al suelo virtual (y = 0).

import * as THREE from 'three';
import { player, onFrame, standInFrontOfModel } from './viewer.js';
import { events, reportElevation } from './xr.js';
import * as S from './state.js';

const MIN_SCALE = 0.02;    // ~3 cm de alto: dentro de una maqueta
const MAX_SCALE = 60;      // gigante mirando la maqueta desde arriba

let active = [];           // inputs agarrando ahora mismo
let startScale = 1;
let startYaw = 0;
let startElevation = 0;    // altura al empezar el gesto: escalarse no debe cambiarla
const startA = new THREE.Vector3();
const startB = new THREE.Vector3();
const startAnchor = new THREE.Vector3();   // punto del MUNDO que se agarró
let startSpanAngle = 0;
let startSpanLength = 1;

const _handA = new THREE.Vector3();
const _handB = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _span = new THREE.Vector3();
const _world = new THREE.Vector3();

/** Posición de una mano en coordenadas de la plataforma (no del mundo). */
function localHand(input, target) {
  const source = input.isHand ? (input.hand.joints?.['wrist'] || input.hand) : input.grip;
  return target.copy(source.position);
}

/** Punto del mundo que hay bajo una posición local, con la plataforma tal como está. */
function toWorld(local, target) {
  return target.copy(local).multiplyScalar(player.scale.x).applyQuaternion(player.quaternion).add(player.position);
}

/** Ángulo horizontal de un vector, para girar solo en el eje vertical. */
const yawOf = (v) => Math.atan2(v.x, v.z);

function begin() {
  if (!active.length) return;
  startScale = player.scale.x;
  startYaw = player.rotation.y;
  startElevation = player.position.y;

  localHand(active[0], startA);
  if (active.length === 1) {
    toWorld(startA, startAnchor);
  } else {
    localHand(active[1], startB);
    _mid.addVectors(startA, startB).multiplyScalar(0.5);
    toWorld(_mid, startAnchor);
    _span.subVectors(startB, startA);
    startSpanLength = Math.max(1e-4, _span.length());
    startSpanAngle = yawOf(_span);
  }
  S.set({ grabbing: true });
}

function update() {
  if (!active.length) return;

  if (active.length === 1) {
    // Escala y giro se quedan como están: solo te desplazas.
    localHand(active[0], _handA);
    _world.copy(_handA).multiplyScalar(player.scale.x).applyQuaternion(player.quaternion);
    player.position.subVectors(startAnchor, _world);
    reportElevation();
    return;
  }

  localHand(active[0], _handA);
  localHand(active[1], _handB);
  _mid.addVectors(_handA, _handB).multiplyScalar(0.5);
  _span.subVectors(_handB, _handA);

  // Las manos separadas el doble = el mundo el doble de grande = tú, la mitad.
  const length = Math.max(1e-4, _span.length());
  const scale = THREE.MathUtils.clamp(startScale * startSpanLength / length, MIN_SCALE, MAX_SCALE);
  // Y el vector entre las manos tiene que seguir apuntando al mismo sitio del mundo.
  // Solo eje vertical: inclinar el horizonte marea y no sirve para nada.
  player.rotation.set(0, startYaw + startSpanAngle - yawOf(_span), 0);
  player.scale.setScalar(scale);

  // El punto medio entre las manos se queda donde estaba: es el centro del gesto. En
  // vertical no, a propósito: escalarse mantiene la altura con la que entraste al gesto, o
  // ponerse a escala para andar de verdad te dejaría flotando sobre el suelo de la sala.
  _world.copy(_mid).multiplyScalar(scale).applyQuaternion(player.quaternion);
  player.position.set(startAnchor.x - _world.x, startElevation, startAnchor.z - _world.z);

  S.set({ playerScale: scale });
}

events.addEventListener('grab-start', e => {
  const input = e.detail.input;
  if (S.get('worldLock')) return;                       // mundo fijo: no se agarra nada
  if (input.pointing && input.pointerConsumed) return;  // estás pulsando el panel
  if (active.includes(input)) return;
  active.push(input);
  begin();
});

events.addEventListener('grab-end', e => {
  const i = active.indexOf(e.detail.input);
  if (i === -1) return;
  active.splice(i, 1);
  if (active.length) begin();          // reengancha con la mano que queda
  else S.set({ grabbing: false });
});

onFrame((dt, presenting) => {
  if (!presenting) {
    if (active.length) { active = []; S.set({ grabbing: false }); }
    return;
  }
  if (active.length) update();
});

// Al bloquear el mundo se suelta lo que hubiera agarrado.
S.on('worldLock', locked => {
  if (!locked || !active.length) return;
  active = [];
  S.set({ grabbing: false });
});

/** Te devuelve a tamaño real y de pie delante del modelo. */
export function resetPlayer() {
  active = [];
  player.scale.setScalar(1);
  standInFrontOfModel();
  S.set({ grabbing: false, playerScale: 1, elevation: 0 });
}

export function isGrabbing() { return active.length > 0; }
