// De dónde salen los modelos: una carpeta de Google Drive.
//
// Se usa la API de Drive con una clave de API (js/config.js). Es la única vía que funciona
// desde una web estática: los enlaces de descarga normales de Drive no permiten leer el
// archivo desde otra página (no mandan cabeceras CORS), y la API sí.
//
// Con la carpeta compartida como «cualquiera con el enlace», la clave basta para listar y
// descargar; no hay que iniciar sesión, lo cual importa porque dentro de las Quest no hay
// forma cómoda de pasar por un login de Google.

import { SUPPORTED } from './state.js';
import { extensionOf } from './loaders.js';
import { DRIVE, requestedFolder } from './config.js';

const API = 'https://www.googleapis.com/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Parámetros comunes: que también valga para unidades compartidas.
const SHARED = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };

let nextId = 1;
const entry = (props) => ({ id: `e${nextId++}`, supported: true, ...props });

/** Nombres de carpeta ya consultados, para las migas de pan. */
const names = new Map();
export const labelFor = (id) => names.get(id) || '';

export function humanSize(bytes) {
  if (bytes == null || bytes === '') return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, b = Number(bytes);
  if (!isFinite(b)) return '';
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return b.toFixed(b < 10 && i > 0 ? 1 : 0) + ' ' + units[i];
}

function apiUrl(path, params = {}) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries({ ...SHARED, ...params, key: DRIVE.apiKey })) {
    url.searchParams.set(k, v);
  }
  return url;
}

/** URL de descarga del contenido del archivo (la API sí manda cabeceras CORS). */
const mediaUrl = (fileId) => apiUrl(`files/${fileId}`, { alt: 'media' }).href;

function toEntry(file) {
  if (file.mimeType === FOLDER_MIME) {
    names.set(file.id, file.name);
    return entry({ kind: 'dir', name: file.name, path: file.id, sub: 'Carpeta' });
  }
  const ext = extensionOf(file.name);
  return entry({
    kind: 'model',
    name: file.name,
    path: file.id,
    url: mediaUrl(file.id),
    size: Number(file.size) || 0,
    ext,
    sub: humanSize(file.size),
    supported: SUPPORTED.includes(ext),
  });
}

const byName = (a, b) => {
  if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, 'es', { numeric: true });
};

// ---------- Errores en cristiano ----------

async function explain(response, what) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || '';
  } catch { /* la respuesta no era JSON */ }

  if (response.status === 400 || response.status === 404) {
    return new Error(
      `Drive no encuentra ${what}. Revisa el <code>folderId</code> de js/config.js: ` +
      'tiene que ser el trozo final de la URL de la carpeta.' + (detail ? `<br><br>${detail}` : '')
    );
  }
  if (response.status === 401 || response.status === 403) {
    // El navegador manda como «referer» solo el origen (https://usuario.github.io/), nunca
    // la ruta: si la clave se restringió con subcarpeta, no va a coincidir jamás.
    const reason = /referer|referrer/i.test(detail)
      ? 'La clave de API no admite este dominio. En la consola de Google, restricción de ' +
        `aplicación → Sitios web, añade <code>${location.origin}/*</code> tal cual ` +
        '(el origen entero, sin subcarpetas: el navegador no manda la ruta).'
      : /API key not valid|API_KEY_INVALID|expired/i.test(detail)
      ? 'La clave de API no es válida. Revisa que esté copiada entera en js/config.js.'
      : /has not been used|not been enabled|disabled|SERVICE_DISABLED/i.test(detail)
      ? 'La Google Drive API no está habilitada en el proyecto de la clave.'
      : 'La carpeta no es pública: compártela como «Cualquier persona con el enlace».';
    return new Error(reason + (detail ? `<br><br>${detail}` : ''));
  }
  return new Error(`Drive ha respondido ${response.status}.` + (detail ? ` ${detail}` : ''));
}

// ---------- Listado ----------

/** Pide el nombre de la carpeta para poder enseñarlo en las migas de pan. */
async function fetchFolderName(folderId) {
  if (names.has(folderId)) return names.get(folderId);
  try {
    const response = await fetch(apiUrl(`files/${folderId}`, { fields: 'name' }));
    if (!response.ok) return '';
    const { name } = await response.json();
    if (name) names.set(folderId, name);
    return name || '';
  } catch {
    return '';
  }
}

/**
 * Lista una carpeta de Drive. Trae también las subcarpetas, para poder entrar en ellas.
 * @param {string} folderId  ID de la carpeta (por defecto, la de config.js o ?folder=)
 */
export async function listFolder(folderId = rootFolder()) {
  if (!DRIVE.apiKey || !folderId) {
    throw new Error(
      'Falta configurar la carpeta de Drive. Abre <code>js/config.js</code> y rellena ' +
      '<code>folderId</code> y <code>apiKey</code> (las instrucciones están ahí mismo).'
    );
  }

  const files = [];
  let pageToken = '';
  do {
    const url = apiUrl('files', {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      orderBy: 'folder,name_natural',
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await fetch(url);
    if (!response.ok) throw await explain(response, 'la carpeta');
    const data = await response.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  // Solo cuesta una consulta la primera vez: las subcarpetas ya traen nombre del listado.
  await fetchFolderName(folderId);
  return files.map(toEntry).sort(byName);
}

export const rootFolder = () => requestedFolder();

// ---------- Resolución a algo que loadModel() entienda ----------

/** Descarga con progreso. */
export async function resolve(item, onProgress = () => {}) {
  if (item.kind !== 'model') throw new Error('esa entrada no es un modelo');

  const response = await fetch(item.url);
  if (!response.ok) throw await explain(response, 'el archivo');

  // Drive no siempre manda content-length; el tamaño del listado sirve igual de bien.
  const total = Number(response.headers.get('content-length')) || item.size || 0;
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
