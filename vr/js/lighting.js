// Iluminación tipo "clay render": entorno de estudio procedural (IBL) + luces reales
// con auto-sombra suave (VSM) + las sombras del suelo HORNEADAS en dos texturas.
//
// Por qué horneadas: un plano cazasombras en tiempo real es justo lo que produce el
// cuadrado negro de bordes rectos (el mapa de sombras se acaba y el corte se ve). Una
// textura se difumina hasta transparente por los cuatro lados, así que no hay borde
// posible. Y como el modelo está quieto, se calcula una vez y en VR sale gratis.

import * as THREE from 'three';
import { renderer, scene, modelGroup, modelBox } from './viewer.js';
import * as S from './state.js';

// ---------- Fondo de estudio ----------

function gradientBackground() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#343943');
  g.addColorStop(0.55, '#1e222a');
  g.addColorStop(1.0, '#0e1014');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
scene.background = gradientBackground();

// ---------- Entorno IBL: una caja de luz de estudio ----------

function studioEnvironment() {
  const env = new THREE.Scene();
  const box = new THREE.BoxGeometry();

  const room = new THREE.Mesh(box, new THREE.MeshStandardMaterial({
    side: THREE.BackSide, color: 0x2b2e34, roughness: 1, metalness: 0,
  }));
  room.scale.set(16, 11, 16);
  env.add(room);

  // El truco de RoomEnvironment: material básico con el color por encima de 1.
  // El PMREM se renderiza en half-float, así que los valores altos sobreviven.
  const panel = (scale, pos, intensity, color = 0xffffff) => {
    const m = new THREE.MeshBasicMaterial();
    m.color.set(color).multiplyScalar(intensity);
    const mesh = new THREE.Mesh(box, m);
    mesh.scale.set(...scale);
    mesh.position.set(...pos);
    env.add(mesh);
  };

  panel([8, 0.2, 8], [0, 5.3, 0], 14);                    // cenital grande (la dominante)
  panel([0.2, 5, 5], [-6.5, 2.0, 2.0], 6.5, 0xfff3e6);    // softbox delantero izq., cálido
  panel([0.2, 4, 6], [6.5, 1.5, -0.5], 2.4, 0xe4edff);    // relleno derecho, frío
  panel([7, 3, 0.2], [0, 2.6, -6.5], 4.0);                // contraluz trasero
  panel([11, 0.2, 11], [0, -5.3, 0], 0.9, 0xd8d2c8);      // rebote del suelo

  return env;
}

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
// El desenfoque máximo que admite el PMREM sin recortar muestras es ~0.04.
const envRT = pmrem.fromScene(studioEnvironment(), 0.035);
scene.environment = envRT.texture;

// ---------- Luces reales ----------

export const key = new THREE.DirectionalLight(0xffffff, 1.9);
key.castShadow = true;                 // solo auto-sombra: el suelo va horneado
key.shadow.blurSamples = 12;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);

export const fill = new THREE.DirectionalLight(0xdce6ff, 0.35);
export const rim = new THREE.DirectionalLight(0xfff0e0, 0.55);
scene.add(fill, fill.target, rim, rim.target);

scene.add(new THREE.HemisphereLight(0xffffff, 0x24272e, 0.22));

// Rejilla de 1 m: la referencia de escala cuando entras en VR a tamaño real.
// toneMapped:false para que el ACES no se la coma sobre el fondo oscuro.
export const grid = new THREE.GridHelper(80, 80, 0x8e9ab8, 0x5c657e);
grid.material.transparent = true;
grid.material.opacity = 0.75;
grid.material.toneMapped = false;
grid.material.depthWrite = false;
grid.position.y = 0.0005;
scene.add(grid);

function applyShadowSize() {
  const px = S.quality().shadowMap;
  if (key.shadow.mapSize.x === px) return;
  key.shadow.mapSize.set(px, px);
  key.shadow.map?.dispose();
  key.shadow.map = null;
}

/** Radio de difuminado en TEXELS del mapa de sombras, no en metros. */
function applySoftness() {
  key.shadow.radius = Math.max(1, S.get('shadowSoftness') * 3);
  key.shadow.needsUpdate = true;
}

export function fitLights() {
  const box = modelBox();
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.5 || 1;

  key.target.position.copy(c);
  key.position.copy(c).add(new THREE.Vector3(-r * 1.6, r * 2.8, r * 1.9));
  fill.target.position.copy(c);
  fill.position.copy(c).add(new THREE.Vector3(r * 2.4, r * 0.9, r * 1.2));
  rim.target.position.copy(c);
  rim.position.copy(c).add(new THREE.Vector3(r * 0.6, r * 1.4, -r * 2.6));

  applyShadowSize();
  applySoftness();
  // Margen del 35 %: encajado clavado al modelo se ve el corte del volumen.
  const half = r * 1.35;
  const cam = key.shadow.camera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
  cam.near = r * 0.2;
  cam.far = r * 9 + 2;
  cam.updateProjectionMatrix();
}

// ---------- Sombras de suelo horneadas ----------

function groundPlane(opacityScale) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, toneMapped: false, color: 0xffffff,
  }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.userData.opacityScale = opacityScale;
  scene.add(mesh);
  return mesh;
}

/** Sombra proyectada de la luz principal: silueta aplastada contra el suelo. */
export const castPlane = groundPlane(0.75);
/** Oscurecimiento de contacto: se aprieta donde la geometría toca el suelo. */
export const contactPlane = groundPlane(1.0);
castPlane.renderOrder = 2;
contactPlane.renderOrder = 3;

// --- material que aplasta la geometría sobre el suelo siguiendo el rayo de luz ---
const flattenMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, side: THREE.DoubleSide,
  depthWrite: false, depthTest: false,
});
const flattenUniforms = {
  uLightDir: { value: new THREE.Vector3(0, -1, 0) },
  uGroundY: { value: 0 },
};
flattenMaterial.onBeforeCompile = shader => {
  shader.uniforms.uLightDir = flattenUniforms.uLightDir;
  shader.uniforms.uGroundY = flattenUniforms.uGroundY;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      uniform vec3 uLightDir; uniform float uGroundY;`)
    .replace('#include <project_vertex>', `
      vec4 flatWorld = modelMatrix * vec4( transformed, 1.0 );
      float flatT = ( flatWorld.y - uGroundY ) / max( 1e-5, -uLightDir.y );
      flatWorld.xz += uLightDir.xz * flatT;
      flatWorld.y = uGroundY;
      vec4 mvPosition = viewMatrix * flatWorld;
      gl_Position = projectionMatrix * mvPosition;`);
};
flattenMaterial.customProgramCacheKey = () => 'flatten-shadow';

// --- material de profundidad para el contacto ---
const contactMaterial = new THREE.MeshDepthMaterial({
  depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide,
});
contactMaterial.transparent = true;
contactMaterial.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace(
    'vec4( vec3( 1.0 - fragCoordZ ), opacity )',
    'vec4( vec3( 0.0 ), pow( 1.0 - fragCoordZ, 1.7 ) * opacity )'
  );
};

// --- desenfoque ---
const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { tMap: { value: null }, uStep: { value: new THREE.Vector2() } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tMap; uniform vec2 uStep; varying vec2 vUv;
    void main() {
      vec4 sum = texture2D(tMap, vUv) * 0.227027;
      sum += (texture2D(tMap, vUv + uStep * 1.3846) + texture2D(tMap, vUv - uStep * 1.3846)) * 0.316216;
      sum += (texture2D(tMap, vUv + uStep * 3.2307) + texture2D(tMap, vUv - uStep * 3.2307)) * 0.070270;
      gl_FragColor = sum;
    }`,
  depthTest: false, depthWrite: false, transparent: true,
}));
const blurScene = new THREE.Scene();
blurScene.add(blurQuad);
const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const pool = { size: 0, a: null, b: null, cast: null, contact: null };

function ensureTargets(size) {
  if (pool.size === size) return;
  for (const k of ['a', 'b', 'cast', 'contact']) pool[k]?.dispose();
  const make = () => {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true,
    });
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;
    return rt;
  };
  pool.a = make(); pool.b = make(); pool.cast = make(); pool.contact = make();
  pool.size = size;
}

function blurInto(from, to, dx, dy) {
  blurQuad.material.uniforms.tMap.value = from.texture;
  blurQuad.material.uniforms.uStep.value.set(dx, dy);
  renderer.setRenderTarget(to);
  renderer.clear();
  renderer.render(blurScene, blurCamera);
}

/** Difumina `rt` sobre sí mismo con N pasadas horizontales + verticales. */
function blurPasses(rt, size, amount, passes) {
  const step = amount / size;
  for (let i = 0; i < passes; i++) {
    const scale = 1 + i;
    blurInto(rt, pool.a, step * scale, 0);
    blurInto(pool.a, rt, 0, step * scale);
  }
}

const _corner = new THREE.Vector3();
const _lightDir = new THREE.Vector3();
const _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
_camera.rotation.x = Math.PI / 2;   // mira hacia arriba desde el suelo

/** Silueta del modelo proyectada sobre y=groundY siguiendo la dirección de la luz. */
function shadowFootprint(box, groundY) {
  _lightDir.copy(key.target.position).sub(key.position).normalize();
  if (_lightDir.y > -0.05) _lightDir.set(0, -1, 0);
  const bounds = new THREE.Box2();
  bounds.makeEmpty();
  for (let i = 0; i < 8; i++) {
    _corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    );
    const t = (_corner.y - groundY) / -_lightDir.y;
    bounds.expandByPoint(new THREE.Vector2(
      _corner.x + _lightDir.x * t,
      _corner.z + _lightDir.z * t
    ));
  }
  return bounds;
}

function renderPass(camera, overrideMaterial, target) {
  const hidden = [];
  for (const child of scene.children) {
    if (child === modelGroup || !child.visible || child.isLight) continue;
    hidden.push(child); child.visible = false;
  }
  const prevBackground = scene.background;
  const prevOverride = scene.overrideMaterial;
  const prevAuto = renderer.shadowMap.autoUpdate;
  scene.background = null;
  scene.overrideMaterial = overrideMaterial;
  renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.shadowMap.autoUpdate = prevAuto;
  scene.overrideMaterial = prevOverride;
  scene.background = prevBackground;
  for (const child of hidden) child.visible = true;
}

function placePlane(plane, texture, centerX, centerZ, width, depth, groundY, lift) {
  plane.material.map = texture;
  plane.material.needsUpdate = true;
  plane.scale.set(width, depth, 1);
  plane.position.set(centerX, groundY + lift, centerZ);
  plane.material.opacity = S.get('contactOpacity') * plane.userData.opacityScale;
  plane.visible = plane.material.opacity > 0.01;
}

/** Hornea las dos sombras de suelo. Cuesta unos milisegundos, una sola vez. */
export function bakeGroundShadows() {
  const box = modelBox();
  if (box.isEmpty()) { castPlane.visible = contactPlane.visible = false; return; }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const groundY = box.min.y;
  const px = S.quality().contact;
  ensureTargets(px);

  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();

  // --- 1. Sombra proyectada ---
  const footprint = shadowFootprint(box, groundY);
  const fpSize = footprint.getSize(new THREE.Vector2());
  const fpCenter = footprint.getCenter(new THREE.Vector2());
  // Margen para que el difuminado no se corte contra el borde de la textura.
  const castExtent = Math.max(fpSize.x, fpSize.y) * 1.45 + 0.05;

  flattenUniforms.uLightDir.value.copy(_lightDir);
  flattenUniforms.uGroundY.value = groundY;
  _camera.position.set(fpCenter.x, groundY - 0.001, fpCenter.y);
  _camera.left = -castExtent / 2; _camera.right = castExtent / 2;
  _camera.top = castExtent / 2; _camera.bottom = -castExtent / 2;
  _camera.near = 0; _camera.far = 0.01;
  _camera.updateProjectionMatrix();
  _camera.updateMatrixWorld(true);
  renderPass(_camera, flattenMaterial, pool.cast);
  blurPasses(pool.cast, px, 2.2, 3);

  // --- 2. Oscurecimiento de contacto ---
  const contactExtent = Math.max(size.x, size.z) * 1.5 + 0.05;
  const height = Math.max(size.y * 0.8, contactExtent * 0.08);
  _camera.position.set(center.x, groundY, center.z);
  _camera.left = -contactExtent / 2; _camera.right = contactExtent / 2;
  _camera.top = contactExtent / 2; _camera.bottom = -contactExtent / 2;
  _camera.near = 0; _camera.far = height;
  _camera.updateProjectionMatrix();
  _camera.updateMatrixWorld(true);
  renderPass(_camera, contactMaterial, pool.contact);
  blurPasses(pool.contact, px, 1.1, 2);

  renderer.setRenderTarget(null);
  renderer.setClearColor(prevClear, prevAlpha);

  const lift = Math.max(0.0015, Math.max(size.x, size.z) * 0.0008);
  placePlane(castPlane, pool.cast.texture, fpCenter.x, fpCenter.y, castExtent, castExtent, groundY, lift);
  placePlane(contactPlane, pool.contact.texture, center.x, center.z, contactExtent, contactExtent, groundY, lift * 2);
}

export function setGroundShadowsVisible(visible) {
  const on = visible && S.get('contactOpacity') > 0.01 && !!pool.cast;
  castPlane.visible = on && !!castPlane.material.map;
  contactPlane.visible = on && !!contactPlane.material.map;
}

// ---------- Reacciones al estado ----------

S.on('contactOpacity', v => {
  for (const plane of [castPlane, contactPlane]) {
    plane.material.opacity = v * plane.userData.opacityScale;
    plane.visible = !!plane.material.map && plane.material.opacity > 0.01;
  }
});
S.on('shadowSoftness', applySoftness);
S.on('grid', v => { grid.visible = v; });
S.on('quality', () => { applyShadowSize(); fitLights(); bakeGroundShadows(); });
