// Estado compartido entre la interfaz HTML (escritorio) y el panel 3D (dentro de VR).
// Un único sitio donde vive la verdad: los dos se suscriben y se mantienen sincronizados.

export const SUPPORTED = ['glb', 'gltf', 'obj', 'stl', 'ply'];

export const QUALITY = {
  high:   { shadowMap: 2048, framebuffer: 1.0, foveation: 0.4, aoDirs: 40, aoSize: 640, contact: 1024 },
  medium: { shadowMap: 1024, framebuffer: 1.0, foveation: 0.8, aoDirs: 32, aoSize: 512, contact: 768 },
  low:    { shadowMap: 512,  framebuffer: 0.8, foveation: 1.0, aoDirs: 20, aoSize: 384, contact: 512 },
};

export const CLAY_COLORS = [
  { name: 'Yeso',    hex: 0xdedbd4 },
  { name: 'Hueso',   hex: 0xe8e2d6 },
  { name: 'Terracota', hex: 0xc98f72 },
  { name: 'Gris',    hex: 0xb9bcc2 },
  { name: 'Grafito', hex: 0x6e727a },
];

const state = {
  clay: true,
  clayColor: 0xdedbd4,
  wire: false,
  ao: true,
  aoStrength: 0.85,
  grid: true,
  contactOpacity: 0.75,
  shadowSoftness: 5,
  exposure: 1.0,
  realScale: false,
  quality: 'medium',
  mode: 'orbit',        // 'orbit' | 'walk'
  presenting: false,    // dentro de una sesión XR
  grabbing: false,      // agarrando el mundo con al menos una mano
  worldLock: false,     // mundo fijo: solo responde el panel de muñeca
  playerScale: 1,       // tu tamaño; >1 eres un gigante, <1 estás en miniatura
  frameRate: 0,         // hercios concedidos por el visor (0 = lo que traiga por defecto)
  modelName: null,
  activeId: null,
  aoAvailable: false,   // el modelo actual tiene AO horneada
};

const subs = new Map();

export function get(key) { return state[key]; }
export function all() { return { ...state }; }

/** on('clay', fn) · on(['clay','wire'], fn) · on('*', fn) */
export function on(keys, fn) {
  for (const k of [].concat(keys)) {
    if (!subs.has(k)) subs.set(k, new Set());
    subs.get(k).add(fn);
  }
  return () => { for (const k of [].concat(keys)) subs.get(k)?.delete(fn); };
}

export function set(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] === v) continue;
    state[k] = v;
    changed.push(k);
  }
  if (!changed.length) return changed;
  for (const k of changed) subs.get(k)?.forEach(fn => fn(state[k], k));
  if (changed.length) subs.get('*')?.forEach(fn => fn(state, changed));
  return changed;
}

export function toggle(key) { set({ [key]: !state[key] }); return state[key]; }
export function quality() { return QUALITY[state.quality]; }
