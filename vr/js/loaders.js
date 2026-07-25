// Carga de formatos. Se admiten Draco, Meshopt y KTX2 porque la mayoría de .glb
// reales vienen comprimidos y, sin ellos, fallan sin explicar por qué.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ensureAOAttribute } from './ao-bake.js';

const THREE_CDN = 'https://unpkg.com/three@0.170.0/examples/jsm/libs/';

let gltfLoader = null;
function gltf(renderer) {
  if (gltfLoader) return gltfLoader;
  const draco = new DRACOLoader().setDecoderPath(THREE_CDN + 'draco/gltf/');
  const ktx2 = new KTX2Loader().setTranscoderPath(THREE_CDN + 'basis/').detectSupport(renderer);
  gltfLoader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader;
}

export function extensionOf(name) {
  return (name.split('?')[0].split('.').pop() || '').toLowerCase();
}

function defaultMesh(geometry) {
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xc3c8d2, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide,
  }));
}

/**
 * @param {{name:string, url?:string, buffer?:ArrayBuffer}} source
 * @param {THREE.WebGLRenderer} renderer
 * @param {(fraction:number)=>void} onProgress
 * @returns {Promise<THREE.Object3D>}
 */
export async function loadModel(source, renderer, onProgress = () => {}) {
  const ext = extensionOf(source.name);
  let object;

  if (ext === 'glb' || ext === 'gltf') {
    const loader = gltf(renderer);
    let result;
    if (source.url) {
      // Por URL se resuelven los .bin y las texturas relativas de un .gltf suelto.
      result = await loader.loadAsync(source.url, e => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      });
    } else {
      const base = source.name.endsWith('.gltf') ? './' : '';
      result = await loader.parseAsync(source.buffer, base);
    }
    object = result.scene || result.scenes?.[0];
    object.userData.animations = result.animations || [];
  } else {
    const buffer = source.buffer ?? await (await fetch(source.url)).arrayBuffer();
    if (ext === 'stl') {
      object = defaultMesh(new STLLoader().parse(buffer));
    } else if (ext === 'ply') {
      object = defaultMesh(new PLYLoader().parse(buffer));
    } else if (ext === 'obj') {
      object = new OBJLoader().parse(new TextDecoder().decode(buffer));
      object.traverse(o => {
        if (o.isMesh && (!o.material || !o.material.map)) {
          o.material = new THREE.MeshStandardMaterial({
            color: 0xc3c8d2, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide,
          });
        }
      });
    } else {
      throw new Error(`formato «.${ext}» no soportado`);
    }
  }

  if (!object) throw new Error('el archivo no contiene ninguna escena');
  prepareModel(object);
  return object;
}

/** Normales, sombras y el atributo de AO en blanco (si falta, el shader pintaría negro). */
export function prepareModel(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = true;
    const geo = o.geometry;
    if (geo && !geo.attributes.normal) geo.computeVertexNormals();
  });
  ensureAOAttribute(root);
  return root;
}

/**
 * Libera geometrías, materiales y texturas de un modelo descartado.
 * Ojo: el material de arcilla se comparte entre modelos y lleva `userData.shared`,
 * así que hay que saltárselo o el siguiente modelo se queda sin material.
 */
export function disposeModel(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.geometry?.dispose();
    const owned = [].concat(o.userData.originalMaterial ?? o.material);
    for (const m of owned) {
      if (!m || m.userData?.shared) continue;
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
