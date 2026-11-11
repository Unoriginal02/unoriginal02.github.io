// Lo que se lee y se escribe de una tarea en su detalle: descripción, archivos y comentarios.
import { h, pad, fechaCorta, toISO, capital } from './util.js';
import * as api from './api.js';
import { aviso, preguntar } from './ui.js';
import { aComentario, aDescripcion, deComentario, deMarkdown, paraEditar, pintarBloques } from './formato.js';

// ── Editor: un cuadro de texto con las marcas de ClickUp y botones que las ponen ──
function reemplazar(ta, ini, fin, texto, selIni, selFin) {
    ta.focus();
    ta.setSelectionRange(ini, fin);
    // Así Ctrl+Z sigue funcionando; si el navegador no lo admite, se escribe igual.
    if (!document.execCommand('insertText', false, texto)) ta.setRangeText(texto, ini, fin, 'end');
    ta.setSelectionRange(selIni, selFin);
}

function envolver(ta, marca) {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    reemplazar(ta, a, b, `${marca}${value.slice(a, b)}${marca}`, a + marca.length, b + marca.length);
}

/** Pone un prefijo a cada línea tocada por la selección. `prefijo` recibe el número de línea. */
function prefijar(ta, prefijo) {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const ini = value.lastIndexOf('\n', a - 1) + 1;
    const finLinea = value.indexOf('\n', b);
    const fin = finLinea < 0 ? value.length : finLinea;
    const texto = value.slice(ini, fin).split('\n').map((l, i) => prefijo(i) + l).join('\n');
    reemplazar(ta, ini, fin, texto, ini + texto.length, ini + texto.length);
}

function insertarBloque(ta, antes, despues = '') {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const sel = value.slice(a, b);
    const pre = `${a > 0 && value[a - 1] !== '\n' ? '\n' : ''}${antes}`;
    reemplazar(ta, a, b, `${pre}${sel}${despues}`, a + pre.length, a + pre.length + sel.length);
}

const BOTONES = [
    ['H1', 'Título 1: # texto', ta => prefijar(ta, () => '# ')],
    ['H2', 'Título 2: ## texto', ta => prefijar(ta, () => '## ')],
    ['H3', 'Título 3: ### texto', ta => prefijar(ta, () => '### ')],
    null,
    ['B', 'Negrita: **texto**', ta => envolver(ta, '**')],
    ['I', 'Cursiva: _texto_', ta => envolver(ta, '_')],
    ['S', 'Tachado: ~~texto~~', ta => envolver(ta, '~~')],
    ['`', 'Código en línea: `texto`', ta => envolver(ta, '`')],
    ['```', 'Bloque de código', ta => insertarBloque(ta, '```\n', '\n```\n')],
    null,
    ['•', 'Lista: - texto', ta => prefijar(ta, () => '- ')],
    ['1.', 'Lista numerada: 1. texto', ta => prefijar(ta, i => `${i + 1}. `)],
    ['☐', 'Casilla: - [ ] texto', ta => prefijar(ta, () => '- [ ] ')],
    ['>', 'Cita: > texto', ta => prefijar(ta, () => '> ')],
    ['—', 'Separador: ---', ta => insertarBloque(ta, '---\n')],
];

function editor({ valor = '', filas, placeholder, botones }) {
    const ta = h('textarea', { class: 'campo md-editor', rows: filas, placeholder });
    ta.value = valor;
    const barra = h('div', { class: 'md-barra' }, BOTONES.map(b => b
        ? h('button', {
            type: 'button', title: b[1], 'aria-label': b[1],
            // El foco se queda en el cuadro, y con él la selección.
            onpointerdown: e => e.preventDefault(),
            onclick: () => b[2](ta),
        }, b[0])
        : h('span', { class: 'md-sep' })));
    return { el: h('div', { class: 'md-edicion' }, barra, ta, h('div', { class: 'dlg-pie' }, botones)), ta };
}

// ── Piezas comunes ────────────────────────────────────────────────────────
const cabecera = (titulo, ...resto) => h('div', { class: 'det-sec-cab' }, h('span', { class: 'det-sec-titulo' }, titulo), h('span', { class: 'hueco' }), resto);

function fechaHora(ms) {
    const d = new Date(+ms);
    return `${fechaCorta(toISO(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tamaño(b) {
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// ── Paneles ───────────────────────────────────────────────────────────────
/** Devuelve { el, puedeCerrar }. Son nodos estables: repintar el resto del detalle no pierde lo que se está escribiendo. */
export function panelesTarea(id, { alLeer } = {}) {
    const cuerpoDesc = h('div', { class: 'desc md vacia' }, 'Cargando la descripción…');
    const accionDesc = h('span');
    const cabDesc = cabecera('Descripción', accionDesc);
    const seccionDesc = h('section', { class: 'det-sec' }, cabDesc, cuerpoDesc);
    const listaAdj = h('div', { class: 'adj-lista' });
    const notaAdj = h('div', { class: 'det-nota' });
    const listaCom = h('div', { class: 'com-lista dim' }, 'Cargando los comentarios…');
    const notaCom = h('div', { class: 'det-nota mal' });

    let editando = null, descripcion = '';

    // Descripción. Guardar sin cambios no escribe: lo que el markdown no recoge sigue intacto en ClickUp.
    function verDescripcion() {
        editando = null;
        const bloques = deMarkdown(descripcion);
        cuerpoDesc.replaceChildren(...(bloques.length ? pintarBloques(bloques) : ['Esta tarea no tiene descripción.']));
        cuerpoDesc.classList.toggle('vacia', !bloques.length);
        seccionDesc.replaceChildren(cabDesc, cuerpoDesc);
        accionDesc.replaceChildren(h('button', { class: 'btn', onclick: editarDescripcion }, 'Editar'));
    }

    function editarDescripcion() {
        const inicial = paraEditar(descripcion);
        const guardar = h('button', {
            class: 'btn primario',
            onclick: async () => {
                const texto = e.ta.value;
                if (texto === inicial) { verDescripcion(); return; }
                guardar.disabled = true;
                nota.textContent = '';
                try {
                    await api.cambiarTarea(id, { markdown_content: aDescripcion(texto) });
                    await cargarTarea();
                    aviso('Descripción guardada', 'bien');
                } catch (err) {
                    nota.textContent = err.message;
                    guardar.disabled = false;
                }
            },
        }, 'Guardar');
        const e = editor({
            valor: inicial, filas: 14, placeholder: 'Descripción',
            botones: [h('button', { class: 'btn', onclick: verDescripcion }, 'Cancelar'), guardar],
        });
        const nota = h('div', { class: 'det-nota mal' });
        editando = { sucio: () => e.ta.value !== inicial };
        accionDesc.replaceChildren();
        seccionDesc.replaceChildren(cabDesc, e.el, nota);
        e.ta.focus();
    }

    // Archivos
    function pintarAdjuntos(adjuntos) {
        const vivos = (adjuntos || []).filter(a => !a.deleted && !a.hidden);
        listaAdj.replaceChildren(...(vivos.length ? vivos.map(a => h('div', { class: 'adj' },
            h('a', { class: 'adj-nombre', href: a.url_w_query || a.url, target: '_blank', rel: 'noopener', title: 'Abrir el archivo' }, a.title),
            h('span', { class: 'dim' }, [tamaño(a.size), a.user?.username, a.date && fechaHora(a.date)].filter(Boolean).join(' · ')),
        )) : [h('span', { class: 'dim' }, 'Sin archivos.')]));
    }

    async function subirTanda(archivos, carpetas) {
        botonSubir.disabled = true;
        notaAdj.classList.remove('mal');
        try {
            for (const f of archivos) {
                notaAdj.textContent = `Subiendo ${f.name}…`;
                await api.subirAdjunto(id, f);
            }
            notaAdj.textContent = '';
            const hecho = archivos.length === 1 ? `Subido: ${archivos[0].name}` : `${archivos.length} archivos subidos`;
            aviso(carpetas ? `${hecho}. Las carpetas no se suben.` : hecho, 'bien');
        } catch (err) {
            notaAdj.textContent = err.message;
            notaAdj.classList.add('mal');
        }
        botonSubir.disabled = false;
        cargarTarea({ soloAdjuntos: true }).catch(() => {});
    }
    // Lo que se suelta mientras otra tanda sube espera su turno.
    let cola = Promise.resolve();
    const subir = (archivos, carpetas = 0) => { cola = cola.then(() => subirTanda(archivos, carpetas)); };

    const selector = h('input', {
        type: 'file', multiple: true, hidden: true,
        onchange: () => {
            const archivos = [...selector.files];
            selector.value = '';
            subir(archivos);
        },
    });
    const botonSubir = h('button', { class: 'btn', onclick: () => selector.click() }, '+ Subir archivo');

    // Comentarios: el más antiguo arriba y el último junto al cuadro para escribir.
    async function cargarComentarios() {
        try {
            const cs = await api.comentarios(id);
            listaCom.classList.remove('dim');
            listaCom.replaceChildren(...(cs.length ? [...cs].reverse().map(c => h('article', { class: 'com' },
                h('div', { class: 'com-cab' }, h('b', {}, c.user?.username || '—'), h('span', { class: 'dim' }, capital(fechaHora(c.date)))),
                h('div', { class: 'md' }, pintarBloques(deComentario(c))),
                +c.reply_count > 0 && h('div', { class: 'det-nota' }, `${c.reply_count} ${+c.reply_count === 1 ? 'respuesta' : 'respuestas'} en ClickUp`),
            )) : [h('span', { class: 'dim' }, 'Sin comentarios.')]));
        } catch (err) { listaCom.textContent = err.message; }
    }

    const enviar = h('button', {
        class: 'btn primario',
        onclick: async () => {
            const texto = nuevo.ta.value;
            if (!texto.trim()) return;
            enviar.disabled = true;
            notaCom.textContent = '';
            try {
                await api.comentar(id, aComentario(texto));
                nuevo.ta.value = '';
                await cargarComentarios();
                cargarTarea({ soloAdjuntos: true }).catch(() => {});   // para dar por visto el propio comentario
                aviso('Comentario añadido', 'bien');
            } catch (err) { notaCom.textContent = err.message; }
            enviar.disabled = false;
        },
    }, 'Comentar');
    const nuevo = editor({ filas: 4, placeholder: 'Escribe un comentario', botones: [enviar] });

    async function cargarTarea({ soloAdjuntos = false } = {}) {
        const r = await api.tarea(id);
        alLeer?.(r.date_updated);
        pintarAdjuntos(r.attachments);
        if (soloAdjuntos) return;
        descripcion = (r.markdown_description || r.description || r.text_content || '').trim();
        verDescripcion();
    }

    cargarTarea().catch(err => {
        cuerpoDesc.textContent = err.message;
        accionDesc.replaceChildren();
    });
    cargarComentarios();

    /** Soltar archivos en cualquier punto de la tarea abierta. Arrastrar texto sigue funcionando como siempre. */
    function aceptarArchivos(d) {
        const traeArchivos = e => e.dataTransfer?.types.includes('Files');
        const acoger = e => {
            if (!traeArchivos(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            d.classList.add('soltando');
        };
        d.append(h('div', { class: 'soltar-aviso' }, 'Suelta los archivos para subirlos a esta tarea'));
        d.addEventListener('dragenter', acoger);
        d.addEventListener('dragover', acoger);
        d.addEventListener('dragleave', e => { if (!d.contains(e.relatedTarget)) d.classList.remove('soltando'); });
        d.addEventListener('drop', e => {
            if (!traeArchivos(e)) return;
            e.preventDefault();
            d.classList.remove('soltando');
            const elementos = [...e.dataTransfer.items].filter(i => i.kind === 'file');
            const archivos = elementos.filter(i => !i.webkitGetAsEntry?.()?.isDirectory).map(i => i.getAsFile()).filter(Boolean);
            const carpetas = elementos.length - archivos.length;
            if (archivos.length) subir(archivos, carpetas);
            else aviso('Las carpetas no se suben. Suelta los archivos de dentro.', 'mal');
        });
    }

    return {
        aceptarArchivos,
        el: h('div', { class: 'det-paneles' },
            seccionDesc,
            h('section', { class: 'det-sec' }, cabecera('Archivos', botonSubir, selector), listaAdj, notaAdj),
            h('section', { class: 'det-sec' }, cabecera('Comentarios'), listaCom, nuevo.el, notaCom)),
        /** Lo escrito sin guardar no se pierde por cerrar sin querer. */
        puedeCerrar: async () => {
            if (!editando?.sucio() && !nuevo.ta.value.trim()) return true;
            return await preguntar('Sin guardar', 'Hay texto sin guardar en esta tarea.', [
                { texto: 'Descartar', valor: 'si', clase: 'peligro' },
            ]) === 'si';
        },
    };
}
