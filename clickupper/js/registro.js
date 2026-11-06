// Panel de registro: lo que he ido haciendo en el día. Se rellena arrastrando una tarea o con +.
import { h, fmtMin, toHHMM, hoyISO, addDays, fechaCorta, hexDeColor, GRIS } from './util.js';
import { state, guardar } from './store.js';
import * as m from './model.js';
import { aviso, error, selectorHora, popover, cerrarPopover, buscador, tareaPorId } from './ui.js';
import { TIPO_ARRASTRE, alRegistrar } from './board.js';

let fecha = hoyISO();
let redibujar = () => {};
const diasLeidos = new Set();

export function iniciar(alCambiar) {
    redibujar = alCambiar;
    alRegistrar(id => añadirTarea(id));
    const panel = document.getElementById('registro');
    panel.addEventListener('dragover', e => {
        if (!e.dataTransfer.types.includes(TIPO_ARRASTRE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        // Al entrar, se ve el hueco del final, que es donde cae.
        if (!panel.classList.contains('soltar')) { const l = panel.querySelector('.reg-lista'); if (l) l.scrollTop = l.scrollHeight; }
        panel.classList.add('soltar');
    });
    panel.addEventListener('dragleave', e => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('soltar'); });
    panel.addEventListener('drop', e => {
        panel.classList.remove('soltar');
        const id = e.dataTransfer.getData(TIPO_ARRASTRE);
        if (id) { e.preventDefault(); añadirTarea(id); }
    });
}

function añadirTarea(id) {
    const hallada = m.buscarTarea(id);
    if (!hallada) { aviso('Esa tarea ya no está en el tablero.', 'mal'); return; }
    try {
        const e = m.añadirEntrada(fecha, m.datosTarea(hallada.t, hallada.lista));
        aviso(`${e.start} · ${e.taskName}`, 'bien');
        redibujar();
        document.querySelector(`[data-entrada="${CSS.escape(e.id)}"]`)?.scrollIntoView({ block: 'center' });
        return;
    } catch (err) { error(err); }
    redibujar();
}

/** Tarea para una entrada desde el buscador: si no está en el tablero, se piden sus datos a ClickUp. */
async function datosDesdeBuscador(f) {
    const hallada = m.buscarTarea(f.id);
    if (hallada) return m.datosTarea(hallada.t, hallada.lista);
    const r = await tareaPorId(f.id);
    return { taskId: r.id, taskName: r.name, ruta: r.name, listId: r.list?.id || '', listName: r.list?.name || '' };
}

function elegirTarea(ancla, alElegir) {
    popover(ancla, buscador({
        proyectos: false, placeholder: 'Busca una tarea, ID o enlace',
        alElegir: async f => {
            cerrarPopover();
            try { alElegir(await datosDesdeBuscador(f)); } catch (err) { error(err); }
            redibujar();
        },
    }), 'pop-buscador');
}

/** Borrar es solo en la app: nunca toca ClickUp. */
export async function quitar(e) {
    try {
        await m.borrarEntrada(e);
        aviso(e.cuId ? 'Borrada de la app. Sigue imputada en ClickUp, por eso se ve atenuada en Horas.' : 'Entrada borrada');
    } catch (err) { error(err); }
    redibujar();
}

function fila(e, dia) {
    const color = e.taskId ? hexDeColor(e.color) : GRIS;
    const cambiada = m.estaCambiada(e);
    return h('div', { class: `reg-fila ${e.cuId ? 'imputada' : ''}`, style: `--c:${color}`, 'data-entrada': e.id },
        h('div', { class: 'reg-horas' },
            h('button', {
                class: 'reg-hora', title: 'Cambiar la hora de entrada',
                onclick: ev => selectorHora(ev.currentTarget, e.start, v => {
                    try { m.cambiarInicio(e, v); } catch (err) { error(err); }
                    redibujar();
                }),
            }, e.start),
            h('span', { class: 'reg-flecha' }, '↓'),
            h('button', {
                class: 'reg-salida', title: 'Cambiar la hora de salida',
                onclick: ev => selectorHora(ev.currentTarget, toHHMM(m.finDe(e, dia)), v => {
                    try { m.cambiarSalida(e, v); } catch (err) { error(err); }
                    redibujar();
                }),
            }, toHHMM(m.finDe(e, dia))),
        ),
        h('div', { class: 'reg-cuerpo' },
            e.taskId
                ? [h('div', { class: 'reg-proyecto' }, e.listName), h('div', { class: 'reg-tarea', title: e.ruta }, e.ruta || e.taskName)]
                : h('button', { class: 'accion aviso', onclick: ev => elegirTarea(ev.currentTarget, d => m.cambiarEntrada(e, d)) }, 'elegir tarea'),
            h('input', {
                class: 'reg-nota', value: e.nota, placeholder: 'Descripción', spellcheck: 'false',
                oninput: ev => { e.nota = ev.target.value; },
                onchange: ev => {
                    guardar('entradas');
                    const marca = ev.target.closest('.reg-fila').querySelector('.reg-marca');
                    if (marca) { const c = m.estaCambiada(e); marca.classList.toggle('cambiada', c); marca.textContent = c ? '◐' : '●'; }
                },
            }),
        ),
        h('div', { class: 'reg-lado' },
            h('span', { class: 'reg-dur' }, fmtMin(m.duracion(e, dia))),
            e.cuId && h('span', { class: `reg-marca ${cambiada ? 'cambiada' : ''}`, title: cambiada ? 'Cambiada después de imputar: toca volver a imputar' : 'Imputada en ClickUp' }, cambiada ? '◐' : '●'),
            h('button', { class: 'icono', title: 'Borrar', onclick: () => quitar(e) }, '×'),
        ),
    );
}

export function pintar() {
    if (document.activeElement?.classList.contains('reg-nota')) return;
    // Lo imputado fuera también cuenta como ocupado al cambiar horas aquí.
    if (state.user && !state.remotas[fecha] && !diasLeidos.has(fecha)) {
        diasLeidos.add(fecha);
        m.cargarRemotas(fecha, fecha).catch(() => {});
    }
    const dia = m.delDia(fecha);
    const total = dia.reduce((s, e) => s + m.duracion(e, dia), 0);
    const panel = document.getElementById('registro');
    const antes = panel.querySelector('.reg-lista')?.scrollTop || 0;
    panel.replaceChildren(
        h('header', { class: 'reg-cab' },
            h('span', { class: 'panel-titulo' }, 'Registro'),
            h('button', { class: 'icono', title: 'Día anterior', onclick: () => { fecha = addDays(fecha, -1); redibujar(); } }, '‹'),
            h('button', { class: 'reg-fecha', title: 'Ir a hoy', onclick: () => { fecha = hoyISO(); redibujar(); } }, fecha === hoyISO() ? `hoy · ${fechaCorta(fecha)}` : fechaCorta(fecha)),
            h('button', { class: 'icono', title: 'Día siguiente', onclick: () => { fecha = addDays(fecha, 1); redibujar(); } }, '›'),
            h('span', { class: 'hueco' }),
            total > 0 && h('span', { class: 'reg-total' }, fmtMin(total)),
        ),
        h('div', { class: 'reg-lista' },
            dia.length ? dia.map(e => fila(e, dia)) : h('p', { class: 'reg-vacio' }, 'Arrastra aquí una tarea para apuntar que estás con ella.'),
            // Siempre queda sitio para una entrada más: el hueco donde soltar la siguiente tarea.
            h('div', { class: 'reg-hueco', 'aria-hidden': 'true' })),
        h('footer', { class: 'reg-pie' },
            h('button', { class: 'btn', onclick: ev => elegirTarea(ev.currentTarget, d => { try { m.añadirEntrada(fecha, d); } catch (err) { error(err); } }) }, '+ buscar tarea'),
            h('button', { class: 'btn', onclick: () => { try { m.añadirEntrada(fecha); } catch (err) { error(err); } redibujar(); } }, '+ sin tarea'),
        ),
    );
    panel.querySelector('.reg-lista').scrollTop = antes;
}

