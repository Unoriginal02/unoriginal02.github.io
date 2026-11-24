// Bloc de notas: ala a la izquierda con notas sueltas. Cada nota es texto con formato (las mismas marcas que la descripción),
// con casilla de hecha, tira de color de importancia y borrar; se reordenan arrastrándolas. Se guardan en este navegador,
// dentro de prefs, así que van también en la copia.
import { h } from './util.js';
import { state, guardar } from './store.js';
import { deMarkdown, pintarBloques } from './formato.js';
import { popover, cerrarPopover } from './ui.js';
import { envolver, reemplazar } from './detalle.js';

const TIPO = 'application/x-clickupper-nota';
const ANCHO = { min: 200, max: 640, inicial: 280 };
const IMPORTANCIA = [
    { valor: '', nombre: 'Sin importancia', color: 'var(--border)' },
    { valor: 'baja', nombre: 'Baja', color: 'var(--green)' },
    { valor: 'media', nombre: 'Media', color: 'var(--yellow)' },
    { valor: 'alta', nombre: 'Alta', color: 'var(--red)' },
];

let editando = null;      // id de la nota abierta para escribir
let pendiente = null;     // guardado diferido mientras se escribe
let movida = null;        // id de la nota que se arrastra

const panel = () => document.getElementById('notas');
const notas = () => state.prefs.notas;
const deId = id => notas().find(n => n.id === id);
const tarjetaDe = id => panel().querySelector(`[data-nota="${CSS.escape(id)}"]`);
const importancia = n => IMPORTANCIA.find(i => i.valor === (n.importancia || '')) || IMPORTANCIA[0];
const nuevoId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Los botones de la tarjeta no le quitan el foco al texto que se está escribiendo.
const sinRobarFoco = e => e.preventDefault();

export function iniciar() {
    document.getElementById('notas-boton').addEventListener('click', () => {
        state.prefs.alaNotas = !state.prefs.alaNotas;
        guardar('prefs');
        pintar();
    });
}

// ── Cambios ──────────────────────────────────────────────────────────────
function nueva() {
    const n = { id: nuevoId(), texto: '', hecha: false, importancia: '' };
    notas().push(n);
    editando = n.id;
    guardar('prefs');
    pintar();
    const ta = tarjetaDe(n.id)?.querySelector('textarea');
    ta?.scrollIntoView({ block: 'nearest' });
    ta?.focus();
}

function borrar(id) {
    if (editando === id) editando = null;
    state.prefs.notas = notas().filter(n => n.id !== id);
    tarjetaDe(id)?.remove();
    guardar('prefs');
}

function marcar(id) {
    const n = deId(id);
    if (!n) return;
    n.hecha = !n.hecha;
    // Se cambia en su sitio, sin rehacer la tarjeta: así no se cierra el texto si se está escribiendo.
    const t = tarjetaDe(id), casilla = t?.querySelector('.nota-casilla');
    t?.classList.toggle('hecha', n.hecha);
    if (casilla) {
        casilla.textContent = n.hecha ? '✓' : '';
        casilla.setAttribute('aria-checked', String(n.hecha));
        casilla.title = n.hecha ? 'Marcar como pendiente' : 'Marcar como hecha';
    }
    guardar('prefs');
}

function elegirImportancia(ancla, id) {
    const n = deId(id);
    if (!n) return;
    popover(ancla, h('div', { class: 'menu' }, IMPORTANCIA.map(i => h('button', {
        class: `menu-fila ${i === importancia(n) ? 'on' : ''}`, style: `--c:${i.color}`,
        onmousedown: sinRobarFoco,
        onclick: () => {
            cerrarPopover();
            const actual = deId(id);
            if (!actual) return;
            actual.importancia = i.valor;
            const t = tarjetaDe(id);
            t?.style.setProperty('--c', i.color);
            t?.querySelector('.nota-tira')?.setAttribute('title', `Importancia: ${i.nombre}`);
            guardar('prefs');
        },
    }, h('i', { class: 'punto' }), i.nombre))));
}

// ── Escribir ─────────────────────────────────────────────────────────────
function enfocar(id) {
    const ta = tarjetaDe(id)?.querySelector('textarea');
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
}

function editar(id) {
    const n = deId(id);
    if (!n) return;
    editando = id;
    tarjetaDe(id)?.replaceWith(tarjeta(n));
    enfocar(id);
}

/** Al salir del texto se vuelve a ver con formato. Una nota que se queda vacía desaparece. */
function terminar(id) {
    if (editando !== id) return;
    editando = null;
    clearTimeout(pendiente);
    const n = deId(id);
    if (n && !n.texto.trim()) borrar(id);
    else {
        if (n) tarjetaDe(id)?.replaceWith(tarjeta(n));
        guardar('prefs');
    }
}

function ajustarAlto(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
}

// ── Listas: Enter sigue la viñeta, Enter en una viñeta vacía la quita, Tab / Mayús+Tab sangran ──
const VIÑETA = /^(\s*)([-*+])\s+(.*)$/;

/** Inicio y fin de las líneas que toca la selección. */
function lineas(ta) {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const ini = value.lastIndexOf('\n', a - 1) + 1;
    const f = value.indexOf('\n', b);
    return { ini, fin: f < 0 ? value.length : f };
}

/** Pone o quita "- " en las líneas tocadas: si todas son ya viñetas, las vuelve texto. */
function alternarLista(ta) {
    const { ini, fin } = lineas(ta);
    const filas = ta.value.slice(ini, fin).split('\n');
    const todas = filas.every(l => VIÑETA.test(l));
    const texto = filas.map(l => todas ? l.replace(/^(\s*)[-*+]\s+/, '') : `- ${l}`).join('\n');
    reemplazar(ta, ini, fin, texto, ini + texto.length, ini + texto.length);
}

function enter(ta, e) {
    const { ini } = lineas(ta);
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const finLinea = value.indexOf('\n', a);
    const linea = value.slice(ini, finLinea < 0 ? value.length : finLinea);
    const m = linea.match(VIÑETA);
    if (!m || a - ini < m[1].length + 2) return;   // no es viñeta, o el cursor está antes de la marca
    e.preventDefault();
    if (!m[3].trim() && a === b) {
        // Viñeta vacía: vuelve a ser texto normal.
        reemplazar(ta, ini, ini + linea.length, '', ini, ini);
        return;
    }
    const nueva = `\n${m[1]}- `;
    reemplazar(ta, a, b, nueva, a + nueva.length, a + nueva.length);
}

function sangrar(ta, e) {
    const { ini, fin } = lineas(ta);
    const filas = ta.value.slice(ini, fin).split('\n');
    if (!filas.some(l => VIÑETA.test(l))) return;   // fuera de una lista, Tab hace lo de siempre
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b } = ta;
    let primera = 0;
    const texto = filas.map((l, i) => {
        if (!VIÑETA.test(l)) return l;
        const nueva = e.shiftKey ? l.replace(/^ {1,2}/, '') : `  ${l}`;
        if (i === 0) primera = nueva.length - l.length;
        return nueva;
    }).join('\n');
    const dif = texto.length - (fin - ini);
    reemplazar(ta, ini, fin, texto, Math.max(ini, a + primera), Math.max(ini, b + dif));
}

const BOTONES = [
    ['B', 'Negrita: **texto**', ta => envolver(ta, '**'), 'negrita'],
    ['I', 'Cursiva: _texto_', ta => envolver(ta, '_'), 'cursiva'],
    ['•', 'Lista: - texto', alternarLista, ''],
];

function editor(n) {
    const ta = h('textarea', {
        class: 'nota-editor', rows: 1, spellcheck: 'false', value: n.texto, placeholder: 'Descripción',
        oninput: () => {
            const actual = deId(n.id);
            if (actual) actual.texto = ta.value;
            ajustarAlto(ta);
            clearTimeout(pendiente);
            pendiente = setTimeout(() => guardar('prefs'), 400);
        },
        onkeydown: e => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); }
            else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing) enter(ta, e);
            else if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) sangrar(ta, e);
        },
        // Cambiar de ventana no cierra la nota: al volver sigue abierta.
        onblur: () => { if (document.hasFocus()) terminar(n.id); },
    });
    requestAnimationFrame(() => ajustarAlto(ta));
    const barra = h('div', { class: 'nota-barra' }, BOTONES.map(([txt, titulo, accion, clase]) => h('button', {
        type: 'button', class: clase, title: titulo, 'aria-label': titulo,
        // El foco se queda en el texto, y con él la selección.
        onmousedown: sinRobarFoco, onpointerdown: sinRobarFoco,
        onclick: () => accion(ta),
    }, txt)));
    return h('div', { class: 'nota-edicion' }, barra, ta);
}

// ── Ancho: se cambia arrastrando el borde derecho ───────────────────────
const limitar = px => Math.round(Math.min(ANCHO.max, Math.max(ANCHO.min, px)));

function borde() {
    return h('div', {
        class: 'notas-borde', title: 'Arrastra para cambiar el ancho',
        onpointerdown: e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const p = panel(), asa = e.currentTarget;
            const x0 = e.clientX, w0 = p.getBoundingClientRect().width;
            asa.setPointerCapture(e.pointerId);
            document.body.classList.add('ajustando-ancho');
            const mover = ev => { p.style.width = `${limitar(w0 + ev.clientX - x0)}px`; };
            const soltar = () => {
                asa.removeEventListener('pointermove', mover);
                asa.removeEventListener('pointerup', soltar);
                asa.removeEventListener('pointercancel', soltar);
                document.body.classList.remove('ajustando-ancho');
                state.prefs.anchoNotas = limitar(p.getBoundingClientRect().width);
                guardar('prefs');
            };
            asa.addEventListener('pointermove', mover);
            asa.addEventListener('pointerup', soltar);
            asa.addEventListener('pointercancel', soltar);
        },
        // Doble clic vuelve al ancho de siempre.
        ondblclick: () => { delete state.prefs.anchoNotas; panel().style.width = `${ANCHO.inicial}px`; guardar('prefs'); },
    });
}

// ── Pintar ───────────────────────────────────────────────────────────────
function tarjeta(n) {
    const imp = importancia(n);
    const abierta = editando === n.id;
    return h('div', {
        class: `nota ${n.hecha ? 'hecha' : ''}`, style: `--c:${imp.color}`, 'data-nota': n.id,
        draggable: abierta ? 'false' : 'true',
        ondragstart: e => {
            if (editando === n.id) { e.preventDefault(); return; }
            movida = n.id;
            e.dataTransfer.setData(TIPO, n.id);
            e.dataTransfer.effectAllowed = 'move';
            const t = e.currentTarget;
            requestAnimationFrame(() => t.classList.add('movida'));
        },
        ondragend: e => { movida = null; e.currentTarget.classList.remove('movida'); limpiarMarca(); },
    },
        h('button', { class: 'nota-tira', title: `Importancia: ${imp.nombre}`, onmousedown: sinRobarFoco, onclick: e => elegirImportancia(e.currentTarget, n.id) }),
        h('button', {
            class: 'nota-casilla', role: 'checkbox', 'aria-checked': String(!!n.hecha),
            title: n.hecha ? 'Marcar como pendiente' : 'Marcar como hecha', onmousedown: sinRobarFoco, onclick: () => marcar(n.id),
        }, n.hecha ? '✓' : ''),
        abierta
            ? editor(n)
            : h('div', {
                class: 'nota-texto md', title: 'Pulsa para editar',
                onclick: e => { if (!e.target.closest('a')) editar(n.id); },
            }, pintarBloques(deMarkdown(n.texto))),
        h('button', { class: 'icono', title: 'Borrar nota', onmousedown: sinRobarFoco, onclick: () => borrar(n.id) }, '×'),
    );
}

// ── Reordenar ────────────────────────────────────────────────────────────
function limpiarMarca() {
    panel().querySelectorAll('.ins-arriba, .ins-abajo').forEach(el => el.classList.remove('ins-arriba', 'ins-abajo'));
}

/** Posición donde caería la nota arrastrada, según la altura del puntero: antes de la primera cuya mitad queda por debajo. */
function hueco(lista, y) {
    const tarjetas = [...lista.querySelectorAll('.nota')];
    const i = tarjetas.findIndex(t => { const r = t.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return { tarjetas, i: i < 0 ? tarjetas.length : i };
}

function lista() {
    const el = h('div', { class: 'notas-lista' },
        notas().map(tarjeta),
        h('button', { class: 'nota-mas', title: 'Añadir nota', onclick: nueva }, '+'));
    el.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes(TIPO)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        limpiarMarca();
        const { tarjetas, i } = hueco(el, e.clientY);
        const desde = tarjetas.findIndex(t => t.dataset.nota === movida);
        if (i === desde || i === desde + 1) return;   // se quedaría donde está
        if (i < tarjetas.length) tarjetas[i].classList.add('ins-arriba');
        else tarjetas.at(-1)?.classList.add('ins-abajo');
    });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) limpiarMarca(); });
    el.addEventListener('drop', e => {
        const id = e.dataTransfer.getData(TIPO);
        if (!id) return;
        e.preventDefault();
        limpiarMarca();
        const { i } = hueco(el, e.clientY);
        const todas = notas();
        const desde = todas.findIndex(n => n.id === id);
        if (desde < 0) return;
        const destino = i > desde ? i - 1 : i;
        if (destino === desde) return;
        const [n] = todas.splice(desde, 1);
        todas.splice(destino, 0, n);
        guardar('prefs');
        pintar();
    });
    return el;
}

export function pintar() {
    const p = panel();
    const abierta = !!state.prefs.alaNotas;
    const boton = document.getElementById('notas-boton');
    boton.classList.toggle('on', abierta);
    boton.setAttribute('aria-pressed', String(abierta));
    boton.title = abierta ? 'Recoger las notas' : 'Desplegar las notas';
    p.hidden = !abierta;
    if (!abierta) { editando = null; return; }
    p.style.width = `${limitar(state.prefs.anchoNotas || ANCHO.inicial)}px`;
    // Mientras se escribe una nota no se repinta: se perdería el cursor.
    if (document.activeElement?.classList.contains('nota-editor')) return;
    if (editando && !deId(editando)) editando = null;
    const antes = p.querySelector('.notas-lista')?.scrollTop || 0;
    p.replaceChildren(
        h('header', { class: 'reg-cab' }, h('span', { class: 'panel-titulo' }, 'Notas')),
        lista(),
        borde());
    p.querySelector('.notas-lista').scrollTop = antes;
}
