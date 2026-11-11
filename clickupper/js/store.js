// Estado de la app y guardado en el navegador (IndexedDB). El token va en localStorage, como en DWS.
const DB = 'clickupper', STORE = 'kv';
const CLAVES = ['prefs', 'entradas', 'tablero', 'catalogo', 'indice'];
const TOKEN = 'clickupper_token', USER = 'clickupper_user';

export const state = {
    token: localStorage.getItem(TOKEN) || '',
    user: JSON.parse(localStorage.getItem(USER) || 'null'),
    prefs: { todas: [], añadidos: [], ocultos: [], cerradoEn: {}, orden: [], plegadas: [], favoritas: [], alaFavoritas: false },
    entradas: [],                 // registro: ver model.js
    tablero: {},                  // listId → { id, name, carpeta, statuses, tasks }
    catalogo: null,               // { fecha, listas: [] }  todos los proyectos, para el buscador
    indice: null,                 // { fecha, tareas: [] }  todas las tareas, para el buscador
    remotas: {},                  // fecha → entradas de tiempo de ClickUp (no se guarda)
};

let db;
let alGuardar = null;
const canal = 'BroadcastChannel' in window ? new BroadcastChannel('clickupper') : null;

function abrir() {
    return new Promise((ok, ko) => {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
    });
}
function leer(clave) {
    return new Promise((ok, ko) => {
        const r = db.transaction(STORE).objectStore(STORE).get(clave);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
    });
}

async function leerTodo() {
    for (const c of CLAVES) {
        const v = await leer(c);
        if (v !== undefined) state[c] = c === 'prefs' ? { ...state.prefs, ...v } : v;
    }
}

export async function cargar(alCambiarFuera) {
    db = await abrir();
    await leerTodo();
    navigator.storage?.persist?.();
    // Con dos pestañas abiertas, la otra se pone al día para no pisar datos.
    if (canal) canal.onmessage = async () => { await leerTodo(); alCambiarFuera(); };
}

export function guardar(...claves) {
    return new Promise((ok, ko) => {
        const tx = db.transaction(STORE, 'readwrite');
        for (const c of claves) tx.objectStore(STORE).put(state[c], c);
        tx.oncomplete = () => { canal?.postMessage('cambio'); alGuardar?.(claves); ok(); };
        tx.onerror = () => ko(tx.error);
    });
}

/** Avisa tras cada guardado (la copia automática lo usa). */
export const trasGuardar = f => { alGuardar = f; };

/** Valores sueltos fuera del estado, en el mismo almacén. */
export const leerExtra = clave => leer(clave);
export function guardarExtra(clave, valor) {
    return new Promise((ok, ko) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(valor, clave);
        tx.oncomplete = () => ok();
        tx.onerror = () => ko(tx.error);
    });
}

export function guardarSesion(token, user) {
    state.token = token; state.user = user;
    if (token) {
        localStorage.setItem(TOKEN, token);
        localStorage.setItem(USER, JSON.stringify(user));
    } else {
        localStorage.removeItem(TOKEN);
        localStorage.removeItem(USER);
    }
}
