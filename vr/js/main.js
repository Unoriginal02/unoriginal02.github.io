// Arranque y orquestación: qué pasa exactamente cuando se carga un modelo.

import * as THREE from 'three';
import * as S from './state.js';
import {
  renderer, scene, camera, modelGroup, mount, fitView, setMode, modelBox,
} from './viewer.js';
import { fitLights, bakeGroundShadows, setGroundShadowsVisible } from './lighting.js';
import { applyMaterials, setCurrent } from './clay.js';
import { bakeVertexAO } from './ao-bake.js';
import { loadModel, disposeModel, extensionOf } from './loaders.js';
import * as Sources from './sources.js';
import * as UI from './ui.js';
import { initXRButton } from './xr.js';
import { onGrabRelease, resetTransform } from './xr-grab.js';
import * as Panel from './xr-panel.js';
import { rootFolder } from './sources.js';

// ---------- Fuente de modelos: la carpeta del repositorio ----------

let stack = [];             // [{ path, name }] — carpeta raíz y subcarpetas abiertas
let items = [];
let listError = '';
let currentEntry = null;
let currentObject = null;
let loading = false;

/** Lo que ve el panel de dentro de VR: lo mismo, más una fila para retroceder. */
function vrEntries() {
  const usable = items.filter(e => e.supported !== false);
  return stack.length > 1
    ? [{ id: 'up', kind: 'up', name: '⬅  Atrás', sub: stack[stack.length - 2].name, supported: true }, ...usable]
    : usable;
}

function refreshList() {
  UI.setCrumbs(stack.map((f, i) => (i ? ' / ' : '') + `<b>${f.name}</b>`).join(''));
  UI.setBackVisible(stack.length > 1);
  UI.renderList(items, {
    onPick: pick,
    emptyHtml: listError
      ? `<b>No se ha podido leer la lista</b><br><br>${listError}`
      : `La carpeta <code>${stack[stack.length - 1]?.path || rootFolder()}</code> está vacía.` +
        '<br><br>Sube tus modelos ahí en github.com y pulsa ↻.',
  });
  Panel.refresh();
}

function pick(item) {
  if (item.kind === 'dir') { stack.push({ path: item.path, name: item.name }); openFolder(); return; }
  if (item.kind === 'up') { goUp(); return; }
  load(item);
}

function goUp() {
  if (stack.length <= 1) return;
  stack.pop();
  openFolder();
}

/** Lee la carpeta que esté arriba de la pila. */
async function openFolder() {
  if (!stack.length) stack = [{ path: rootFolder(), name: rootFolder() }];
  const folder = stack[stack.length - 1];
  Panel.resetScroll();
  UI.status('Leyendo la lista de modelos…', 'load');
  try {
    items = await Sources.listFolder(folder.path);
    listError = '';
    UI.status('');
  } catch (err) {
    console.error(err);
    items = [];
    listError = err.message;
    UI.status(err.message, 'err');
  }
  refreshList();
}

// ---------- Carga ----------

async function load(entry) {
  if (loading) return;
  loading = true;
  currentEntry = entry;
  S.set({ activeId: entry.id });
  UI.status(`Cargando ${entry.name}…`, 'load');

  try {
    const source = await Sources.resolve(entry, f => {
      UI.status(`Descargando ${entry.name}…`, 'load', f);
    });
    UI.status(`Procesando ${entry.name}…`, 'load');
    const object = await loadModel(source, renderer, f => {
      UI.status(`Cargando ${entry.name}…`, 'load', f);
    });
    await install(object, entry);
    UI.status(`${entry.name} · listo`, 'ok');
  } catch (err) {
    console.error(err);
    UI.status(`No se pudo cargar ${entry.name}: ${err.message}`, 'err');
    S.set({ activeId: null });
  } finally {
    loading = false;
  }
}

/** Coloca el modelo, aplica materiales y lanza los dos horneados. */
async function install(object, entry) {
  if (currentObject) {
    modelGroup.remove(currentObject);
    disposeModel(currentObject);
  }
  modelGroup.position.set(0, 0, 0);
  modelGroup.quaternion.identity();
  modelGroup.scale.setScalar(1);

  currentObject = object;
  placeOnFloor(object, S.get('realScale'));
  modelGroup.add(object);
  setCurrent(object);
  applyMaterials(object);

  S.set({ modelName: entry.name, aoAvailable: false });
  fitView();
  fitLights();
  bakeGroundShadows();

  // La AO se hornea después de mostrar el modelo: se ve enseguida y va apareciendo
  // el detalle en los recovecos, en vez de esperar con la pantalla en blanco.
  const q = S.quality();
  const baked = await bakeVertexAO(object, renderer, {
    directions: q.aoDirs,
    size: q.aoSize,
    onProgress: f => UI.status('Calculando oclusión ambiental…', 'load', f),
  });
  S.set({ aoAvailable: baked });
  if (!baked) UI.status('Modelo demasiado denso para hornear la AO: se usa solo la luz de estudio.', 'ok');
}

/** Normaliza tamaño (o no, en 1:1), centra en horizontal y apoya en el suelo. */
function placeOnFloor(object, realScale) {
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.scale.setScalar(1);
  object.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = realScale ? 1 : 1.5 / maxDim;
  object.scale.setScalar(scale);
  object.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(object);
  const center = scaled.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= scaled.min.y;
  object.updateMatrixWorld(true);
}

// ---------- Acciones ----------

function rotate(axis) {
  if (!currentObject) return;
  const v = axis === 'x' ? new THREE.Vector3(1, 0, 0)
          : axis === 'y' ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(0, 0, 1);
  currentObject.rotateOnWorldAxis(v, Math.PI / 2);
  currentObject.updateMatrixWorld(true);

  // Reasentar: al girar, el modelo se sale del suelo o se mete dentro.
  const box = new THREE.Box3().setFromObject(currentObject);
  const center = box.getCenter(new THREE.Vector3());
  currentObject.position.x -= center.x;
  currentObject.position.z -= center.z;
  currentObject.position.y -= box.min.y;
  currentObject.updateMatrixWorld(true);

  fitView();
  fitLights();
  bakeGroundShadows();
}

function fit() {
  if (S.get('presenting')) return;
  fitView();
}

function reset() {
  resetTransform();
  if (currentObject) placeOnFloor(currentObject, S.get('realScale'));
  fitView();
  fitLights();
  bakeGroundShadows();
}

function toggleRealScale() {
  S.set({ realScale: !S.get('realScale') });
  if (!currentObject) return;
  resetTransform();
  placeOnFloor(currentObject, S.get('realScale'));
  fitView();
  fitLights();
  bakeGroundShadows();
}

// ---------- Arranque ----------

const actions = {
  rotate, fit, reset, toggleRealScale, goUp,
  setMode: m => setMode(m),
  reload: () => openFolder(),
  // El panel de VR abre cualquier fila: modelo, subcarpeta o «atrás».
  open: pick,
  load,
};

mount(document.getElementById('canvas-wrap'));
UI.init(actions);
Panel.configure({ actions, getEntries: vrEntries });

// Mientras se agarra el modelo la sombra horneada no vale; se rehornea al soltar.
S.on('grabbing', grabbing => setGroundShadowsVisible(!grabbing && !!currentObject));
onGrabRelease(() => { fitLights(); bakeGroundShadows(); });

S.on('modelName', name => UI.setPlaceholderVisible(!name));

initXRButton(document.getElementById('xrBtn'));

(async () => {
  await openFolder();

  // ?model=<url> para abrir algo suelto que no esté en la carpeta.
  const requested = new URLSearchParams(location.search).get('model');
  if (requested) {
    const entry = Sources.entryFromUrl(requested);
    items = [entry, ...items];
    refreshList();
    load(entry);
  }
  // Sin autocarga: al arrancar se ve la lista y se abre lo que se pulse.
})();
