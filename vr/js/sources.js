// De dónde salen los modelos: la carpeta models/ del propio repositorio.
//
// El listado se pide a la Contents API de GitHub, que es pública, permite CORS y no
// necesita ninguna clave. Así basta con arrastrar un .glb a models/ en github.com para
// que aparezca en el visor — sin mantener ningún índice a mano.
//
// Las descargas van por ruta relativa, o sea del MISMO origen que la página: sin CORS,
// sin claves y sin límites de terceros.

import { SUPPORTED } from './state.js';
import { extensionOf } from './loaders.js';
import { SOURCE, repoInfo } from './config.js';

const API = 'https://api.github.com';

let nextId = 1;
const entry = (props) => ({ id: `e${nextId++}`, supported: true, ...props });

export function humanSize(bytes) {
  if (bytes == null || bytes === '') return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, b = Number(bytes);
  if (!isFinite(b)) return '';
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return b.toFixed(b < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
}

/** URL del archivo servida por la propia web (mismo origen que la página). */
function localUrl(path) {
  return new URL(path, document.baseURI).href;
}

function toEntry(item) {
  if (item.type === 'dir') {
    return entry({ kind: 'dir', name: item.name, path: item.path, sub: 'Carpeta' });
  }
  const ext = extensionOf(item.name);
  return entry({
    kind: 'model',
    name: item.name,
    path: item.path,
    url: localUrl(item.path),
    ext,
    sub: humanSize(item.size),
    supported: SUPPORTED.includes(ext),
  });
}

const byName = (a, b) => {
  if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, 'es', { numeric: true });
};

// ---------- Listado vía Contents API ----------

async function listFromGitHub(path) {
  const info = repoInfo();
  if (!info) return null;                       // no estamos en github.io
  const url = new URL(`${API}/repos/${info.owner}/${info.repo}/contents/${path}`);
  if (SOURCE.branch) url.searchParams.set('ref', SOURCE.branch);

  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });

  if (response.status === 404) {
    throw new Error(
      `No existe la carpeta «${path}» en ${info.owner}/${info.repo}` +
      (info.detected ? ' (repositorio deducido de la URL).' : '.') +
      ' Créala y sube ahí tus modelos.'
    );
  }
  if (response.status === 403) {
    const reset = Number(response.headers.get('x-ratelimit-reset') || 0) * 1000;
    const minutes = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : null;
    throw new Error(
      'GitHub ha limitado las consultas desde tu conexión (60 por hora)' +
      (minutes ? `. Vuelve a intentarlo en ~${minutes} min.` : '.')
    );
  }
  if (!response.ok) throw new Error(`GitHub ha respondido ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`«${path}» no es una carpeta.`);
  return data.map(toEntry).sort(byName);
}

// ---------- Respaldo: models/models.json ----------

async function listFromManifest(path) {
  const response = await fetch(new URL(`${path}/models.json`, document.baseURI), { cache: 'no-cache' });
  if (!response.ok) return null;
  const raw = await response.json();
  const items = Array.isArray(raw) ? raw : (raw.models || []);
  return items.map(item => {
    const file = typeof item === 'string' ? item : item.file;
    if (!file) return null;
    const ext = extensionOf(file);
    return entry({
      kind: 'model',
      name: (typeof item === 'object' && item.name) || file,
      path: `${path}/${file}`,
      url: /^https?:/.test(file) ? file : localUrl(`${path}/${file}`),
      ext,
      sub: (typeof item === 'object' && item.note) || humanSize(item.size) || ext.toUpperCase(),
      supported: SUPPORTED.includes(ext),
    });
  }).filter(Boolean).sort(byName);
}

/**
 * Lista una carpeta de modelos. Primero prueba la API de GitHub y, si no se puede
 * (repositorio aún sin publicar, sin conexión, límite de consultas), cae al manifiesto
 * models.json, que sí funciona en local.
 *
 * @param {string} path  ruta dentro del repo, p. ej. 'models' o 'models/piezas'
 */
export async function listFolder(path = SOURCE.folder) {
  let apiError = null;
  try {
    const items = await listFromGitHub(path);
    if (items) return items;
  } catch (err) {
    apiError = err;
  }

  const fallback = await listFromManifest(path).catch(() => null);
  // Un manifiesto vacío no debe tapar un error real de la API: si la API falló y el
  // respaldo no aporta nada, es mejor enseñar el motivo que un «carpeta vacía».
  if (fallback && (fallback.length || !apiError)) return fallback;
  if (apiError) throw apiError;
  throw new Error(
    `No se ha podido leer «${path}». Publica el repositorio en GitHub Pages, o crea ` +
    `${path}/models.json con la lista de archivos para poder probarlo en local.`
  );
}

export const rootFolder = () => SOURCE.folder;

// ---------- Resolución a algo que loadModel() entienda ----------

/** Descarga con progreso; al ser mismo origen no hay CORS de por medio. */
export async function resolve(item, onProgress = () => {}) {
  if (item.kind !== 'model') throw new Error('esa entrada no es un modelo');

  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`No se ha podido descargar (${response.status})`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) {
    return { name: item.name, buffer: await response.arrayBuffer() };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  return { name: item.name, buffer: buffer.buffer };
}

/** Entrada suelta para ?model=<url>. */
export function entryFromUrl(url) {
  return entry({
    kind: 'model', name: url.split('/').pop() || url, url,
    ext: extensionOf(url), sub: 'desde la URL',
  });
}
