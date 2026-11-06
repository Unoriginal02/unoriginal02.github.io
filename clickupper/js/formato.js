// Texto con formato. Se escribe con las marcas de ClickUp (# ** _ ~~ ` - 1. > --- - [ ] ```), y cada destino lo pide distinto:
// la descripción admite markdown (markdown_content) y los comentarios solo texto enriquecido (una lista de trozos con atributos).
// Por dentro todo pasa por la misma lista de bloques, uno por línea, para pintarlo igual venga de donde venga.
import { h } from './util.js';

const MARCAS = /\\([\\`*_{}[\]()#+\-.!>~|])|`([^`\n]+)`|\*\*(.+?)\*\*|~~(.+?)~~|(?<![\w*\\])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])|(?<![\w\\])_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)|!?\[([^\]\n]*)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>)\]]+)/g;
const SEPARADOR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const VALLA = /^\s*```/;

function enLinea(txt, marcas = {}) {
    const spans = [];
    const suelto = text => { if (text) spans.push({ text, ...marcas }); };
    let ult = 0;
    for (const m of txt.matchAll(MARCAS)) {
        suelto(txt.slice(ult, m.index));
        ult = m.index + m[0].length;
        if (m[1] !== undefined) suelto(m[1]);
        else if (m[2] !== undefined) spans.push({ text: m[2], ...marcas, code: true });
        else if (m[3] !== undefined || m[5] !== undefined) spans.push(...enLinea(m[3] ?? m[5], { ...marcas, b: true }));
        else if (m[4] !== undefined) spans.push(...enLinea(m[4], { ...marcas, s: true }));
        else if (m[6] !== undefined) spans.push(...enLinea(m[6], { ...marcas, i: true }));
        else if (m[8] !== undefined) spans.push(...enLinea(m[7] || m[8], { ...marcas, href: m[8].replace(/\\(.)/g, '$1') }));
        else {
            // El punto o la coma que siguen a un enlace suelto no son del enlace.
            const url = m[9].replace(/[.,;:!?]+$/, '');
            spans.push({ text: url, ...marcas, href: url });
            ult -= m[9].length - url.length;
        }
    }
    suelto(txt.slice(ult));
    return spans;
}

/** Marcas → bloques: { tipo: 'p' | 'h' | 'li' | 'cita' | 'codigo' | 'hr', ... }. */
export function deMarkdown(md) {
    const bloques = [];
    let enCodigo = false, sangrias = [];
    for (const linea of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
        if (VALLA.test(linea)) { enCodigo = !enCodigo; sangrias = []; continue; }
        if (enCodigo) { bloques.push({ tipo: 'codigo', texto: linea }); continue; }
        if (SEPARADOR.test(linea)) { bloques.push({ tipo: 'hr' }); sangrias = []; continue; }
        const li = linea.match(/^(\s*)(?:[-*+]|(\d+)[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
        if (li) {
            // ClickUp sangra de 4 en 4 y a mano se suele ir de 2 en 2: cuenta el nivel, no los espacios.
            const n = li[1].length;
            while (sangrias.length && sangrias.at(-1) > n) sangrias.pop();
            if (sangrias.at(-1) !== n) sangrias.push(n);
            const lista = li[3] ? (li[3] === ' ' ? 'unchecked' : 'checked') : li[2] ? 'ordered' : 'bullet';
            bloques.push({ tipo: 'li', lista, sangria: sangrias.length - 1, spans: enLinea(li[4]) });
            continue;
        }
        sangrias = [];
        const tit = linea.match(/^(#{1,6})\s+(.*)$/);
        const cita = linea.match(/^\s*>\s?(.*)$/);
        if (tit) bloques.push({ tipo: 'h', nivel: tit[1].length, spans: enLinea(tit[2]) });
        else if (cita) bloques.push({ tipo: 'cita', spans: enLinea(cita[1]) });
        else bloques.push({ tipo: 'p', spans: enLinea(linea.trimEnd()) });
    }
    while (bloques.at(-1)?.tipo === 'p' && !bloques.at(-1).spans.length) bloques.pop();
    return bloques;
}

/** Marcas → lo que manda la descripción de ClickUp. Allí *x* sería cursiva y aquí es negrita, como en su editor;
 *  y un asterisco suelto (2*3*4) lo tomaría por cursiva, así que va escapado. */
export function aDescripcion(md) {
    let enCodigo = false;
    return String(md || '').replace(/\r\n?/g, '\n').split('\n').map(linea => {
        if (VALLA.test(linea)) { enCodigo = !enCodigo; return linea; }
        if (enCodigo || SEPARADOR.test(linea)) return linea;
        const inicio = linea.match(/^\s*(?:[-*+]|\d+[.)])\s+/)?.[0] || '';
        return inicio + linea.slice(inicio.length).split(/(`[^`\n]*`)/).map((t, i) => i % 2 ? t : t
            .replace(/(?<![\w*\\])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, '**$1**')
            .replace(/(?<![*\\])\*(?!\*)/g, '\\*')).join('');
    }).join('\n');
}

/** Lo que devuelve ClickUp → lo que se escribiría a mano: `*   x` es `- x`, `* * *` es `---`, sin escapar foo_bar. */
export function paraEditar(md) {
    let enCodigo = false;
    return String(md || '').split('\n').map(linea => {
        if (VALLA.test(linea)) { enCodigo = !enCodigo; return linea; }
        if (enCodigo) return linea;
        if (SEPARADOR.test(linea)) return '---';
        return linea
            .replace(/^(\s*)[*+]\s+/, (_, s) => `${' '.repeat(Math.floor(s.length / 2))}- `)
            .replace(/\[(https?:[^\]\n]*)\]\((https?:[^)\s]*)\)/g, (todo, txt, url) => txt.replace(/\\(.)/g, '$1') === url ? url : todo)
            .replace(/(?<=\w)\\_(?=\w)/g, '_');
    }).join('\n');
}

const ATTR_LINEA = {
    h: b => ({ header: b.nivel }),
    li: b => ({ list: { list: b.lista }, ...(b.sangria ? { indent: b.sangria } : {}) }),
    cita: () => ({ blockquote: {} }),
    codigo: () => ({ 'code-block': { 'code-block': 'plain' } }),
};

function atributos(s) {
    const a = {};
    if (s.b) a.bold = true;
    if (s.i) a.italic = true;
    if (s.s) a.strike = true;
    if (s.code) a.code = true;
    if (s.href) a.link = s.href;
    return a;
}

/** Marcas → el texto enriquecido que acepta POST /task/{id}/comment en `comment`. */
export function aComentario(md) {
    const ops = [];
    for (const b of deMarkdown(md)) {
        if (b.tipo === 'hr') { ops.push({ text: '---', type: 'divider', attributes: {} }, { text: '\n', attributes: {} }); continue; }
        if (b.tipo === 'codigo') { if (b.texto) ops.push({ text: b.texto, attributes: {} }); }
        else for (const s of b.spans) ops.push({ text: s.text, attributes: atributos(s) });
        ops.push({ text: '\n', attributes: ATTR_LINEA[b.tipo]?.(b) || {} });
    }
    return ops;
}

function bloqueDeLinea(spans, a) {
    if (a['code-block']) return { tipo: 'codigo', texto: spans.map(s => s.text).join('') };
    if (a.header) return { tipo: 'h', nivel: +a.header, spans };
    if (a.blockquote) return { tipo: 'cita', spans };
    const lista = a.list?.list ?? a.list;
    if (lista) return { tipo: 'li', lista, sangria: +a.indent || 0, spans };
    return { tipo: 'p', spans };
}

/** Lo que no es texto (mención, imagen, adjunto) se queda en algo legible. */
function trozoEspecial(op) {
    if (op.type === 'tag') return { text: `@${op.user?.username || op.text || ''}` };
    const archivo = op.image || op.attachment;
    if (archivo) return { text: archivo.title || archivo.name || op.text || 'archivo', href: archivo.url };
    return null;
}

/** Un comentario tal como lo devuelve ClickUp → bloques. El texto llano no se interpreta: allí también se ve llano. */
export function deComentario(c) {
    const ops = c.comment?.length ? c.comment : [{ text: c.comment_text || '' }];
    const bloques = [];
    let spans = [], trasSeparador = false;
    for (const op of ops) {
        const a = op.attributes || {};
        if (op.type === 'divider') { bloques.push({ tipo: 'hr' }); trasSeparador = true; continue; }
        if (trasSeparador && op.text === '\n') { trasSeparador = false; continue; }
        trasSeparador = false;
        const marcas = { b: a.bold, i: a.italic, s: a.strike, code: a.code, href: a.link };
        const especial = trozoEspecial(op);
        if (especial) { spans.push({ ...marcas, ...especial }); continue; }
        (op.text || '').split('\n').forEach((parte, i, partes) => {
            if (parte) spans.push({ text: parte, ...marcas });
            if (i < partes.length - 1) { bloques.push(bloqueDeLinea(spans, a)); spans = []; }
        });
    }
    if (spans.length) bloques.push(bloqueDeLinea(spans, {}));
    while (bloques.at(-1)?.tipo === 'p' && !bloques.at(-1).spans.length) bloques.pop();
    return bloques;
}

function pintarSpan(s) {
    let el = s.code ? h('code', {}, s.text) : document.createTextNode(s.text);
    if (s.b) el = h('strong', {}, el);
    if (s.i) el = h('em', {}, el);
    if (s.s) el = h('s', {}, el);
    // Solo enlaces de verdad: nunca un javascript: venido de una tarea.
    if (s.href && /^(https?:|mailto:)/i.test(s.href)) el = h('a', { href: s.href, target: '_blank', rel: 'noopener' }, el);
    return el;
}

/** Bloques → nodos. Todo va como texto: nada de innerHTML con datos de ClickUp. */
export function pintarBloques(bloques) {
    const out = [];
    const numeros = [];
    let pre = null;
    for (const b of bloques) {
        if (b.tipo !== 'codigo') pre = null;
        if (b.tipo !== 'li') numeros.length = 0;
        const hijos = (b.spans || []).map(pintarSpan);
        if (b.tipo === 'codigo') {
            if (!pre) out.push(pre = h('pre', {}));
            pre.append(`${pre.textContent ? '\n' : ''}${b.texto}`);
        } else if (b.tipo === 'hr') out.push(h('hr'));
        else if (b.tipo === 'h') out.push(h(`h${Math.min(b.nivel, 6)}`, {}, hijos));
        else if (b.tipo === 'cita') out.push(h('blockquote', {}, hijos));
        else if (b.tipo === 'li') {
            numeros.length = b.sangria + 1;
            numeros[b.sangria] = b.lista === 'ordered' ? (numeros[b.sangria] || 0) + 1 : 0;
            const marca = { bullet: '•', ordered: `${numeros[b.sangria]}.`, unchecked: '☐', checked: '☑' }[b.lista] || '•';
            out.push(h('div', { class: 'md-li', style: `--n:${b.sangria}` }, h('span', { class: 'md-marca' }, marca), h('span', {}, hijos)));
        } else out.push(h('p', { class: hijos.length ? '' : 'md-blanco' }, hijos));
    }
    return out;
}
