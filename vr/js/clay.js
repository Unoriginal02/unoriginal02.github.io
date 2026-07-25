// Material de arcilla y conmutación con los materiales originales del archivo.
//
// La AO horneada se inyecta en el shader como atributo `aAO` y se aplica SOLO a la luz
// indirecta (igual que un aoMap de verdad), no al albedo: así los recovecos se oscurecen
// sin que el modelo parezca pintado de gris.

import * as THREE from 'three';
import * as S from './state.js';

/** Uniforms compartidos por todos los materiales parcheados. */
export const shared = {
  aoStrength: { value: S.get('ao') ? S.get('aoStrength') : 0 },
  rimStrength: { value: 0.16 },
  rimColor: { value: new THREE.Color(0x9fb4d8) },
};

const patched = new WeakSet();

/** Añade AO por vértice + un realce de silueta al shader de un material estándar. */
export function patchMaterial(material) {
  if (!material || patched.has(material)) return material;
  patched.add(material);
  const prev = material.onBeforeCompile;

  material.onBeforeCompile = (shader, rendererRef) => {
    prev?.call(material, shader, rendererRef);
    shader.uniforms.uAOStrength = shared.aoStrength;
    shader.uniforms.uRimStrength = shared.rimStrength;
    shader.uniforms.uRimColor = shared.rimColor;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aAO;\nvarying float vAO;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvAO = aAO;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uAOStrength; uniform float uRimStrength; uniform vec3 uRimColor;
        varying float vAO;`)
      // La AO atenúa la luz ambiental/IBL, como el chunk <aomap_fragment> nativo.
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float bakedAO = mix( 1.0, clamp( vAO, 0.0, 1.0 ), uAOStrength );
        reflectedLight.indirectDiffuse *= bakedAO;
        reflectedLight.indirectSpecular *= bakedAO;
        reflectedLight.directDiffuse *= mix( 1.0, bakedAO, 0.35 );`)
      // Realce de borde: separa la silueta del fondo, como en un render de arcilla.
      .replace('#include <opaque_fragment>', `
        float rimF = 1.0 - clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 );
        outgoingLight += pow( rimF, 3.0 ) * uRimStrength * uRimColor * bakedAO;
        #include <opaque_fragment>`);
  };

  material.customProgramCacheKey = () => 'clay-ao-rim';
  material.needsUpdate = true;
  return material;
}

export const clayMaterial = patchMaterial(new THREE.MeshStandardMaterial({
  color: S.get('clayColor'),
  roughness: 0.97,
  metalness: 0.0,
  envMapIntensity: 0.65,
  side: THREE.DoubleSide,
  flatShading: false,
}));
// Bandera para que disposeModel() no destruya un material compartido entre modelos.
clayMaterial.userData.shared = true;

let current = null;

/** Guarda los materiales originales y activa/desactiva la arcilla. */
export function applyMaterials(root = current) {
  current = root;
  if (!root) return;
  const clay = S.get('clay');
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.userData.originalMaterial === undefined) {
      o.userData.originalMaterial = o.material;
      // Los materiales del archivo también reciben AO y realce de borde.
      for (const m of [].concat(o.material)) if (m?.isMeshStandardMaterial) patchMaterial(m);
    }
    o.material = clay ? clayMaterial : o.userData.originalMaterial;
  });
  applyWireframe(root);
}

export function applyWireframe(root = current) {
  if (!root) return;
  const wire = S.get('wire');
  clayMaterial.wireframe = wire;
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m) m.wireframe = wire;
  });
}

export function setCurrent(root) { current = root; }

// ---------- Reacciones al estado ----------

S.on('clay', () => applyMaterials());
S.on('wire', () => applyWireframe());
S.on('clayColor', hex => clayMaterial.color.set(hex));
S.on(['ao', 'aoStrength'], () => {
  shared.aoStrength.value = S.get('ao') ? S.get('aoStrength') : 0;
});
