// Piezas de interfaz compartidas: barra de estado, desplegables, diálogos, selector de hora y buscador.
import { h, pad, toHHMM, toMin, parecido, idDeTarea } from './util.js';
import { state } from './store.js';
import * as api from './api.js';
import { asegurarCatalogo, asegurarIndice } from './model.js';

// ── Barra de estado ──────────────────────────────────────────────────────
export function aviso(texto, tipo = '') {
    const el = document.getElementById('estado');
    el.textContent = texto;
    el.className = tipo;
}
export const error = e => aviso(e.message || String(e), 'mal');

// ── Desplegable anclado a un botón ───────────────────────────────────────
let abierto = null;

export function cerrarPopover() {
    if (!abierto) return;
    abierto.el.remove();
    document.removeEventListener('pointerdown', abierto.fuera, true);
    document.removeEventListener('keydown', abierto.esc, true);
    abierto = null;
}

export function popover(ancla, contenido, clase = '') {
    cerrarPopover();
    const el = h('div', { class: `popover ${clase}` }, contenido);
    (ancla.closest('dialog') || document.body).append(el);
    const a = ancla.getBoundingClientRect(), b = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(a.left, innerWidth - b.width - 8))}px`;
    el.style.top = `${a.bottom + b.height + 4 > innerHeight ? Math.max(8, a.top - b.height - 4) : a.bottom + 4}px`;
    const fuera = e => { if (!el.contains(e.target)) cerrarPopover(); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); cerrarPopover(); } };
    document.addEventListener('pointerdown', fuera, true);
    document.addEventListener('keydown', esc, true);
    abierto = { el, fuera, esc };
    return el;
}

// ── Selector de hora: el del Companion, con rueda, flechas y atajos de cuarto ───────
export function selectorHora(ancla, valor, alElegir) {
    let min = toMin(valor);
    const hh = h('b'), mm = h('b');
    const pinta = () => { hh.textContent = pad(Math.floor(min / 60)); mm.textContent = pad(min % 60); };
    const mover = d => { min = (min + d + 1440) % 1440; pinta(); };
    const rueda = (el, paso) => {
        el.addEventListener('wheel', e => { e.preventDefault(); mover(e.deltaY < 0 ? paso : -paso); }, { passive: false });
        return el;
    };
    const aceptar = () => { cerrarPopover(); alElegir(toHHMM(min)); };
    const columna = (txt, paso) => rueda(h('div', { class: 'rueda' },
        h('button', { onclick: () => mover(paso), title: 'Subir' }, '▲'), txt,
        h('button', { onclick: () => mover(-paso), title: 'Bajar' }, '▼')), paso);
    const pop = popover(ancla, h('div', {
        class: 'selector-hora', tabindex: 0,
        onkeydown: e => {
            if (e.key === 'ArrowUp') { e.preventDefault(); mover(15); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); mover(-15); }
            else if (e.key === 'Enter') aceptar();
        },
    },
        h('div', { class: 'ruedas' }, columna(hh, 60), h('span', {}, ':'), columna(mm, 15)),
        h('div', { class: 'cuartos' }, [0, 15, 30, 45].map(c =>
            h('button', { onclick: () => { min = min - (min % 60) + c; pinta(); } }, `:${pad(c)}`))),
        h('button', { class: 'btn primario', onclick: aceptar }, 'Aceptar'),
    ));
    pinta();
    pop.querySelector('.selector-hora').focus();
}

// ── Diálogos ─────────────────────────────────────────────────────────────
export function dialogo(titulo, cuerpo, { clase = '', alCerrar, puedeCerrar } = {}) {
    const intentar = async () => { if (!puedeCerrar || await puedeCerrar()) d.close(); };
    const d = h('dialog', { class: `dlg ${clase}` },
        h('header', {}, h('span', {}, titulo), h('button', { class: 'icono', title: 'Cerrar', onclick: intentar }, '×')),
        h('div', { class: 'dlg-cuerpo' }, cuerpo));
    d.addEventListener('close', () => { d.remove(); alCerrar?.(); });
    d.addEventListener('pointerdown', e => { if (e.target === d) intentar(); });
    if (puedeCerrar) d.addEventListener('cancel', e => { e.preventDefault(); intentar(); });
    document.body.append(d);
    d.showModal();
    return d;
}

/** Pregunta con varias salidas. Devuelve el valor elegido, o null si se cierra. */
export function preguntar(titulo, texto, opciones) {
    return new Promise(ok => {
        let res = null;
        const d = dialogo(titulo, [
            h('p', {}, texto),
            h('div', { class: 'dlg-pie' }, opciones.map(o =>
                h('button', { class: `btn ${o.clase || ''}`, onclick: () => { res = o.valor; d.close(); } }, o.texto))),
        ], { alCerrar: () => ok(res) });
    });
}

// ── Buscador de proyectos y tareas ───────────────────────────────────────
/** Devuelve el panel del buscador. `proyectos`: incluir proyectos. alElegir({ tipo, ... }). */
export function buscador({ proyectos = true, alElegir, placeholder }) {
    const entrada = h('input', { class: 'campo', placeholder, spellcheck: 'false' });
    const lista = h('div', { class: 'res' });
    const nota = h('div', { class: 'res-nota' });
    let filas = [], marcada = 0, texto = '';

    const elegir = f => f && alElegir(f);

    function pinta() {
        const q = texto.trim();
        filas = [];
        const enTablero = id => !!state.tablero[id] && !state.prefs.ocultos.includes(id);
        if (proyectos) {
            const ps = (state.catalogo?.listas || [])
                .map(l => ({ l, n: parecido(q, `${l.name} ${l.carpeta}`) })).filter(x => x.n > 0)
                .sort((a, b) => b.n - a.n).slice(0, q ? 12 : 40);
            filas.push(...ps.map(({ l }) => ({ tipo: 'proyecto', id: l.id, name: l.name, sub: l.carpeta, dentro: enTablero(l.id) })));
        }
        if (q) {
            const ts = (state.indice?.tareas || [])
                .map(t => ({ t, n: parecido(q, t.name) - (t.cerrada ? 0.4 : 0) })).filter(x => x.n > 0)
                .sort((a, b) => b.n - a.n).slice(0, 30);
            filas.push(...ts.map(({ t }) => ({ tipo: 'tarea', id: t.id, name: t.name, sub: t.listName, listId: t.listId, cerrada: t.cerrada })));
            const id = idDeTarea(q);
            if (id && !filas.some(f => f.id === id)) filas.unshift({ tipo: 'porId', id, name: `Buscar la tarea ${id}`, sub: 'Por ID o enlace' });
        }
        marcada = Math.min(marcada, Math.max(0, filas.length - 1));
        lista.replaceChildren(...filas.map((f, i) => h('button', {
            class: `res-fila ${i === marcada ? 'on' : ''} ${f.cerrada ? 'apagada' : ''}`,
            onclick: () => elegir(f),
        },
            h('span', { class: 'res-tipo' }, f.tipo === 'proyecto' ? 'Proy' : 'Tarea'),
            h('span', { class: 'res-nombre' }, f.name),
            h('span', { class: 'res-sub' }, f.dentro ? 'Ya en el tablero' : f.sub || ''),
        )));
        if (!filas.length && q) lista.append(h('div', { class: 'res-vacio' }, 'Nada coincide. También puedes pegar una ID o un enlace de tarea.'));
    }

    entrada.addEventListener('input', () => { texto = entrada.value; marcada = 0; pinta(); });
    entrada.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            marcada = (marcada + (e.key === 'ArrowDown' ? 1 : -1) + filas.length) % (filas.length || 1);
            pinta();
            lista.children[marcada]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') elegir(filas[marcada]);
    });

    async function cargar(forzar) {
        nota.textContent = 'Cargando proyectos…';
        try {
            if (proyectos) await asegurarCatalogo(forzar);
            pinta();
            await asegurarIndice(forzar, n => {
                nota.textContent = `Leyendo tareas de ClickUp… ${n}. Ya puedes buscar en lo leído.`;
                if (texto.trim()) pinta();
            });
            nota.textContent = '';
            pinta();
        } catch (e) { nota.textContent = e.message; }
    }

    const panel = h('div', { class: 'buscador' },
        h('div', { class: 'buscador-linea' }, entrada,
            h('button', { class: 'icono', title: 'Volver a leer ClickUp', onclick: () => cargar(true) }, '⟳')),
        nota, lista);
    pinta();
    cargar(false);
    setTimeout(() => entrada.focus());
    return panel;
}

/** Datos de una tarea elegida por ID: la pide a ClickUp. */
export const tareaPorId = id => api.tarea(id);
