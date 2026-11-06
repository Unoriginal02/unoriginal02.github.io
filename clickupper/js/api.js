// Cliente de la API de ClickUp. Los mismos endpoints que DWS y el Companion.
import { state } from './store.js';

// Solo para pruebas: dev/mock_clickup.py sirve una API simulada.
const BASE = localStorage.getItem('clickupper_api') || 'https://api.clickup.com/api/v2';
const MAX_A_LA_VEZ = 4;
let enCurso = 0;
const cola = [];

function turno() {
    if (enCurso < MAX_A_LA_VEZ) { enCurso++; return Promise.resolve(); }
    return new Promise(ok => cola.push(ok));
}
function libera() { const sig = cola.shift(); if (sig) sig(); else enCurso--; }

async function pedir(metodo, ruta, cuerpo, token = state.token) {
    await turno();
    try {
        for (let intento = 0; ; intento++) {
            const r = await fetch(BASE + ruta, {
                method: metodo,
                // Un archivo va como FormData, y es el navegador quien pone su Content-Type.
                headers: { Authorization: token, ...(cuerpo && !(cuerpo instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
                body: cuerpo instanceof FormData ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined,
            });
            if (r.status === 429 && intento < 4) { await new Promise(ok => setTimeout(ok, 15000)); continue; }
            if (r.status === 401) throw new Error('ClickUp no acepta el token.');
            if (!r.ok) {
                let detalle = '';
                try { detalle = (await r.json()).err || ''; } catch { /* sin cuerpo */ }
                throw new Error(`ClickUp respondió ${r.status}${detalle ? `: ${detalle}` : ''}`);
            }
            return await r.json();
        }
    } finally { libera(); }
}

async function paginado(rutaBase, alPagina) {
    const out = [];
    for (let page = 0; ; page++) {
        const sep = rutaBase.includes('?') ? '&' : '?';
        const d = await pedir('GET', `${rutaBase}${sep}page=${page}`);
        const t = d.tasks || [];
        out.push(...t);
        alPagina?.(t);
        if (d.last_page === true || t.length < 100) return out;
    }
}

export async function conectar(token) {
    const [u, t] = await Promise.all([pedir('GET', '/user', null, token), pedir('GET', '/team', null, token)]);
    return {
        id: u.user.id,
        nombre: u.user.username || u.user.email,
        teamId: t.teams?.[0]?.id,
    };
}

const team = () => state.user.teamId;
const yo = () => state.user.id;

export const misTareas = () => paginado(`/team/${team()}/task?assignees[]=${yo()}&subtasks=true&include_closed=false&archived=false`);
/** Todas las tareas del espacio, o solo las cambiadas desde `desdeMs`. */
export const todasLasTareas = (desdeMs, alPagina) => paginado(
    `/team/${team()}/task?subtasks=true&include_closed=true&archived=false${desdeMs ? `&date_updated_gt=${desdeMs}` : ''}`, alPagina);
export const tareasDeLista = id => paginado(`/list/${id}/task?subtasks=true&include_closed=true&archived=false`);
export const lista = id => pedir('GET', `/list/${id}`);
export const tarea = id => pedir('GET', `/task/${encodeURIComponent(id)}?include_markdown_description=true`);

export async function catalogo() {
    const { spaces = [] } = await pedir('GET', `/team/${team()}/space?archived=false`);
    const porEspacio = await Promise.all(spaces.map(async s => {
        const [{ folders = [] }, { lists = [] }] = await Promise.all([
            pedir('GET', `/space/${s.id}/folder?archived=false`),
            pedir('GET', `/space/${s.id}/list?archived=false`),
        ]);
        return [
            ...folders.flatMap(f => (f.lists || []).filter(l => !l.archived).map(l => ({ id: l.id, name: l.name, carpeta: f.hidden ? '' : f.name }))),
            ...lists.map(l => ({ id: l.id, name: l.name, carpeta: '' })),
        ];
    }));
    return porEspacio.flat();
}

export const crearTarea = (listId, cuerpo) => pedir('POST', `/list/${listId}/task`, cuerpo);
export const cambiarTarea = (id, cuerpo) => pedir('PUT', `/task/${encodeURIComponent(id)}`, cuerpo);

/** Todos los comentarios, del último al primero. ClickUp los da de 25 en 25. */
export async function comentarios(id) {
    const vistos = new Map();
    for (let q = ''; ;) {
        const { comments = [] } = await pedir('GET', `/task/${encodeURIComponent(id)}/comment${q}`);
        const nuevos = comments.filter(c => !vistos.has(c.id));
        nuevos.forEach(c => vistos.set(c.id, c));
        if (comments.length < 25 || !nuevos.length) return [...vistos.values()];
        const ult = comments.at(-1);
        q = `?start=${ult.date}&start_id=${ult.id}`;
    }
}
export const comentar = (id, comment) => pedir('POST', `/task/${encodeURIComponent(id)}/comment`, { comment, notify_all: false });
export function subirAdjunto(id, archivo) {
    const datos = new FormData();
    datos.append('attachment', archivo, archivo.name);
    return pedir('POST', `/task/${encodeURIComponent(id)}/attachment`, datos);
}

export async function entradasDeTiempo(desdeMs, hastaMs) {
    const d = await pedir('GET', `/team/${team()}/time_entries?start_date=${desdeMs}&end_date=${hastaMs}&assignee=${yo()}&include_location_names=true`);
    return d.data || [];
}
export async function crearEntrada(taskId, inicioMs, duracionMs, descripcion) {
    const d = await pedir('POST', `/team/${team()}/time_entries`, {
        tid: taskId, start: inicioMs, stop: inicioMs + duracionMs, duration: duracionMs,
        description: descripcion || '', assignee: yo(),
    });
    return d.data?.id ?? d.id ?? null;
}
export const borrarEntrada = id => pedir('DELETE', `/team/${team()}/time_entries/${encodeURIComponent(id)}`);
