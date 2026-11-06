// Arranque, pestañas, sincronización, conexión con ClickUp y copia de seguridad.
import { h, hoyISO } from './util.js';
import { state, cargar, guardar, guardarSesion } from './store.js';
import * as api from './api.js';
import * as m from './model.js';
import * as tablero from './board.js';
import * as registro from './registro.js';
import * as horas from './horas.js';
import { aviso, error, dialogo, preguntar } from './ui.js';

const CLAVE_VISTA = 'clickupper_pestana';
let pestana = localStorage.getItem(CLAVE_VISTA) || 'tablero';
let sincronizando = false;

function pintar() {
    document.getElementById('vista-tablero').hidden = pestana !== 'tablero';
    document.getElementById('vista-horas').hidden = pestana !== 'horas';
    document.querySelectorAll('[data-pestana]').forEach(b => b.classList.toggle('on', b.dataset.pestana === pestana));
    document.getElementById('usuario').textContent = state.user?.nombre || 'Sin conectar';
    if (pestana === 'tablero') {
        tablero.pintarControles();
        tablero.pintar();
        registro.pintar();
    } else {
        horas.pintar();
    }
}

async function sincronizar() {
    if (sincronizando || !state.user) return;
    sincronizando = true;
    const b = document.getElementById('sincronizar');
    b.disabled = true;
    aviso('Leyendo ClickUp…');
    try {
        await m.sincronizar();
        aviso(`Tablero al día · ${new Date().toTimeString().slice(0, 5)}`, 'bien');
        m.asegurarIndice().catch(() => {});   // para que el buscador esté listo cuando haga falta
    } catch (e) { error(e); }
    sincronizando = false;
    b.disabled = false;
    pintar();
}

function conexion(primeraVez = false) {
    const entrada = h('input', { class: 'campo', type: 'password', placeholder: 'pk_…', spellcheck: 'false', autocomplete: 'off', value: state.token });
    const nota = h('p', { class: 'dim' }, 'Tu token personal de ClickUp: Settings › Apps › API Token. Se guarda solo en este navegador.');
    const enviar = async () => {
        const token = entrada.value.trim();
        if (!token) return;
        nota.textContent = 'Comprobando…';
        try {
            const user = await api.conectar(token);
            guardarSesion(token, user);
            d.close();
            pintar();
            sincronizar();
        } catch (e) { nota.textContent = e.message; }
    };
    entrada.addEventListener('keydown', e => { if (e.key === 'Enter') enviar(); });
    const salir = () => {
        guardarSesion('', null);
        // El registro se queda; lo leído de ClickUp era de esa cuenta.
        state.tablero = {}; state.catalogo = null; state.indice = null; state.remotas = {};
        guardar('tablero', 'catalogo', 'indice');
        d.close();
        pintar();
    };
    const d = dialogo(primeraVez ? 'Conectar con ClickUp' : 'Ajustes', [
        h('label', { class: 'dlg-etiqueta' }, 'Token de ClickUp'), entrada, nota,
        h('div', { class: 'dlg-pie' }, h('button', { class: 'btn primario', onclick: enviar }, 'Conectar')),
        !primeraVez && [
            h('hr'),
            h('label', { class: 'dlg-etiqueta' }, 'Copia de seguridad del registro'),
            h('p', { class: 'dim' }, 'El registro vive en este navegador. Sin el token, que no se copia.'),
            h('div', { class: 'dlg-pie' },
                h('button', { class: 'btn', onclick: exportar }, 'Guardar copia'),
                h('button', { class: 'btn', onclick: importar }, 'Recuperar copia')),
            h('hr'),
            h('div', { class: 'dlg-pie' }, h('button', { class: 'btn peligro', onclick: salir }, 'Desconectar')),
        ],
    ], { alCerrar: () => { if (!state.user) conexion(true); } });
    setTimeout(() => entrada.focus());
}

function exportar() {
    const blob = new Blob([JSON.stringify({ tipo: 'clickupper', entradas: state.entradas, prefs: state.prefs }, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `clickupper-${hoyISO()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
}

function importar() {
    const inp = h('input', { type: 'file', accept: '.json' });
    inp.addEventListener('change', async () => {
        try {
            const datos = JSON.parse(await inp.files[0].text());
            if (datos.tipo !== 'clickupper' || !Array.isArray(datos.entradas)) throw new Error('Ese archivo no es una copia de ClickUpper.');
            const r = await preguntar('Recuperar copia', `Sustituye tu registro actual (${state.entradas.length} entradas) por el de la copia (${datos.entradas.length}).`, [
                { texto: 'Sustituir', valor: 'si', clase: 'peligro' },
            ]);
            if (r !== 'si') return;
            state.entradas = datos.entradas;
            state.prefs = { ...state.prefs, ...datos.prefs };
            m.asegurarColores();
            await guardar('entradas', 'prefs');
            aviso('Copia recuperada', 'bien');
            pintar();
        } catch (e) { error(e); }
    });
    inp.click();
}

function iniciarControles() {
    document.querySelectorAll('[data-pestana]').forEach(b => b.addEventListener('click', () => {
        pestana = b.dataset.pestana;
        localStorage.setItem(CLAVE_VISTA, pestana);
        pintar();
    }));
    document.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
        state.prefs.vista = b.dataset.vista;
        guardar('prefs');
        pintar();
    }));
    document.getElementById('sincronizar').addEventListener('click', sincronizar);
    document.getElementById('ajustes').addEventListener('click', () => conexion(false));
}

async function arrancar() {
    await cargar(pintar);
    m.asegurarColores();
    tablero.iniciar(pintar);
    registro.iniciar(pintar);
    horas.iniciar(pintar);
    iniciarControles();
    pintar();
    if (state.user && state.token) sincronizar();
    else conexion(true);
    // La línea de la hora actual, sin interrumpir un arrastre.
    setInterval(() => { if (pestana === 'horas' && document.querySelector('.ahora') && !document.querySelector('.moviendo')) pintar(); }, 60000);
}

arrancar().catch(e => aviso(`No se ha podido arrancar: ${e.message}`, 'mal'));
