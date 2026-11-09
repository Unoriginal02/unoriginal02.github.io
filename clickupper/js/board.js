// Vista Tablero: una columna por proyecto, con tareas y subtareas, y la columna + al final.
import { h, fmtMin, parseEstimacion, siguienteNombre, capital } from './util.js';
import { state, guardar } from './store.js';
import * as m from './model.js';
import { aviso, error, popover, cerrarPopover, dialogo, buscador, tareaPorId } from './ui.js';
import { panelesTarea } from './detalle.js';

const raiz = () => document.getElementById('columnas');
let redibujar = () => {};
let buscando = false;         // la columna + está abierta
let resaltar = null;          // tarea a la que llevar la vista tras añadirla

export function iniciar(alCambiar) { redibujar = alCambiar; arrastreProyectos(document.getElementById('tablero-zona')); }

// Colaboración con el registro: arrastrar una tarea lleva su id.
export const TIPO_ARRASTRE = 'application/x-clickupper-task';
const TIPO_COLUMNA = 'application/x-clickupper-col';

let arrastrado = null;         // { id, x, y, entera } del proyecto que se está arrastrando, o de su pila entera

/** Dónde caería un proyecto soltado aquí. Por la parte de arriba se mueve de columna; en la parte de abajo de otra
 *  se apila, y esa parte mengua con cada proyecto: la mitad, el tercio y el cuarto de abajo. Dentro de su propia
 *  columna se reordena, y la cabecera de arriba es la salida. Una pila entera solo cambia de sitio: nunca se apila. */
function destinoDe(zona, id, x, y, entera) {
    const pilas = [...zona.querySelectorAll('.pila')];
    const pila = pilas.find(p => { const b = p.getBoundingClientRect(); return x >= b.left && x < b.right; });
    if (pila && !entera) {
        const cols = [...pila.querySelectorAll('.col[data-lista]')];
        const ids = cols.map(c => c.dataset.lista);
        const b = pila.getBoundingClientRect();
        if (ids.includes(id) && ids.length > 1) {
            if (y >= cols[0].querySelector('.col-cab').getBoundingClientRect().bottom) {
                const sig = cols.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
                return { tipo: 'pila', con: id, antesDe: sig?.dataset.lista ?? null, marca: sig ? [sig, 'ins-arriba'] : [cols.at(-1), 'ins-abajo'] };
            }
        } else if (!ids.includes(id) && ids.length < m.MAX_PILA) {
            const parte = b.height / (ids.length + 1);
            if (y >= b.bottom - parte) {
                pila.style.setProperty('--zona', `${parte}px`);
                return { tipo: 'pila', con: ids[0], antesDe: null, marca: [pila, 'soltar-abajo'] };
            }
        }
    }
    const sig = pilas.find(p => { const b = p.getBoundingClientRect(); return x < b.left + b.width / 2; });
    return {
        tipo: 'columna', antesDe: sig?.querySelector('.col[data-lista]').dataset.lista ?? null,
        marca: sig ? [sig, 'ins-antes'] : [pilas.at(-1), 'ins-despues'],
    };
}

/** Colocar proyectos arrastrando su cabecera. Se guarda en este navegador, no en ClickUp. */
function arrastreProyectos(zona) {
    const r = raiz();
    const limpiar = () => zona.querySelectorAll('.pila, .col').forEach(c => c.classList.remove('ins-antes', 'ins-despues', 'soltar-abajo', 'ins-arriba', 'ins-abajo'));
    zona.addEventListener('dragover', e => {
        if (!arrastrado || !e.dataTransfer.types.includes(TIPO_COLUMNA)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        limpiar();
        const { marca } = destinoDe(zona, arrastrado.id, e.clientX, e.clientY, arrastrado.entera);
        marca[0]?.classList.add(marca[1]);
        const b = r.getBoundingClientRect();
        if (e.clientX < b.left + 60) r.scrollLeft -= 30;
        else if (e.clientX > b.right - 60) r.scrollLeft += 30;
    });
    zona.addEventListener('dragleave', e => { if (!zona.contains(e.relatedTarget)) limpiar(); });
    zona.addEventListener('dragend', () => { limpiar(); arrastrado = null; });
    zona.addEventListener('drop', e => {
        const id = e.dataTransfer.getData(TIPO_COLUMNA);
        if (!id || !arrastrado) return;
        e.preventDefault();
        const { entera } = arrastrado;
        const d = destinoDe(zona, id, e.clientX, e.clientY, entera);
        // Un temblor al soltar no es un movimiento.
        const quieto = Math.hypot(e.clientX - arrastrado.x, e.clientY - arrastrado.y) < 12;
        limpiar();
        arrastrado = null;
        if (quieto) return;
        if (entera) accion(m.moverPila(id, d.antesDe));
        else accion(d.tipo === 'pila' ? m.apilarProyecto(id, d.con, d.antesDe) : m.moverAColumna(id, d.antesDe));
    });
}

// Iconos de la tarjeta, siempre visibles para que nada se mueva al pasar el ratón.
function icono(...formas) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('class', 'ico-svg');
    for (const [tag, attrs] of formas) {
        const f = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) f.setAttribute(k, v);
        s.append(f);
    }
    return s;
}
const icoUsuario = () => icono(['circle', { cx: 8, cy: 5, r: 3 }], ['path', { d: 'M2.5 14c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5' }]);
const icoMas = () => icono(['path', { d: 'M8 3v10M3 8h10' }]);
const icoRegistrar = () => icono(['path', { d: 'M2.5 8h11M9 3.5 13.5 8 9 12.5' }]);
const icoTodas = () => icono(['circle', { cx: 6, cy: 5, r: 2.5 }], ['path', { d: 'M1.5 13.5c.5-2.6 2.2-4 4.5-4s4 1.4 4.5 4' }], ['circle', { cx: 11.5, cy: 5.5, r: 2 }], ['path', { d: 'M11 9.6c1.9 0 3.2 1.2 3.6 3.4' }]);
const icoAsa = () => icono(...[5, 11].flatMap(cx => [3.5, 8, 12.5].map(cy => ['circle', { cx, cy, r: 1, class: 'punto-asa' }])));

async function accion(p, ok) {
    try { await p; if (ok) aviso(ok, 'bien'); }
    catch (e) { error(e); }
    redibujar();
}

// ── Tarjeta ──────────────────────────────────────────────────────────────
function chipEstado(t, lista) {
    return h('button', {
        class: 'chip estado', style: `--c:${t.status?.color || 'var(--fg-mute)'}`, title: 'Cambiar estado',
        onclick: e => {
            e.stopPropagation();
            const ops = [...(lista.statuses || [])].sort((a, b) => a.orderindex - b.orderindex);
            popover(e.currentTarget, h('div', { class: 'menu' }, ops.map(s => h('button', {
                class: `menu-fila ${s.status === t.status?.status ? 'on' : ''}`, style: `--c:${s.color}`,
                onclick: () => { cerrarPopover(); accion(m.cambiarEstado(t, s), `Estado: ${capital(s.status)}`); },
            }, h('i', { class: 'punto' }), capital(s.status)))));
        },
    }, capital(t.status?.status) || '—');
}

function chipEstimacion(t) {
    return h('button', {
        class: `chip est ${t.time_estimate ? '' : 'vacio'}`, title: 'Cambiar el tiempo estimado',
        onclick: e => { e.stopPropagation(); editarEstimacion(e.currentTarget, t); },
    }, t.time_estimate ? `Estimado ${fmtMin(t.time_estimate / 60000)}` : '+ Tiempo estimado');
}

function chipImputado(t, lista, etiqueta = '') {
    const total = m.imputadoDe(t, lista);
    if (!total) return false;
    const propio = +t.time_spent || 0;
    return h('span', {
        class: 'chip imp',
        title: `Imputado en ClickUp, por cualquier persona${total !== propio ? `. ${fmtMin(propio / 60000)} en esta tarea y ${fmtMin((total - propio) / 60000)} en sus subtareas` : ''}`,
    }, `${etiqueta}${fmtMin(total / 60000)}`);
}

function editarEstimacion(ancla, t) {
    const inp = h('input', {
        class: 'campo', placeholder: '2h, 1h30, 45m…', spellcheck: 'false',
        value: t.time_estimate ? fmtMin(t.time_estimate / 60000).replace(' ', '') : '',
        onkeydown: e => {
            if (e.key !== 'Enter') return;
            const ms = parseEstimacion(inp.value);
            if (ms === undefined) { aviso('No entiendo ese tiempo. Prueba con 2h, 1h30 o 45m.', 'mal'); return; }
            cerrarPopover();
            accion(m.cambiarEstimacion(t, ms), ms === null ? 'Estimación borrada' : `Estimación: ${fmtMin(ms / 60000)}`);
        },
    });
    popover(ancla, h('div', { class: 'pop-campo' }, h('label', {}, 'Tiempo estimado'), inp, h('small', {}, 'Enter para guardar · vacío para borrar')));
    inp.select();
}

function botonAsignar(t) {
    const mia = m.esMia(t);
    const texto = mia ? 'Asignada a ti: pulsa para quitarte' : 'Sin asignar a ti: pulsa para asignártela';
    return h('button', {
        class: `ico usuario ${mia ? 'on' : ''}`, title: texto, 'aria-label': texto, 'aria-pressed': String(mia),
        onclick: e => { e.stopPropagation(); accion(m.asignarme(t, !mia), mia ? 'Ya no la tienes asignada' : 'Asignada a ti'); },
    }, icoUsuario());
}

function composer(ancla, lista, padre) {
    const hermanas = padre ? lista.tasks.filter(t => t.parent === padre.id).sort((a, b) => +b.date_created - +a.date_created) : [];
    const inp = h('input', {
        class: 'campo', spellcheck: 'false', placeholder: padre ? 'Nombre de la subtarea' : 'Nombre de la tarea',
        value: hermanas[0] ? siguienteNombre(hermanas[0].name) : '',
        onkeydown: e => {
            if (e.key !== 'Enter' || !inp.value.trim()) return;
            const nombre = inp.value.trim();
            cerrarPopover();
            accion(m.crearTarea(lista, nombre, padre), `Creada: ${nombre}`);
        },
    });
    popover(ancla, h('div', { class: 'pop-campo' },
        h('label', {}, padre ? `Subtarea de ${padre.name}` : `Tarea nueva en ${lista.name}`), inp, h('small', {}, 'Enter para crear')));
    inp.select();
}

function tarjeta(nodo, lista) {
    const { t, hijos } = nodo;
    const plegada = state.prefs.plegadas.includes(t.id);
    const el = h('article', {
        class: `tarea ${nodo.nivel === 0 ? 'raiz' : ''} ${m.esCerrada(t) ? 'cerrada' : ''} ${resaltar === t.id ? 'resaltada' : ''}`,
        draggable: 'true', 'data-id': t.id, style: `--nivel:${nodo.nivel}`,
        ondragstart: e => {
            e.dataTransfer.setData(TIPO_ARRASTRE, t.id);
            e.dataTransfer.effectAllowed = 'copy';
            document.body.classList.add('arrastrando');
        },
        ondragend: () => document.body.classList.remove('arrastrando'),
    },
        h('div', { class: 'tarea-l1' },
            hijos.length
                ? h('button', {
                    class: 'plegar', title: plegada ? 'Mostrar subtareas' : 'Ocultar subtareas',
                    onclick: () => {
                        const p = state.prefs;
                        p.plegadas = plegada ? p.plegadas.filter(x => x !== t.id) : [...p.plegadas, t.id];
                        guardar('prefs'); redibujar();
                    },
                }, plegada ? '▸' : '▾')
                : nodo.nivel === 0 && h('span', { class: 'plegar' }),
            h('button', { class: 'tarea-nombre', title: 'Ver el detalle', onclick: () => detalle(t, lista) }, t.name),
        ),
        h('div', { class: 'tarea-l2' },
            chipEstado(t, lista), chipImputado(t, lista),
            h('span', { class: 'acciones' },
                botonAsignar(t),
                // Desde aquí, las subtareas no crean subtareas.
                nodo.nivel === 0 && h('button', { class: 'ico sub', title: 'Crear una subtarea', 'aria-label': 'Crear una subtarea', onclick: e => composer(e.currentTarget, lista, t) }, icoMas()),
                h('button', { class: 'ico registrar', title: 'Añadir al registro de este día (o arrástrala)', 'aria-label': 'Añadir al registro', onclick: () => registrar?.(t.id) }, icoRegistrar()),
            ),
        ),
    );
    return [el, plegada ? [] : hijos.map(x => tarjeta(x, lista))];
}

let registrar = null;
export const alRegistrar = fn => { registrar = fn; };

// ── Detalle de una tarea ─────────────────────────────────────────────────
function detalle(t, lista) {
    const pinta = () => cab.replaceChildren(
        h('div', { class: 'det-ruta' }, `${lista.name} · ${m.rutaDe(t, lista)}`),
        h('div', { class: 'det-fila' },
            chipEstado(t, lista), chipEstimacion(t), chipImputado(t, lista, 'Imputado '),
            botonAsignar(t),
            h('span', { class: 'hueco' }),
            h('a', { class: 'btn', href: t.url || `https://app.clickup.com/t/${t.id}`, target: '_blank', rel: 'noopener' }, 'Abrir en ClickUp ↗')),
        h('div', { class: 'det-gente' }, (t.assignees || []).length
            ? `Asignada a: ${t.assignees.map(a => a.username || a.initials).join(', ')}`
            : 'Sin asignar'),
    );
    const cab = h('div', { class: 'detalle' });
    pinta();
    const paneles = panelesTarea(t.id);
    paneles.aceptarArchivos(dialogo(t.name, [cab, paneles.el], { clase: 'dlg-detalle', puedeCerrar: paneles.puedeCerrar }));
    detalleAbierto = pinta;
}
let detalleAbierto = null;

// ── Columnas ─────────────────────────────────────────────────────────────
/** El asa para llevarse la pila entera. Va en la cabecera de arriba, para que todas las columnas sigan alineadas. */
function asaPila(lista) {
    const texto = 'Arrastra para mover toda la columna';
    return h('span', {
        class: 'asa-pila', draggable: 'true', title: texto, 'aria-label': texto,
        ondragstart: e => {
            // Sin esto, la cabecera lo tomaría por un arrastre de su proyecto.
            e.stopPropagation();
            const pila = e.currentTarget.closest('.pila');
            e.dataTransfer.setData(TIPO_COLUMNA, lista.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setDragImage(pila, 16, 16);
            arrastrado = { id: lista.id, x: e.clientX, y: e.clientY, entera: true };
            // Después de crear la imagen del arrastre, que si no saldría atenuada.
            setTimeout(() => pila.classList.add('col-movida'));
        },
        // Sube hasta el tablero, que borra las marcas y da por terminado el arrastre, también con Esc.
        ondragend: e => e.currentTarget.closest('.pila')?.classList.remove('col-movida'),
    }, icoAsa());
}

/** Todas / solo las mías, para este proyecto. */
function botonTodas(lista) {
    const todas = m.verTodas(lista.id);
    const texto = todas ? 'Viendo todas: pulsa para ver solo las tuyas' : 'Viendo las tuyas: pulsa para ver todas';
    return h('button', {
        class: `icono todas ${todas ? 'on' : ''}`, title: texto, 'aria-label': texto, 'aria-pressed': String(todas),
        onclick: () => accion(m.verTodasEn(lista.id, !todas)),
    }, icoTodas());
}

function columna(lista, conAsa) {
    const nodos = m.arbol(lista);
    const url = `https://app.clickup.com/${state.user.teamId}/v/li/${lista.id}`;
    return h('section', { class: 'col', 'data-lista': lista.id },
        h('header', {
            class: 'col-cab', draggable: 'true', title: 'Arrastra para cambiar de sitio',
            ondragstart: e => {
                e.dataTransfer.setData(TIPO_COLUMNA, lista.id);
                e.dataTransfer.effectAllowed = 'move';
                arrastrado = { id: lista.id, x: e.clientX, y: e.clientY };
                e.currentTarget.closest('.col').classList.add('col-movida');
            },
            ondragend: e => e.currentTarget.closest('.col')?.classList.remove('col-movida'),
        },
            conAsa && asaPila(lista),
            h('a', { class: 'col-nombre', draggable: 'false', href: url, target: '_blank', rel: 'noopener', title: `${lista.carpeta ? `${lista.carpeta} · ` : ''}Abrir en ClickUp` }, lista.name),
            botonTodas(lista),
            h('button', { class: 'icono', title: 'Crear tarea en este proyecto', onclick: e => composer(e.currentTarget, lista, null) }, '+'),
            h('button', { class: 'icono', title: 'Quitar esta columna del tablero', onclick: () => accion(m.ocultarProyecto(lista.id), `${lista.name} fuera del tablero. Vuelve con el botón +.`) }, '×'),
        ),
        h('div', { class: 'col-cuerpo' },
            nodos.length ? nodos.map(n => tarjeta(n, lista)) : h('p', { class: 'col-vacia' },
                !m.verTodas(lista.id) ? 'Nada asignado a ti aquí. El botón de personas de arriba enseña todas.' : 'Este proyecto no tiene tareas abiertas.')),
    );
}

function columnaMas() {
    if (!buscando) {
        return h('section', { class: 'col col-mas' },
            h('button', { class: 'mas', title: 'Añadir un proyecto o una tarea', onclick: () => { buscando = true; redibujar(); } }, '+'));
    }
    return h('section', { class: 'col col-buscar' },
        h('header', { class: 'col-cab' }, h('span', { class: 'col-nombre' }, 'Añadir al tablero'),
            h('button', { class: 'icono', title: 'Cerrar', onclick: () => { buscando = false; redibujar(); } }, '×')),
        buscador({ placeholder: 'Proyecto, tarea, ID o enlace', alElegir: añadirDesdeBuscador }),
    );
}

async function añadirDesdeBuscador(f) {
    aviso('Cargando…');
    try {
        let listId = f.listId || f.id, tareaId = null;
        if (f.tipo !== 'proyecto') {
            tareaId = f.id;
            if (f.tipo === 'porId') listId = (await tareaPorId(f.id)).list?.id;
        }
        if (!listId) throw new Error('Esa tarea no tiene proyecto.');
        await m.añadirProyecto(listId);
        buscando = false;
        resaltar = tareaId;
        aviso(`${state.tablero[listId].name} en el tablero. Viendo Todas: asígnate lo que te toque.`, 'bien');
        redibujar();
        const destino = tareaId ? raiz().querySelector(`[data-id="${CSS.escape(tareaId)}"]`) : null;
        (destino || raiz().querySelector(`[data-lista="${CSS.escape(listId)}"]`))
            ?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
        setTimeout(() => { resaltar = null; }, 100);
    } catch (e) { error(e); }
}

// ── Pintado ──────────────────────────────────────────────────────────────
export function pintar() {
    const r = raiz();
    // El buscador abierto se conserva tal cual, para no perder lo tecleado.
    const antesX = r.scrollLeft;
    const scrolls = new Map([...r.querySelectorAll('.col')].map(c => [c.dataset.lista, c.querySelector('.col-cuerpo')?.scrollTop]));
    const buscadorVivo = buscando ? r.querySelector('.col-buscar') : null;
    const cols = m.columnas().map(grupo => h('div', { class: 'pila' }, grupo.map((l, i) => columna(l, i === 0 && grupo.length > 1))));
    r.replaceChildren(...cols, buscadorVivo || columnaMas());
    if (!cols.length && !buscando && !Object.keys(state.tablero).length) {
        r.prepend(h('p', { class: 'tablero-vacio' }, 'Aún no hay proyectos. Si acabas de conectar, se están cargando.'));
    }
    r.scrollLeft = antesX;
    r.querySelectorAll('.col').forEach(c => {
        const b = c.querySelector('.col-cuerpo');
        if (b && scrolls.get(c.dataset.lista)) b.scrollTop = scrolls.get(c.dataset.lista);
    });
    detalleAbierto = document.querySelector('dialog.dlg') ? detalleAbierto : null;
    detalleAbierto?.();
}

