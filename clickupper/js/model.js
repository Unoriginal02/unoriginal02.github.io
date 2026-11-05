// Tareas (árbol de cada proyecto) y registro (entradas con hora, imputación).
//
// Entrada: { id, date, start, end|null, taskId, taskName, ruta, listId, listName, nota, color, cuId, cuSig }
//   end: una entrada nueva dura 15 min hasta que se cambie. null solo en entradas antiguas: dura hasta
//   la siguiente del día; la última, 15 min.
//   cuId     = id de la entrada de tiempo creada en ClickUp; cuSig = cómo estaba al imputarla.
import { state, guardar } from './store.js';
import * as api from './api.js';
import { toMin, toHHMM, toISO, hoyISO, horaRedondeada, msDe, addDays, COLORES } from './util.js';

export const PASO = 15;

// ── Tareas ───────────────────────────────────────────────────────────────
export const esCerrada = t => ['closed', 'done'].includes(t.status?.type);
export const esMia = t => (t.assignees || []).some(a => String(a.id) === String(state.user?.id));

/** Una columna del tablero: tareas y subtareas en árbol, filtradas por la vista. */
export function arbol(lista) {
    const soloMias = state.prefs.vista === 'mias';
    const porId = new Map(lista.tasks.map(t => [t.id, t]));
    const hijos = new Map();
    for (const t of lista.tasks) {
        const padre = t.parent && porId.has(t.parent) ? t.parent : null;
        if (!hijos.has(padre)) hijos.set(padre, []);
        hijos.get(padre).push(t);
    }
    const memo = new Map();
    const llevaMia = t => {
        if (!memo.has(t.id)) memo.set(t.id, (esMia(t) && !esCerrada(t)) || (hijos.get(t.id) || []).some(llevaMia));
        return memo.get(t.id);
    };
    const visible = t => soloMias ? llevaMia(t) : !esCerrada(t) || (hijos.get(t.id) || []).some(visible);
    const orden = (a, b, nivel) => nivel === 0
        ? +b.date_created - +a.date_created        // lo más nuevo arriba
        : +a.date_created - +b.date_created;       // subtareas: como en ClickUp, por antigüedad
    const nodo = (t, nivel) => ({
        t, nivel,
        hijos: (hijos.get(t.id) || []).filter(visible).sort((a, b) => orden(a, b, nivel + 1)).map(x => nodo(x, nivel + 1)),
    });
    return (hijos.get(null) || []).filter(visible).sort((a, b) => orden(a, b, 0)).map(t => nodo(t, 0));
}

export function buscarTarea(id) {
    for (const l of Object.values(state.tablero)) {
        const t = l.tasks.find(x => x.id === id);
        if (t) return { t, lista: l };
    }
    return null;
}

/** "Diseño / Home V4": la tarea con las que tiene encima. */
export function rutaDe(t, lista) {
    const partes = [t.name];
    let p = t;
    while (p.parent && (p = lista.tasks.find(x => x.id === p.parent))) partes.unshift(p.name);
    return partes.join(' / ');
}

/** Columnas del tablero: proyectos con algo mío y los añadidos a mano (al final), menos los ocultos.
 *  Primero van los que se han colocado arrastrando, en ese orden. */
export function columnas() {
    const { añadidos, ocultos, orden } = state.prefs;
    const l = Object.values(state.tablero).filter(x => !ocultos.includes(x.id));
    const mias = l.filter(x => !añadidos.includes(x.id)).sort((a, b) => a.name.localeCompare(b.name));
    const extra = añadidos.map(id => l.find(x => x.id === id)).filter(Boolean);
    const pos = l => { const i = orden.indexOf(l.id); return i < 0 ? orden.length : i; };
    return [...mias, ...extra].sort((a, b) => pos(a) - pos(b));
}

/** Coloca un proyecto justo antes de otro (null: al final). */
export function moverProyecto(id, antesDe) {
    if (id === antesDe) return;
    const ids = columnas().map(l => l.id).filter(x => x !== id);
    const i = antesDe ? ids.indexOf(antesDe) : -1;
    ids.splice(i < 0 ? ids.length : i, 0, id);
    state.prefs.orden = ids;
    return guardar('prefs');
}

/** Tiempo imputado en ms: el de la tarea y el de sus subtareas, cerradas incluidas, como lo suma ClickUp en pantalla
 *  (la API da cada tarea por separado). */
export function imputadoDe(t, lista) {
    return (+t.time_spent || 0) + lista.tasks.filter(x => x.parent === t.id).reduce((s, x) => s + imputadoDe(x, lista), 0);
}

/** Tras imputar o borrar, pone al día el tiempo imputado de esas tareas. Si falla, ya llegará al sincronizar. */
async function refrescarImputado(ids) {
    await Promise.all([...new Set(ids)].map(async id => {
        const hallada = buscarTarea(id);
        if (hallada) hallada.t.time_spent = (await api.tarea(id)).time_spent;
    })).catch(() => {});
    await guardar('tablero');
}

/** Solo lo que usa la app: el tablero se guarda entero cada vez que cambia una tarea. */
const compacta = t => ({
    id: t.id, name: t.name, parent: t.parent, url: t.url, date_created: t.date_created,
    time_estimate: t.time_estimate, time_spent: t.time_spent, status: t.status, tags: t.tags,
    assignees: (t.assignees || []).map(a => ({ id: a.id, username: a.username, initials: a.initials })),
});

async function traerLista(id, carpeta = '') {
    const [tasks, info] = await Promise.all([api.tareasDeLista(id), api.lista(id)]);
    return {
        id, name: info.name, carpeta: info.folder?.hidden ? '' : (info.folder?.name || carpeta),
        statuses: (info.statuses || []).map(s => ({ status: s.status, color: s.color, type: s.type, orderindex: s.orderindex })),
        tasks: tasks.map(compacta),
    };
}

/** Recarga el tablero: mira en qué proyectos tengo algo y trae todas sus tareas. */
export async function sincronizar() {
    const mias = await api.misTareas();
    const ids = new Map();
    // Sin cerrar de verdad: ClickUp también da aquí las de estado «completado».
    for (const t of mias) if (t.list?.id && !esCerrada(t)) ids.set(t.list.id, t.folder?.hidden ? '' : t.folder?.name);
    for (const id of state.prefs.añadidos) if (!ids.has(id)) ids.set(id, '');
    const res = await Promise.allSettled([...ids].map(([id, carpeta]) => traerLista(id, carpeta)));
    const nuevo = {}, fallos = [];
    [...ids.keys()].forEach((id, i) => {
        if (res[i].status === 'fulfilled') nuevo[id] = res[i].value;
        else {
            fallos.push(res[i].reason);
            // Un proyecto que no ha cargado conserva lo que había: mejor viejo que desaparecido.
            if (state.tablero[id]) nuevo[id] = state.tablero[id];
        }
    });
    state.tablero = nuevo;
    await guardar('tablero');
    if (fallos.length) throw new Error(`${fallos.length} proyecto(s) sin recargar: ${fallos[0].message}`);
}

/** Añadir un proyecto: entra al tablero y la vista pasa a Todas, para ver lo que hay y asignarse. */
export async function añadirProyecto(id) {
    const p = state.prefs;
    if (!state.tablero[id]) state.tablero[id] = await traerLista(id);
    p.ocultos = p.ocultos.filter(x => x !== id);
    // Si solo tengo ahí cosas cerradas, sincronizar no lo traería: cuenta como añadido a mano.
    if (!state.tablero[id].tasks.some(t => esMia(t) && !esCerrada(t)) && !p.añadidos.includes(id)) p.añadidos.push(id);
    p.vista = 'todas';
    await guardar('prefs', 'tablero');
}

export function ocultarProyecto(id) {
    const p = state.prefs;
    p.añadidos = p.añadidos.filter(x => x !== id);
    p.ocultos = [...new Set([...p.ocultos, id])];
    p.orden = p.orden.filter(x => x !== id);
    return guardar('prefs');
}

/** Cambia en pantalla al momento y lo envía; si ClickUp falla, lo deshace y avisa. */
async function optimista(t, cambios, enviar) {
    const antes = Object.fromEntries(Object.keys(cambios).map(k => [k, t[k]]));
    Object.assign(t, cambios);
    try { await enviar(); } catch (e) { Object.assign(t, antes); throw e; }
    await guardar('tablero');
}

export const cambiarEstado = (t, st) => optimista(t, { status: st }, () => api.cambiarTarea(t.id, { status: st.status }));
export const cambiarEstimacion = (t, ms) => optimista(t, { time_estimate: ms }, () => api.cambiarTarea(t.id, { time_estimate: ms }));

export function asignarme(t, asignar) {
    const y = state.user;
    const nuevos = asignar
        ? [...(t.assignees || []), { id: y.id, username: y.nombre, initials: y.nombre.slice(0, 2).toUpperCase() }]
        : (t.assignees || []).filter(a => String(a.id) !== String(y.id));
    return optimista(t, { assignees: nuevos }, () => api.cambiarTarea(t.id, { assignees: { [asignar ? 'add' : 'rem']: [+y.id] } }));
}

/** Crea tarea o subtarea. Tú siempre vas asignado; una subtarea copia etiquetas y asignados de su
 *  hermana más reciente (D3 del Companion). */
export async function crearTarea(lista, nombre, padre = null) {
    const cuerpo = { name: nombre };
    const asignados = new Set([+state.user.id]);
    if (padre) {
        cuerpo.parent = padre.id;
        const hermana = lista.tasks.filter(t => t.parent === padre.id).sort((a, b) => +b.date_created - +a.date_created)[0];
        (hermana?.assignees || []).forEach(a => asignados.add(+a.id));
        if (hermana?.tags?.length) cuerpo.tags = hermana.tags.map(g => g.name);
    }
    cuerpo.assignees = [...asignados];
    const nueva = await api.crearTarea(lista.id, cuerpo);
    lista.tasks.push(compacta(nueva));
    await guardar('tablero');
    return nueva;
}

// ── Buscador ─────────────────────────────────────────────────────────────
const UN_DIA = 86400000, UNA_HORA = 3600000;

export async function asegurarCatalogo(forzar = false) {
    if (!forzar && state.catalogo && Date.now() - state.catalogo.fecha < UN_DIA) return;
    state.catalogo = { fecha: Date.now(), listas: await api.catalogo() };
    await guardar('catalogo');
}

let leyendoIndice = null, alProgresarIndice = null;

/** Índice de tareas para el buscador. La primera lectura es larga (todo el espacio, varios minutos):
 *  se puede buscar mientras llega, y las siguientes veces solo se piden las tareas cambiadas. */
export function asegurarIndice(forzar = false, progreso = null) {
    if (progreso) alProgresarIndice = progreso;
    if (leyendoIndice) return leyendoIndice;
    const previo = forzar ? null : state.indice;
    if (previo && Date.now() - previo.fecha < UNA_HORA) return Promise.resolve();
    const inicio = Date.now();
    const porId = new Map((previo?.tareas || []).map(t => [t.id, t]));
    leyendoIndice = api.todasLasTareas(previo?.fecha, pagina => {
        for (const t of pagina) porId.set(t.id, { id: t.id, name: t.name, listId: t.list?.id, listName: t.list?.name, cerrada: esCerrada(t) });
        state.indice = { fecha: previo?.fecha || 0, tareas: [...porId.values()] };
        alProgresarIndice?.(porId.size);
    }).then(() => {
        state.indice = { fecha: inicio, tareas: [...porId.values()] };
        return guardar('indice');
    }).finally(() => { leyendoIndice = null; });
    return leyendoIndice;
}

// ── Registro ─────────────────────────────────────────────────────────────
export const delDia = fecha => state.entradas.filter(e => e.date === fecha).sort((a, b) => toMin(a.start) - toMin(b.start));

/** Fin efectivo en minutos: nunca pasa de donde empieza la siguiente. */
export function finDe(e, dia = delDia(e.date)) {
    const ini = toMin(e.start);
    const sig = dia.map(o => toMin(o.start)).filter(m => m > ini).sort((a, b) => a - b)[0];
    if (e.end) return sig !== undefined ? Math.min(toMin(e.end), sig) : toMin(e.end);
    return sig ?? Math.min(ini + PASO, 24 * 60);
}
export const duracion = (e, dia) => finDe(e, dia) - toMin(e.start);

const firma = e => [e.date, e.start, finDe(e), e.taskId, e.nota || ''].join('|');
export const estaCambiada = e => !!e.cuId && e.cuSig !== firma(e);

const alAzar = lista => lista[Math.floor(Math.random() * lista.length)];

/** El color de un bloque nuevo, como en DWS: distinto de los dos anteriores del día y, entre los demás,
 *  uno de los menos usados hasta esa hora. Se elige una vez y se queda con el bloque. */
export function colorNuevo(fecha, start) {
    const nombres = Object.keys(COLORES);
    const previas = delDia(fecha).filter(e => e.color && toMin(e.start) <= toMin(start));
    if (!previas.length) return alAzar(nombres);
    const ultimos = previas.slice(-2).map(e => e.color);
    const candidatos = nombres.filter(c => !ultimos.includes(c));
    const usos = c => previas.filter(e => e.color === c).length;
    const minimo = Math.min(...candidatos.map(usos));
    return alAzar(candidatos.filter(c => usos(c) === minimo));
}

/** Da color a las entradas que aún no lo tienen: las de antes de existir esto o las de una copia antigua. */
export function asegurarColores() {
    const sinColor = state.entradas.filter(e => !e.color);
    if (!sinColor.length) return;
    for (const fecha of new Set(sinColor.map(e => e.date))) {
        for (const e of delDia(fecha)) if (!e.color) e.color = colorNuevo(fecha, e.start);
    }
    guardar('entradas');
}

/** Datos de tarea de una entrada, a partir de una tarea del tablero. */
export function datosTarea(t, lista) {
    return { taskId: t.id, taskName: t.name, ruta: rutaDe(t, lista), listId: lista.id, listName: lista.name };
}

/** Nueva entrada: hoy, a la hora actual; otro día, al acabar la última. Si está ocupada, el siguiente tramo libre. */
export function añadirEntrada(fecha, datos = {}) {
    const dia = delDia(fecha);
    const desde = fecha === hoyISO() ? horaRedondeada() : dia.length ? toHHMM(Math.min(finDe(dia.at(-1), dia), 24 * 60 - PASO)) : '09:00';
    const libre = huecoLibre(fecha, toMin(desde), PASO);
    if (libre === null) throw new Error('No queda ningún tramo libre en ese día.');
    const start = toHHMM(libre);
    const e = { id: crypto.randomUUID(), date: fecha, start, end: toHHMM(Math.min(toMin(start) + PASO, 24 * 60)), taskId: '', taskName: '', ruta: '', listId: '', listName: '', nota: '', color: colorNuevo(fecha, start), cuId: null, cuSig: null, ...datos };
    state.entradas.push(e);
    guardar('entradas');
    return e;
}

/** Lanza un aviso si ese tramo pisa otro bloque del día. Es la misma regla que al arrastrar en la semana:
 *  nunca hay dos bloques a la vez, así que el registro y la hoja de horas siempre coinciden. */
function comprobarHueco(e, ini, fin) {
    const choque = ocupados(e.date, e).find(([a, b]) => a < fin && b > ini);
    if (choque) throw new Error(`${toHHMM(ini)} – ${toHHMM(fin)} se pisa con ${choque[2]} (${toHHMM(choque[0])} – ${toHHMM(Math.round(choque[1]))}). Se queda como estaba.`);
}

/** Cambiar la entrada mueve el bloque entero, con su duración. */
export function cambiarInicio(e, start) {
    const ini = toMin(start), fin = Math.min(ini + finDe(e) - toMin(e.start), 24 * 60);
    comprobarHueco(e, ini, fin);
    if (!ajustarEntrada(e, e.date, ini, fin)) throw new Error('Esa hora no vale. Se queda como estaba.');
}

export function cambiarSalida(e, salida) {
    const ini = toMin(e.start), fin = toMin(salida);
    if (fin <= ini) throw new Error('La salida tiene que ser después de la entrada. Se queda como estaba.');
    comprobarHueco(e, ini, fin);
    if (!ajustarEntrada(e, e.date, ini, fin)) throw new Error('Esa hora no vale. Se queda como estaba.');
}

export function cambiarEntrada(e, cambios) { Object.assign(e, cambios); guardar('entradas'); }

/** Borra la entrada solo de la app. Lo imputado sigue en ClickUp y se ve como imputado fuera. */
export function borrarEntrada(e) {
    state.entradas = state.entradas.filter(o => o !== e);
    return guardar('entradas');
}

/** Ajuste en la hoja de horas. Devuelve false si se solaparía con otra.
 *  Al tocar un bloque, los demás del día conservan su duración: dejan de depender de la siguiente.
 *  Solo la última del día sigue abierta, para que la próxima entrada del registro la cierre. */
export function ajustarEntrada(e, fecha, iniMin, finMin) {
    const dias = [...new Set([e.date, fecha])];
    const antes = new Map();
    for (const d of dias) {
        const lista = delDia(d);
        lista.forEach(o => antes.set(o, { fin: finDe(o, lista), ultima: o === lista.at(-1) }));
    }
    const solapa = ocupados(fecha, e).some(([a, b]) => a < finMin && b > iniMin);
    if (solapa || iniMin < 0 || finMin > 24 * 60 || finMin - iniMin < PASO) return false;

    Object.assign(e, { date: fecha, start: toHHMM(iniMin), end: toHHMM(finMin) });
    for (const d of dias) {
        const lista = delDia(d);
        for (const o of lista) {
            if (o === e) continue;
            const a = antes.get(o);
            if (!(a.ultima && o === lista.at(-1) && !o.end)) o.end = toHHMM(a.fin);
        }
    }
    guardar('entradas');
    return true;
}

/** Tramos [inicio, fin, nombre] ya ocupados ese día: el registro (menos `ignorar`) y lo imputado en ClickUp por otro lado. */
function ocupados(fecha, ignorar = null) {
    const dia = delDia(fecha);
    return [
        ...dia.filter(o => o !== ignorar).map(o => [toMin(o.start), finDe(o, dia), o.taskName || 'otra entrada']),
        ...remotasSueltas(fecha).filter(r => r.id !== ignorar?.id).map(r => { const d = new Date(r.ini), i = d.getHours() * 60 + d.getMinutes(); return [i, i + r.dur / 60000, r.taskName]; }),
    ];
}

/** Hueco libre alrededor de un minuto, o null si ese minuto cae dentro de un bloque (como DWS). */
export function huecoEn(fecha, minuto, ignorar = null) {
    let start = 0, end = 24 * 60;
    for (const [a, b] of ocupados(fecha, ignorar)) {
        if (minuto >= a && minuto < b) return null;
        if (b <= minuto) start = Math.max(start, b);
        else end = Math.min(end, a);
    }
    return { start, end };
}

/** Primer hueco de esa duración desde `desde`. */
function huecoLibre(fecha, desde, dur) {
    const ocupado = ocupados(fecha);
    for (let ini = desde; ini + dur <= 24 * 60; ini += PASO) {
        if (!ocupado.some(([a, b]) => a < ini + dur && b > ini)) return ini;
    }
    return null;
}

/** Copia sin imputar en un tramo concreto. Los demás bloques de ese día no cambian. */
export function copiarEntrada(datos, fecha, iniMin, finMin) {
    const antes = delDia(fecha);
    const fines = antes.map(o => [o, finDe(o, antes)]);
    const e = { id: crypto.randomUUID(), date: fecha, start: toHHMM(iniMin), end: toHHMM(finMin), cuId: null, cuSig: null, ...datos };
    e.color ||= colorNuevo(fecha, e.start);   // una copia conserva el color; lo imputado fuera no tiene
    state.entradas.push(e);
    const ahora = delDia(fecha);
    for (const [o, fin] of fines) {
        if (!o.end && !(o === antes.at(-1) && o === ahora.at(-1))) o.end = toHHMM(fin);
    }
    guardar('entradas');
    return e;
}

/** Copia en otro día, misma hora y duración (en tramos de 15 min); si está ocupado, en el siguiente
 *  hueco. Devuelve la entrada, o null si no cabe. */
export function duplicarEntrada(datos, fecha, iniMin, durMin) {
    const dur = Math.max(Math.round(durMin / PASO) * PASO, PASO);
    const ini = huecoLibre(fecha, Math.round(iniMin / PASO) * PASO, dur);
    return ini === null ? null : copiarEntrada(datos, fecha, ini, ini + dur);
}

// ── Lo ya imputado en ClickUp ────────────────────────────────────────────
function normalizarRemota(r) {
    return {
        id: String(r.id), taskId: r.task?.id || '', taskName: r.task?.name || '(sin tarea)',
        listId: r.task_location?.list_id ? String(r.task_location.list_id) : '',
        listName: r.task_location?.list_name || '',
        nota: r.description || '', ini: +r.start, dur: +r.duration, userId: r.user?.id,
    };
}

/** Trae de ClickUp lo imputado entre dos fechas (ambas incluidas) y lo reparte por día. */
export async function cargarRemotas(desde, hasta) {
    const crudas = await api.entradasDeTiempo(msDe(desde, '00:00'), msDe(addDays(hasta, 1), '00:00') - 1);
    for (let d = desde; d <= hasta; d = addDays(d, 1)) state.remotas[d] = [];
    for (const r of crudas) {
        const n = normalizarRemota(r);
        if (n.dur <= 0) continue;   // cronómetro en marcha
        (state.remotas[toISO(new Date(n.ini))] ||= []).push(n);
    }
}

function olvidarRemota(id) {
    for (const f of Object.keys(state.remotas)) state.remotas[f] = state.remotas[f].filter(r => r.id !== id);
}

/** Pasa lo imputado fuera al registro, ya marcado como imputado, para poder ajustarlo. ClickUp no cambia
 *  hasta volver a imputar. */
export function adoptarRemota(r) {
    const d = new Date(r.ini), ini = d.getHours() * 60 + d.getMinutes();
    const e = copiarEntrada({
        taskId: r.taskId, taskName: r.taskName, ruta: r.taskName, listId: r.listId, listName: r.listName, nota: r.nota, cuId: r.id,
    }, toISO(d), ini, Math.min(ini + Math.round(r.dur / 60000), 24 * 60));
    e.cuSig = firma(e);
    guardar('entradas');
    return e;
}

/** Lo de ClickUp que no sale de una entrada de este registro. */
export function remotasSueltas(fecha) {
    const propias = new Set(state.entradas.map(e => String(e.cuId)));   // de cualquier día: pudo moverse a otro
    return (state.remotas[fecha] || []).filter(r => !propias.has(r.id));
}

// ── Imputar ──────────────────────────────────────────────────────────────
export const pendientes = lista => lista.filter(e => e.taskId && (!e.cuId || estaCambiada(e)));

/** Quita la marca de imputado de un bloque, sin tocar ClickUp: para cuando se borró allí directamente. */
export function quitarImputado(e) {
    e.cuId = null;
    e.cuSig = null;
    return guardar('entradas');
}

/** Lo que haría imputar un día, o solo una tarea de ese día, sin escribir nada. Al imputar, los bloques mandan:
 *  se crea lo que falta y se borran las demás imputaciones mías del alcance. Lo que ya es igual se deja como está
 *  (misma tarea, inicio y duración; y nota, si el bloque tiene). `sinBloque`: lo que se borraría sin que ningún
 *  bloque lo sustituya, para confirmarlo antes. */
export async function planImputacion(fecha, taskId = null) {
    await cargarRemotas(fecha, fecha);   // si esto falla no se imputa: se trabajaría a ciegas
    const yo = String(state.user.id);
    const bloques = delDia(fecha).filter(e => e.taskId && (!taskId || e.taskId === taskId));
    // Lo que no tiene tarea no interviene: ni un bloque sin tarea ni lo imputado sin tarea hacen nada en ClickUp,
    // y lo que haya a la hora de un bloque sin tarea se queda como está.
    const tramosSinTarea = delDia(fecha).filter(e => !e.taskId).map(e => [toMin(e.start), finDe(e)]);
    const intocable = r => {
        if (!r.taskId) return true;
        const d = new Date(r.ini), a = d.getHours() * 60 + d.getMinutes();
        return tramosSinTarea.some(([i, f]) => a < f && a + r.dur / 60000 > i);
    };
    const libres = (state.remotas[fecha] || []).filter(r => (!taskId || r.taskId === taskId) && (!r.userId || String(r.userId) === yo) && !intocable(r));
    const conservar = [], crear = [];
    for (const e of bloques) {
        const inicio = msDe(e.date, e.start), dur = duracion(e) * 60000;
        const igual = r => r.taskId === e.taskId && r.ini === inicio && r.dur === dur && (!e.nota || r.nota === e.nota);
        const r = libres.find(x => x.id === String(e.cuId) && igual(x)) || libres.find(igual);
        if (r) { libres.splice(libres.indexOf(r), 1); conservar.push([e, r]); }
        else crear.push(e);
    }
    // Un bloque movido desde otro día deja allí su imputación anterior: también se sustituye.
    const reclamadas = new Set(crear.map(e => String(e.cuId)));
    const otrosDias = [...new Set(crear.filter(e => e.cuId && e.cuSig).map(e => e.cuSig.split('|')[0]).filter(d => d !== fecha))];
    for (const d of otrosDias) await cargarRemotas(d, d);
    const movidas = otrosDias.flatMap(d => state.remotas[d] || []).filter(r => reclamadas.has(r.id));
    return {
        fecha, conservar, crear, borrar: [...libres, ...movidas],
        sinBloque: libres.filter(r => !state.entradas.some(o => String(o.cuId) === r.id)),
    };
}

/** Ejecuta el plan. Primero crea y solo si todo ha ido bien borra, para no perder tiempo imputado:
 *  si algo falla, repetir termina el trabajo sin duplicar. */
export async function imputar(plan) {
    const avisos = [];
    let hechas = 0, borradas = 0;
    for (const [e, r] of plan.conservar) {
        if (String(e.cuId) !== r.id || e.cuSig !== firma(e)) hechas++;
        e.cuId = r.id;
        e.cuSig = firma(e);
    }
    await guardar('entradas');
    for (const e of plan.crear) {
        try {
            const nuevo = await api.crearEntrada(e.taskId, msDe(e.date, e.start), duracion(e) * 60000, e.nota);
            e.cuId = nuevo ? String(nuevo) : '?';
            e.cuSig = firma(e);
            await guardar('entradas');
            hechas++;
        } catch (err) { avisos.push(`${e.start} ${e.taskName}: ${err.message}`); }
    }
    if (avisos.length) avisos.push('No se ha borrado nada en ClickUp. Vuelve a imputar para terminar.');
    else {
        for (const r of plan.borrar) {
            try {
                await api.borrarEntrada(r.id);
                olvidarRemota(r.id);
                // Otro bloque que dependiera de esa imputación queda pendiente.
                for (const o of state.entradas) if (String(o.cuId) === r.id) { o.cuId = null; o.cuSig = null; }
                borradas++;
            } catch { avisos.push(`${r.taskName}: la imputación anterior sigue en ClickUp, bórrala allí.`); }
        }
        await guardar('entradas');
    }
    await cargarRemotas(plan.fecha, plan.fecha).catch(() => {});
    await refrescarImputado([...plan.crear.map(e => e.taskId), ...plan.borrar.map(r => r.taskId)]);
    return { hechas, borradas, avisos };
}
