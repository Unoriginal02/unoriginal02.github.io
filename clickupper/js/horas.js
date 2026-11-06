// Vista Horas: la semana (como DWS) y el mes. Aquí solo se ajustan horas y se imputa:
// proyecto, tarea y descripción se editan en el Tablero.
import { h, fmtMin, toHHMM, toMin, toISO, hoyISO, addDays, lunesDe, fromISO, nombreDia, nombreMes, fechaCorta, colorDe, hexDeColor, pad, capital } from './util.js';
import { state } from './store.js';
import * as m from './model.js';
import { aviso, error, popover, cerrarPopover, preguntar } from './ui.js';
import { quitar } from './registro.js';

const ALTO_CUARTO = 22;       // px por tramo de 15 min
const px = min => (min / m.PASO) * ALTO_CUARTO;

let modo = 'semana';
let lunes = lunesDe(hoyISO());
let mes = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();
let redibujar = () => {};
let cargando = false;
let imputando = false;
let enGesto = false;          // arrastrando un bloque: no se repinta hasta soltar
let saltarClic = false;       // el clic que cierra un arrastre no abre el detalle
const pedidos = new Set();    // rangos ya pedidos: un fallo solo se reintenta con el botón

export function iniciar(alCambiar) { redibujar = alCambiar; }

async function traer(desde, hasta, forzar) {
    const falta = [];
    for (let d = desde; d <= hasta; d = addDays(d, 1)) if (!state.remotas[d]) falta.push(d);
    const clave = `${desde}|${hasta}`;
    if (!forzar && (!falta.length || pedidos.has(clave))) return;
    pedidos.add(clave);
    cargando = true;
    try { await m.cargarRemotas(desde, hasta); }
    catch (e) { error(e); }
    cargando = false;
    redibujar();
}

/** Imputa un día entero o solo una tarea de ese día. Si va a borrar algo que ningún bloque sustituye, lo confirma. */
async function imputarYAvisar(fecha, taskId, etiqueta) {
    if (imputando) return;
    imputando = true;
    aviso(`Imputando ${etiqueta}…`);
    redibujar();
    try {
        const plan = await m.planImputacion(fecha, taskId);
        if (plan.sinBloque.length) {
            const lista = plan.sinBloque.map(r => {
                const d = new Date(r.ini);
                return `${toHHMM(d.getHours() * 60 + d.getMinutes())} ${r.taskName} (${fmtMin(r.dur / 60000)})`;
            }).join(' · ');
            const si = await preguntar('Imputar y sustituir', `Estas imputaciones de ClickUp no tienen bloque aquí y se borrarán: ${lista}`, [
                { texto: 'Borrar e imputar', valor: 'si', clase: 'peligro' },
            ]);
            if (si !== 'si') { aviso('No se ha imputado nada.'); return; }
        }
        const { hechas, borradas, avisos } = await m.imputar(plan);
        if (avisos.length) aviso(`${hechas} imputadas. ${avisos.length} con problema: ${avisos[0]}`, 'mal');
        else if (!hechas && !borradas) aviso('Ya estaba todo imputado', 'bien');
        else aviso(`${hechas} ${hechas === 1 ? 'entrada imputada' : 'entradas imputadas'} en ClickUp${borradas ? `, ${borradas} ${borradas === 1 ? 'anterior borrada' : 'anteriores borradas'}` : ''}`, 'bien');
    } catch (e) { aviso(`No se ha imputado nada: ${e.message}`, 'mal'); }
    finally {
        imputando = false;
        redibujar();
    }
}

// ── Semana ───────────────────────────────────────────────────────────────
function diasDeLaSemana() {
    const dias = Array.from({ length: 7 }, (_, i) => addDays(lunes, i));
    // Sábado y domingo solo si tienen algo o son hoy.
    return dias.filter((d, i) => i < 5 || d === hoyISO() || m.delDia(d).length || (state.remotas[d] || []).length);
}

/** Bloques de un día: los del registro y lo que hay en ClickUp por otro lado. Reparte en carriles lo que se pisa. */
function bloquesDe(fecha) {
    const dia = m.delDia(fecha);
    const locales = dia.map(e => ({ e, ini: toMin(e.start), fin: m.finDe(e, dia) }));
    const remotas = m.remotasSueltas(fecha).map(r => {
        const d = new Date(r.ini), ini = d.getHours() * 60 + d.getMinutes();
        return { r, ini, fin: Math.min(ini + Math.max(r.dur / 60000, 5), 24 * 60) };
    });
    const todos = [...locales, ...remotas].sort((a, b) => a.ini - b.ini || (a.e ? -1 : 1));
    let grupo = [], finGrupo = -1;
    const cerrar = () => {
        const carriles = [];
        for (const b of grupo) {
            let c = carriles.findIndex(fin => fin <= b.ini);
            if (c < 0) { c = carriles.length; carriles.push(0); }
            carriles[c] = b.fin;
            b.carril = c;
        }
        grupo.forEach(b => { b.carriles = carriles.length; });
    };
    for (const b of todos) {
        if (b.ini >= finGrupo && grupo.length) { cerrar(); grupo = []; finGrupo = -1; }
        grupo.push(b);
        finGrupo = Math.max(finGrupo, b.fin);
    }
    if (grupo.length) cerrar();
    return todos;
}

function posicion(b, inicioVista) {
    const ancho = 100 / b.carriles;
    return `top:${px(b.ini - inicioVista)}px;height:${Math.max(px(b.fin - b.ini), 8)}px;left:${b.carril * ancho}%;width:${ancho}%;`;
}

/** Lo que hereda una copia de un bloque, sea del registro o imputado fuera. */
function datosDe({ e, r }) {
    return e
        ? { taskId: e.taskId, taskName: e.taskName, ruta: e.ruta, listId: e.listId, listName: e.listName, nota: e.nota, color: e.color }
        : { taskId: r.taskId, taskName: r.taskId ? r.taskName : '', ruta: r.taskId ? r.taskName : '', listId: r.listId, listName: r.listName, nota: r.nota };
}

async function duplicar(b, destino) {
    if (!destino) { aviso('Elige el día de la copia.', 'mal'); return; }
    cerrarPopover();
    const datos = datosDe(b);
    // Para no caer encima de lo imputado ese día, aunque esté en otra semana.
    if (!state.remotas[destino]) await m.cargarRemotas(destino, destino).catch(() => {});
    const copia = m.duplicarEntrada(datos, destino, b.ini, b.fin - b.ini);
    if (!copia) aviso(`Ese día no queda un hueco de ${fmtMin(b.fin - b.ini)}. No se ha duplicado.`, 'mal');
    else {
        lunes = lunesDe(destino);
        aviso(`Copia en ${fechaCorta(destino)}, ${copia.start} – ${copia.end}. Sin imputar.`, 'bien');
    }
    redibujar();
}

function zonaDuplicar(b, fecha) {
    const dia = h('input', {
        class: 'campo', type: 'date', value: addDays(fecha, 1), title: 'Día de la copia',
        onkeydown: e => { if (e.key === 'Enter') duplicar(b, dia.value); },
    });
    return h('div', { class: 'info-dup' },
        h('label', {}, 'Duplicar en otro día, o Shift + arrastrar en esta semana'),
        h('div', { class: 'info-dup-fila' }, dia, h('button', { class: 'btn', onclick: () => duplicar(b, dia.value) }, 'Duplicar')));
}

function botonEliminar(accion) {
    return h('button', { class: 'btn peligro info-eliminar', onclick: () => { cerrarPopover(); accion(); } }, 'Eliminar');
}

function info(ancla, b, fecha) {
    const { e, r } = b;
    if (r) {
        popover(ancla, h('div', { class: 'info' },
            h('div', { class: 'info-proy' }, r.listName || 'ClickUp'),
            h('div', { class: 'info-tarea' }, r.taskName),
            r.nota && h('div', { class: 'info-nota' }, r.nota),
            h('div', { class: 'info-hora' }, `${toHHMM(b.ini)} – ${toHHMM(Math.round(b.fin))} · ${fmtMin(r.dur / 60000)}`),
            h('div', { class: 'info-pie' }, 'Imputado en ClickUp fuera de este registro.'),
            zonaDuplicar(b, fecha),
        ));
        return;
    }
    const dia = m.delDia(fecha);
    const deLaTarea = dia.filter(o => o.taskId && o.taskId === e.taskId);
    const pend = m.pendientes(deLaTarea);
    const total = deLaTarea.reduce((s, o) => s + m.duracion(o, dia), 0);
    const cambiada = m.estaCambiada(e);
    popover(ancla, h('div', { class: 'info' },
        h('div', { class: 'info-proy' }, e.listName || 'Sin proyecto'),
        h('div', { class: 'info-tarea' }, e.ruta || e.taskName || 'Sin tarea'),
        e.nota && h('div', { class: 'info-nota' }, e.nota),
        h('div', { class: 'info-hora' }, `${toHHMM(b.ini)} – ${toHHMM(b.fin)} · ${fmtMin(b.fin - b.ini)}`),
        h('div', { class: `info-estado ${cambiada ? 'cambiada' : e.cuId ? 'bien' : ''}` },
            cambiada ? 'Cambiada después de imputar' : e.cuId ? 'Imputada en ClickUp' : 'Sin imputar'),
        e.cuId && h('button', {
            class: 'btn info-quitar', title: 'Solo cambia la marca en la app. Para cuando se ha borrado directamente en ClickUp.',
            onclick: () => { cerrarPopover(); m.quitarImputado(e); aviso('Ya no consta como imputada. ClickUp no ha cambiado.'); redibujar(); },
        }, 'Quitar imputado'),
        e.taskId
            ? h('button', {
                class: 'btn primario', disabled: !pend.length,
                onclick: () => { cerrarPopover(); imputarYAvisar(fecha, e.taskId, e.taskName); },
            }, pend.length ? `Imputar esta tarea · ${deLaTarea.length} ${deLaTarea.length === 1 ? 'bloque' : 'bloques'} · ${fmtMin(total)}` : 'Tarea imputada')
            : h('div', { class: 'info-pie' }, 'Sin tarea no se puede imputar. Elígela en el Tablero.'),
        zonaDuplicar(b, fecha),
        botonEliminar(() => quitar(e)),
    ));
}

/** Un gesto de ratón sobre un bloque. Mientras dura no se repinta nada y Esc lo cancela. */
function gesto(ev, el, { empezar, mover, soltar, clic }) {
    ev.preventDefault();
    const x0 = ev.clientX, y0 = ev.clientY;
    let movido = false;
    el.setPointerCapture(ev.pointerId);
    const acabar = () => {
        document.removeEventListener('pointermove', alMover);
        document.removeEventListener('pointerup', alSoltar);
        document.removeEventListener('pointercancel', cancelar);
        document.removeEventListener('keydown', alTecla, true);
        enGesto = false;
        saltarClic = true;
    };
    const alMover = e => {
        if (!movido) {
            if ((e.clientX - x0) ** 2 + (e.clientY - y0) ** 2 < 25) return;
            movido = true;
            enGesto = true;
            empezar();
        }
        mover(e);
    };
    const alSoltar = () => {
        acabar();
        if (!movido) { clic(); return; }
        soltar();
        redibujar();
    };
    const cancelar = () => { acabar(); redibujar(); };
    const alTecla = e => { if (e.key === 'Escape') { e.stopPropagation(); cancelar(); } };
    document.addEventListener('pointermove', alMover);
    document.addEventListener('pointerup', alSoltar);
    document.addEventListener('pointercancel', cancelar);
    document.addEventListener('keydown', alTecla, true);
}

/** Mover o, con Shift, copiar (como DWS). El bloque cae donde lo pone el puntero y lo que no cabe en el
 *  hueco se corta, por arriba, por abajo o por ambos lados. Sobre otro bloque no se puede soltar. */
function moverBloque(ev, el, b, fecha, inicioVista, copia) {
    const dur = Math.max(Math.round((b.fin - b.ini) / m.PASO) * m.PASO, m.PASO);
    const agarre = Math.max(0, Math.min(Math.floor((ev.clientY - el.getBoundingClientRect().top) / ALTO_CUARTO) * m.PASO, dur - m.PASO));
    const ignorar = copia ? null : b.e || b.r;
    let sombra = null, destino = null, ini = 0, fin = 0, ultimo = null;

    const colocar = e => {
        const col = [...document.querySelectorAll('.sem-dia-cuerpo')].find(c => {
            const r = c.getBoundingClientRect();
            return e.clientX >= r.left && e.clientX < r.right;
        });
        const celda = col ? Math.max(0, Math.min(inicioVista + Math.floor((e.clientY - col.getBoundingClientRect().top) / ALTO_CUARTO) * m.PASO, 24 * 60 - m.PASO)) : 0;
        const hueco = col && m.huecoEn(col.dataset.fecha, celda, ignorar);
        if (!hueco) { destino = null; sombra.style.opacity = '0'; return; }
        const deseado = celda - agarre;
        ini = Math.max(hueco.start, deseado);
        fin = Math.min(hueco.end, deseado + dur);
        destino = col.dataset.fecha;
        if (sombra.parentNode !== col) col.append(sombra);
        sombra.style.opacity = '';
        sombra.style.top = `${px(ini - inicioVista)}px`;
        sombra.style.height = `${px(fin - ini)}px`;
        sombra.classList.toggle('recortada', fin - ini < dur);
        sombra.classList.toggle('corto', fin - ini <= m.PASO);
        sombra.querySelector('.bq-hora').textContent = `${toHHMM(ini)} – ${toHHMM(fin)}`;
    };

    // Sigue desplazando la semana mientras el puntero está quieto junto a un borde.
    const desplazar = () => {
        if (!enGesto) return;
        const zona = document.querySelector('.sem-scroll'), r = zona.getBoundingClientRect();
        const arriba = r.top + document.querySelector('.sem-cabs').offsetHeight + 40;
        if (ultimo) {
            const antes = zona.scrollTop;
            if (ultimo.clientY < arriba) zona.scrollTop -= 14;
            else if (ultimo.clientY > r.bottom - 40) zona.scrollTop += 14;
            if (zona.scrollTop !== antes) colocar(ultimo);
        }
        requestAnimationFrame(desplazar);
    };

    gesto(ev, el, {
        empezar: () => {
            sombra = el.cloneNode(true);
            sombra.classList.replace('remoto', 'local');
            sombra.classList.add('sombra', 'moviendo');
            sombra.removeAttribute('data-entrada');
            if (!sombra.querySelector('.bq-hora')) sombra.append(h('span', { class: 'bq-hora' }));
            sombra.style.left = '0';
            sombra.style.width = '100%';
            el.classList.add('origen');
            requestAnimationFrame(desplazar);
        },
        mover: e => { ultimo = e; colocar(e); },
        soltar: () => {
            if (!destino) { aviso(`Ahí no cabe. ${copia ? 'No se ha copiado.' : 'Se queda como estaba.'}`, 'mal'); return; }
            const corte = fin - ini < dur ? ' · recortada' : '';
            if (copia) {
                const datos = datosDe(b);
                m.copiarEntrada(datos, destino, ini, fin);
                aviso(`Copia de ${datos.taskName || 'la entrada'}: ${fechaCorta(destino)}, ${toHHMM(ini)} – ${toHHMM(fin)}${corte}. Sin imputar.`, 'bien');
            } else {
                const entrada = b.e || m.adoptarRemota(b.r);
                if (m.ajustarEntrada(entrada, destino, ini, fin)) {
                    aviso(`${entrada.taskName || 'Entrada'}: ${toHHMM(ini)} – ${toHHMM(fin)}${corte}${entrada.cuId ? ' · toca volver a imputar' : ''}`);
                } else aviso('Ahí no cabe. Se queda como estaba.', 'mal');
            }
        },
        clic: () => info(el, b, fecha),
    });
}

/** Cambiar la duración por el borde de arriba o el de abajo, en tramos de 15 min. Si pisaría otro bloque, vuelve atrás. */
function estirar(ev, el, b, fecha, inicioVista, lado) {
    const y0 = ev.clientY;
    let ini = b.ini, fin = b.fin;
    gesto(ev, el, {
        empezar: () => el.classList.add('moviendo'),
        mover: e => {
            const dy = Math.round((e.clientY - y0) / ALTO_CUARTO) * m.PASO;
            if (lado === 'arriba') ini = Math.max(0, Math.min(b.ini + dy, b.fin - m.PASO));
            else fin = Math.min(24 * 60, Math.max(b.fin + dy, b.ini + m.PASO));
            el.style.top = `${px(ini - inicioVista)}px`;
            el.style.height = `${px(fin - ini)}px`;
            const et = el.querySelector('.bq-hora');
            if (et) et.textContent = `${toHHMM(ini)} – ${toHHMM(fin)}`;
        },
        soltar: () => {
            if (!m.ajustarEntrada(b.e, fecha, ini, fin)) aviso('Ahí se pisaría con otro bloque. Se queda como estaba.', 'mal');
            else aviso(`${b.e.taskName || 'Entrada'}: ${toHHMM(ini)} – ${toHHMM(fin)}${b.e.cuId ? ' · toca volver a imputar' : ''}`);
        },
        clic: () => info(el, b, fecha),
    });
}

function bloque(b, fecha, inicioVista) {
    if (b.r) {
        const color = colorDe(b.r.listId || b.r.listName);
        return h('button', {
            class: `bq remoto ${b.fin - b.ini <= m.PASO ? 'corto' : ''}`, style: `${posicion(b, inicioVista)}--c:${color}`,
            onclick: ev => { if (!saltarClic) info(ev.currentTarget, b, fecha); saltarClic = false; },
            onpointerdown: ev => {
                saltarClic = false;
                // Sin tarea no se podría volver a imputar: solo se copia.
                if (ev.button === 0 && (ev.shiftKey || b.r.taskId)) moverBloque(ev, ev.currentTarget, b, fecha, inicioVista, ev.shiftKey);
            },
        }, h('span', { class: 'bq-proy' }, b.r.listName), h('span', { class: 'bq-tarea' }, b.r.taskName));
    }
    const { e } = b;
    const cambiada = m.estaCambiada(e);
    const clase = !e.taskId ? 'sin-tarea' : cambiada ? 'cambiada' : e.cuId ? 'imputada' : '';
    const el = h('div', {
        class: `bq local ${clase} ${b.fin - b.ini <= m.PASO ? 'corto' : ''}`, style: `${posicion(b, inicioVista)}--c:${hexDeColor(e.color)}`, 'data-entrada': e.id,
        title: `${e.listName ? `${e.listName} · ` : ''}${e.ruta || e.taskName}${e.nota ? `\n${e.nota}` : ''}`,
    },
        h('i', { class: 'tirador arriba' }),
        e.cuId && h('i', { class: 'bq-marca', title: cambiada ? 'Cambiada después de imputar' : 'Imputada' }, cambiada ? '◐' : '●'),
        h('span', { class: 'bq-proy' }, e.listName),
        h('span', { class: 'bq-tarea' }, e.taskName || e.nota || 'Sin tarea'),
        h('span', { class: 'bq-hora' }, `${toHHMM(b.ini)} – ${toHHMM(b.fin)}`),
        h('i', { class: 'tirador abajo' }),
    );
    el.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        const t = ev.target.classList;
        if (t.contains('arriba')) estirar(ev, el, b, fecha, inicioVista, 'arriba');
        else if (t.contains('abajo')) estirar(ev, el, b, fecha, inicioVista, 'abajo');
        else moverBloque(ev, el, b, fecha, inicioVista, ev.shiftKey);
    });
    return el;
}

function pintarSemana(raiz) {
    const dias = diasDeLaSemana();
    traer(lunes, addDays(lunes, 6));
    const bloques = new Map(dias.map(d => [d, bloquesDe(d)]));

    // Rango visible: 08–19 como base, y se abre si hay algo fuera.
    let inicio = 8 * 60, fin = 19 * 60;
    for (const lista of bloques.values()) for (const b of lista) { inicio = Math.min(inicio, b.ini); fin = Math.max(fin, b.fin); }
    inicio = Math.floor(inicio / 60) * 60;
    fin = Math.min(Math.ceil(fin / 60) * 60, 24 * 60);

    const horas = [];
    for (let t = inicio; t < fin; t += 60) horas.push(h('div', { class: 'sem-hora', style: `height:${px(60)}px` }, toHHMM(t)));

    const hoy = hoyISO();
    const ahora = new Date(), minAhora = ahora.getHours() * 60 + ahora.getMinutes();

    const cabeceras = dias.map(d => {
        const lista = m.delDia(d);
        const pend = m.pendientes(lista);
        const minutos = lista.reduce((s, e) => s + m.duracion(e, lista), 0)
            + m.remotasSueltas(d).reduce((s, r) => s + r.dur / 60000, 0);
        return h('div', { class: `sem-cab ${d === hoy ? 'hoy' : ''}`, 'data-fecha': d },
            h('div', { class: 'sem-cab-l1' },
                h('span', { class: 'sem-nombre' }, nombreDia(d)),
                h('span', { class: 'sem-num' }, fromISO(d).getDate()),
                h('span', { class: 'hueco' }),
                minutos > 0 && h('span', { class: 'sem-total' }, fmtMin(minutos))),
            h('button', {
                class: 'btn imputar-dia', disabled: !pend.length || imputando,
                title: 'Deja ClickUp como este día: imputa los bloques y borra las demás imputaciones tuyas de ese día',
                onclick: () => imputarYAvisar(d, null, fechaCorta(d)),
            }, pend.length ? `Imputar día · ${pend.length}` : lista.length ? 'Día imputado' : 'Imputar día'),
        );
    });

    const columnas = dias.map(d => h('div', {
        class: `sem-dia-cuerpo ${d === hoy ? 'hoy' : ''}`, 'data-fecha': d,
        style: `height:${px(fin - inicio)}px;background-size:100% ${px(60)}px, 100% ${ALTO_CUARTO}px`,
    },
        bloques.get(d).map(b => bloque(b, d, inicio)),
        d === hoy && minAhora >= inicio && minAhora < fin && h('div', { class: 'ahora', style: `top:${px(minAhora - inicio)}px` }),
    ));

    const plantilla = `64px repeat(${dias.length}, minmax(140px, 1fr))`;
    const antes = raiz.querySelector('.sem-scroll')?.scrollTop;
    raiz.replaceChildren(
        h('div', { class: 'sem-scroll' },
            h('div', { class: 'sem-cabs', style: `grid-template-columns:${plantilla}` }, h('div'), cabeceras),
            h('div', { class: 'sem-cuerpo', style: `grid-template-columns:${plantilla}` }, h('div', { class: 'sem-horas' }, horas), columnas),
        ));
    if (antes) raiz.querySelector('.sem-scroll').scrollTop = antes;
}

// ── Mes ──────────────────────────────────────────────────────────────────
function resumenDia(fecha) {
    const porProyecto = new Map();
    const suma = (id, nombre, min, imputado) => {
        const a = porProyecto.get(nombre) || { id, nombre, min: 0, pendiente: 0 };
        a.min += min;
        if (!imputado) a.pendiente += min;
        porProyecto.set(nombre, a);
    };
    const dia = m.delDia(fecha);
    dia.forEach(e => suma(e.listId, e.listName || 'Sin proyecto', m.duracion(e, dia), !!e.cuId && !m.estaCambiada(e)));
    m.remotasSueltas(fecha).forEach(r => suma(r.listId || r.listName, r.listName || 'ClickUp', r.dur / 60000, true));
    return [...porProyecto.values()].sort((a, b) => b.min - a.min);
}

function pintarMes(raiz) {
    const primero = `${mes.y}-${pad(mes.m + 1)}-01`;
    const inicio = lunesDe(primero);
    const ultimo = toISO(new Date(mes.y, mes.m + 1, 0));
    const finRejilla = addDays(lunesDe(ultimo), 6);
    traer(inicio, finRejilla);

    const celdas = [];
    let totalMes = 0;
    for (let d = inicio; d <= finRejilla; d = addDays(d, 1)) {
        const resumen = resumenDia(d);
        const total = resumen.reduce((s, x) => s + x.min, 0);
        const fuera = d < primero || d > ultimo;
        if (!fuera) totalMes += total;
        const destino = d;
        celdas.push(h('button', {
            class: `mes-dia ${fuera ? 'fuera' : ''} ${d === hoyISO() ? 'hoy' : ''}`, title: 'Ver esa semana',
            onclick: () => { lunes = lunesDe(destino); modo = 'semana'; redibujar(); },
        },
            h('div', { class: 'mes-cab' }, h('span', {}, fromISO(d).getDate()), total > 0 && h('b', {}, fmtMin(total))),
            resumen.slice(0, 4).map(x => h('div', { class: `mes-proy ${x.pendiente > 0 ? 'pendiente' : ''}`, style: `--c:${colorDe(x.id || x.nombre)}`, title: x.pendiente > 0 ? `${fmtMin(x.pendiente)} sin imputar` : 'Imputado' },
                h('span', {}, x.nombre), h('em', {}, fmtMin(x.min)))),
            resumen.length > 4 && h('div', { class: 'mes-mas' }, `Y ${resumen.length - 4} más`),
        ));
    }
    raiz.replaceChildren(h('div', { class: 'mes' },
        h('div', { class: 'mes-sem' }, ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(x => h('span', {}, x))),
        h('div', { class: 'mes-rejilla' }, celdas)));
    return totalMes;
}

// ── Barra de la vista ────────────────────────────────────────────────────
export function pintar() {
    if (enGesto) return;   // al soltar se repinta
    const raiz = document.getElementById('horas-cuerpo');
    const titulo = modo === 'semana'
        ? `${capital(fechaCorta(lunes))} – ${fechaCorta(addDays(lunes, 6))}`
        : capital(nombreMes(mes.y, mes.m));
    const paso = d => {
        if (modo === 'semana') lunes = addDays(lunes, d * 7);
        else { const x = new Date(mes.y, mes.m + d, 1); mes = { y: x.getFullYear(), m: x.getMonth() }; }
        redibujar();
    };
    const irHoy = () => {
        lunes = lunesDe(hoyISO());
        const x = new Date(); mes = { y: x.getFullYear(), m: x.getMonth() };
        redibujar();
    };
    const totalMes = modo === 'mes' ? pintarMes(raiz) : (pintarSemana(raiz), 0);
    document.getElementById('horas-barra').replaceChildren(...[
        h('div', { class: 'selector' },
            h('button', { class: modo === 'semana' ? 'on' : '', onclick: () => { modo = 'semana'; redibujar(); } }, 'Semana'),
            h('button', { class: modo === 'mes' ? 'on' : '', onclick: () => {
                modo = 'mes';
                const x = fromISO(lunes); mes = { y: x.getFullYear(), m: x.getMonth() };
                redibujar();
            } }, 'Mes')),
        h('button', { class: 'icono', title: 'Anterior', onclick: () => paso(-1) }, '‹'),
        h('span', { class: 'horas-titulo' }, titulo),
        h('button', { class: 'icono', title: 'Siguiente', onclick: () => paso(1) }, '›'),
        h('button', { class: 'btn', onclick: irHoy }, 'Hoy'),
        modo === 'mes' && totalMes > 0 && h('span', { class: 'horas-total' }, `Total ${fmtMin(totalMes)}`),
        h('span', { class: 'hueco' }),
        cargando && h('span', { class: 'dim' }, 'Leyendo ClickUp…'),
        h('button', { class: 'btn', title: 'Volver a leer lo imputado en ClickUp', onclick: () => {
            if (modo === 'semana') traer(lunes, addDays(lunes, 6), true);
            else traer(lunesDe(`${mes.y}-${pad(mes.m + 1)}-01`), addDays(lunesDe(toISO(new Date(mes.y, mes.m + 1, 0))), 6), true);
        } }, '⟳ ClickUp'),
    ].filter(Boolean));
}
