// Buscador de la barra: ilumina, mientras se escribe, cada nombre de proyecto que coincide en la vista abierta.
// Enter / ↓ salta a la siguiente coincidencia, Mayús+Enter / ↑ a la anterior, Esc lo borra.
import { h } from './util.js';

const NOMBRES = '.col-nombre, .reg-proyecto, .info-proy, .bq-proy';
const VISTAS = ['vista-tablero', 'vista-horas'];

let texto = '';
let actual = 0;
let encontrados = [];
let contador, campo;

const normal = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function aplicar(llevar = false) {
    document.querySelectorAll('.brilla').forEach(el => el.classList.remove('brilla', 'brilla-actual'));
    const q = normal(texto.trim());
    encontrados = [];
    if (q) {
        for (const id of VISTAS) {
            const v = document.getElementById(id);
            if (v.hidden) continue;
            encontrados.push(...[...v.querySelectorAll(NOMBRES)].filter(el => normal(el.textContent).includes(q)));
        }
    }
    if (actual >= encontrados.length) actual = 0;
    encontrados.forEach(el => el.classList.add('brilla'));
    const el = encontrados[actual];
    el?.classList.add('brilla-actual');
    if (llevar) el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    contador.textContent = q ? (encontrados.length ? `${actual + 1}/${encontrados.length}` : '0/0') : '';
    campo.classList.toggle('sin-nada', !!q && !encontrados.length);
}

function saltar(paso) {
    if (!encontrados.length) return;
    actual = (actual + paso + encontrados.length) % encontrados.length;
    aplicar(true);
}

export function iniciar() {
    campo = h('input', {
        id: 'buscar', class: 'campo', type: 'search', placeholder: 'Buscar proyecto…', spellcheck: 'false', autocomplete: 'off',
        oninput: () => { texto = campo.value; actual = 0; aplicar(true); },
        onkeydown: e => {
            if (e.key === 'Enter') { e.preventDefault(); saltar(e.shiftKey ? -1 : 1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); saltar(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); saltar(-1); }
            else if (e.key === 'Escape') { campo.value = texto = ''; aplicar(); campo.blur(); }
        },
    });
    contador = h('span', { class: 'buscar-cuenta' });
    const caja = h('div', { class: 'buscar' }, campo, contador,
        h('button', { class: 'icono', title: 'Anterior (Mayús+Enter)', onclick: () => saltar(-1) }, '↑'),
        h('button', { class: 'icono', title: 'Siguiente (Enter)', onclick: () => saltar(1) }, '↓'));
    document.querySelector('#barra .hueco').before(caja);

    // Ctrl+F lleva al buscador.
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !document.querySelector('dialog[open]')) {
            e.preventDefault(); campo.focus(); campo.select();
        }
    });

    // Cada vez que la vista se repinta, se vuelve a iluminar sin mover el scroll.
    let pendiente = false;
    const obs = new MutationObserver(() => {
        if (pendiente || !texto.trim()) return;
        pendiente = true;
        requestAnimationFrame(() => { pendiente = false; aplicar(); });
    });
    for (const id of VISTAS) obs.observe(document.getElementById(id), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}
