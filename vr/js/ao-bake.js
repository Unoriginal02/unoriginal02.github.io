// Oclusión ambiental horneada por vértice.
//
// En lugar de calcular la AO cada fotograma con un postproceso (que es lo que hacía el
// GTAOPass, imposible en estéreo y origen del rectángulo negro), la calculamos UNA vez
// al cargar el modelo y la guardamos en un atributo del propio malla.
//
// Método: se renderiza el modelo en profundidad desde N direcciones repartidas por la
// esfera; para cada vértice se comprueba en cuántas de esas direcciones "ve el cielo",
// ponderando por el coseno respecto a su normal. Es una AO de hemisferio de verdad.

import * as THREE from 'three';
import { nextFrame, offscreen } from './viewer.js';

// Desempaquetado de packDepthToRGBA(): el canal R lleva los bits ALTOS y el A los
// bajos. Invertir el orden hace que casi todo dé "ocluido" y el modelo salga negro.
function unpackDepth(px, o) {
  return (px[o] * 16777216 + px[o + 1] * 65536 + px[o + 2] * 256 + px[o + 3]) / 4294967296;
}

/** Direcciones casi uniformes sobre la esfera (espiral de Fibonacci). */
function fibonacciSphere(n) {
  const dirs = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    dirs.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return dirs;
}

// Nota: la espera entre pasadas va por el bucle del visor (viewer.nextFrame), no por
// requestAnimationFrame: dentro de VR el de la ventana no se dispara y esto se colgaría.

/**
 * @param {THREE.Object3D} root     modelo ya colocado en la escena
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} opts  { directions, size, strength, onProgress, maxVertices }
 * @returns {Promise<boolean>} true si se ha horneado
 */
export async function bakeVertexAO(root, renderer, opts = {}) {
  const {
    directions = 32,
    size = 512,
    onProgress = () => {},
    maxVertices = 2_000_000,
  } = opts;

  root.updateMatrixWorld(true);

  const meshes = [];
  let totalVerts = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (o.isSkinnedMesh) return;                  // la pose se calcula en la GPU: no sirve
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    meshes.push(o);
    totalVerts += o.geometry.attributes.position.count;
  });
  if (!meshes.length || totalVerts > maxVertices) return false;

  const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  if (!(sphere.radius > 0)) return false;
  const R = sphere.radius;

  // --- escena aislada de profundidad ---
  const depthScene = new THREE.Scene();
  const proxies = [];
  for (const mesh of meshes) {
    const p = new THREE.Mesh(mesh.geometry, depthMaterial());
    p.matrixAutoUpdate = false;
    p.matrix.copy(mesh.matrixWorld);
    p.matrixWorld.copy(mesh.matrixWorld);
    depthScene.add(p);
    proxies.push(p);
  }

  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true,
  });
  rt.texture.minFilter = THREE.NearestFilter;
  rt.texture.magFilter = THREE.NearestFilter;
  rt.texture.generateMipmaps = false;

  const cam = new THREE.OrthographicCamera(-R, R, R, -R, R * 0.5, R * 3.5);
  const depthRange = cam.far - cam.near;
  // Sesgo en unidades de profundidad: sin él, cada vértice se tapa a sí mismo.
  const bias = (R * 0.006) / depthRange;
  const normalOffset = R * 0.0025;

  // Acumuladores por malla
  const acc = meshes.map(m => ({
    sum: new Float32Array(m.geometry.attributes.position.count),
    weight: new Float32Array(m.geometry.attributes.position.count),
  }));

  const pixels = new Uint8Array(size * size * 4);
  const dirs = fibonacciSphere(directions);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  // Blanco = profundidad 1 = "nada delante": lo que no se dibuja no ocluye.
  renderer.setClearColor(0xffffff, 1);

  const p = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Vector3();

  try {
    for (let d = 0; d < dirs.length; d++) {
      const dir = dirs[d];
      cam.position.copy(sphere.center).addScaledVector(dir, R * 2);
      cam.up.set(0, 1, 0);
      if (Math.abs(dir.y) > 0.999) cam.up.set(0, 0, 1);
      cam.lookAt(sphere.center);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();

      // Pintar y leer con la XR apagada: dentro de las gafas, three usaría la cámara
      // estéreo del casco en vez de esta ortográfica y saldría basura (o parpadeo).
      offscreen(() => {
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(depthScene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
      });

      for (let mi = 0; mi < meshes.length; mi++) {
        const mesh = meshes[mi];
        const geo = mesh.geometry;
        const pos = geo.attributes.position;
        const nor = geo.attributes.normal;
        const world = mesh.matrixWorld;
        const normalMat = new THREE.Matrix3().getNormalMatrix(world);
        const { sum, weight } = acc[mi];

        for (let i = 0; i < pos.count; i++) {
          n.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
          const w = n.dot(dir);
          if (w <= 0.001) continue;               // esa dirección queda por detrás

          p.fromBufferAttribute(pos, i).applyMatrix4(world).addScaledVector(n, normalOffset);
          q.copy(p).project(cam);

          weight[i] += w;
          if (q.x < -1 || q.x > 1 || q.y < -1 || q.y > 1) { sum[i] += w; continue; }

          const px = Math.min(size - 1, Math.max(0, (q.x * 0.5 + 0.5) * size | 0));
          const py = Math.min(size - 1, Math.max(0, (q.y * 0.5 + 0.5) * size | 0));
          const stored = unpackDepth(pixels, (py * size + px) * 4);
          const own = q.z * 0.5 + 0.5;
          if (own <= stored + bias) sum[i] += w;  // nada se interpone: ve el cielo
        }
      }

      onProgress((d + 1) / dirs.length);
      // Leer píxeles de la GPU para la CPU es una parada en seco. En pantalla se pueden
      // encadenar cuatro; dentro de las gafas hay que soltar el fotograma en cada una o
      // se nota como un tirón.
      const chunk = renderer.xr.isPresenting ? 1 : 4;
      if (d % chunk === chunk - 1) await nextFrame();
    }
  } finally {
    offscreen(() => renderer.setRenderTarget(prevTarget));
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    rt.dispose();
    for (const proxy of proxies) proxy.material.dispose();
  }

  for (let mi = 0; mi < meshes.length; mi++) {
    const geo = meshes[mi].geometry;
    const { sum, weight } = acc[mi];
    const out = new Float32Array(sum.length);
    for (let i = 0; i < sum.length; i++) {
      const v = weight[i] > 0 ? sum[i] / weight[i] : 1;
      // Curva suave: se abre el rango alto y se aprietan los recovecos.
      out[i] = Math.pow(Math.min(1, Math.max(0, v)), 1.35);
    }
    geo.setAttribute('aAO', new THREE.BufferAttribute(out, 1));
    geo.attributes.aAO.needsUpdate = true;
    geo.userData.aoBaked = true;
  }
  return true;
}

function depthMaterial() {
  return new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
}

/** Deja el atributo aAO a 1 (sin oclusión) para que el shader nunca lea basura. */
export function ensureAOAttribute(root) {
  root.traverse(o => {
    const geo = o.isMesh && o.geometry;
    if (!geo?.attributes?.position || geo.attributes.aAO) return;
    const a = new Float32Array(geo.attributes.position.count).fill(1);
    geo.setAttribute('aAO', new THREE.BufferAttribute(a, 1));
  });
}

export function hasBakedAO(root) {
  let found = false;
  root.traverse(o => { if (o.isMesh && o.geometry?.userData?.aoBaked) found = true; });
  return found;
}
