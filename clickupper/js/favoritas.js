// Ala de tareas favoritas, junto al registro. Se llena soltando tareas del tablero; se guarda en este navegador.
import { h } from './util.js';
import { state, guardar } from './store.js';
import * as m from './model.js';
import { aviso } from './ui.js';
import { TIPO_ARRASTRE } from './board.js';
import { añadirTarea } from './registro.js';

let redibujar = () => {};
const panel = () => document.getElementById('favoritas');

export function iniciar(alCambiar) {
    redibujar = alCambiar;
    const p = panel();
    p.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes(TIPO_ARRASTRE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        p.classList.add('soltar');
    });
    p.addEventListener('dragleave', e => { if (!p.contains(e.relatedTarget)) p.classList.remove('soltar'); });
    p.addEventListener('drop', e => {
        p.classList.remove('soltar');
        const id = e.dataTransfer.getData(TIPO_ARRASTRE);
        if (id) { e.preventDefault(); añadir(id); }
    });
}

function añadir(id) {
    const favs = state.prefs.favoritas;
    if (favs.some(f => f.taskId === id)) return;   // soltar una que ya está, o arrastrarla dentro del ala
    const hallada = m.buscarTarea(id);
    if (!hallada) { aviso('Esa tarea ya no está en el tablero.', 'mal'); return; }
    favs.push(m.datosTarea(hallada.t, hallada.lista));
    guardar('prefs');
    redibujar();
}

function quitar(id) {
    state.prefs.favoritas = state.prefs.favoritas.filter(f => f.taskId !== id);
    guardar('prefs');
    redibujar();
}

function fila(f) {
    // Si está en el tablero, con el nombre al día.
    const hallada = m.buscarTarea(f.taskId);
    if (hallada) Object.assign(f, m.datosTarea(hallada.t, hallada.lista));
    return h('div', {
        class: 'fav-fila', draggable: 'true', title: 'Arrástrala al registro o usa la flecha',
        ondragstart: e => {
            e.dataTransfer.setData(TIPO_ARRASTRE, f.taskId);
            e.dataTransfer.effectAllowed = 'copy';
            document.body.classList.add('arrastrando');
        },
        ondragend: () => document.body.classList.remove('arrastrando'),
    },
        h('div', { class: 'fav-cuerpo' },
            h('div', { class: 'reg-proyecto' }, f.listName),
            h('div', { class: 'reg-tarea', title: f.ruta }, f.ruta || f.taskName)),
        h('button', { class: 'icono', title: 'Añadir al registro', onclick: () => añadirTarea(f.taskId) }, '→'),
        h('button', { class: 'icono', title: 'Quitar de favoritas', onclick: () => quitar(f.taskId) }, '×'),
    );
}

export function pintar() {
    const p = panel();
    p.hidden = !state.prefs.alaFavoritas;
    if (p.hidden) return;
    const favs = state.prefs.favoritas;
    p.replaceChildren(
        h('header', { class: 'reg-cab' }, h('span', { class: 'panel-titulo' }, 'Favoritas')),
        h('div', { class: 'fav-lista' },
            favs.length ? favs.map(fila) : h('p', { class: 'reg-vacio' }, 'Arrastra aquí una tarea del tablero para tenerla siempre a mano.')),
    );
}
