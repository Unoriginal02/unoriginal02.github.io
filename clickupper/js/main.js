// Arranque, pestañas, sincronización, conexión con ClickUp y copia de seguridad.
import { h, hoyISO } from './util.js';
import { state, cargar, guardar, guardarSesion } from './store.js';
import * as api from './api.js';
import * as m from './model.js';
import * as tablero from './board.js';
import * as registro from './registro.js';
import * as favoritas from './favoritas.js';
import * as horas from './horas.js';
import * as copia from './copia.js';
import * as buscar from './buscar.js';
import { aviso, error, dialogo, preguntar } from './ui.js';

const CLAVE_VISTA = 'clickupper_pestana';
let pestana = localStorage.getItem(CLAVE_VISTA) || 'tablero';
let sincronizando = false;

function pintar() {
    document.getElementById('vista-tablero').hidden = pestana !== 'tablero';
    document.getElementById('vista-horas').hidden = pestana !== 'horas';
    document.querySelectorAll('[data-pestana]').forEach(b => b.classList.toggle('on', b.dataset.pestana === pestana));
    document.getElementById('usuario').textContent = state.user?.nombre || 'Sin conectar';
    document.getElementById('copia').hidden = copia.estado() !== 'en-pausa';
    if (pestana === 'tablero') {
        tablero.pintar();
        favoritas.pintar();
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
        const vuelven = await m.sincronizar();
        aviso(`Tablero al día · ${new Date().toTimeString().slice(0, 5)}${vuelven.length ? ` · Vuelve${vuelven.length > 1 ? 'n' : ''} con cambios: ${vuelven.join(', ')}` : ''}`, 'bien');
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
            h('label', { class: 'dlg-etiqueta' }, 'Copia automática'),
            h('p', { class: 'dim' }, {
                'no-disponible': 'Solo funciona en Chrome o Edge.',
                'sin-archivo': 'Elige un archivo de tu ordenador y el registro se guardará ahí solo, cada vez que cambie.',
                'en-pausa': `En pausa: Chrome necesita permiso para seguir escribiendo en ${copia.nombre()}.`,
                'activa': `Activa: cada cambio se guarda en ${copia.nombre()}.`,
            }[copia.estado()]),
            copia.disponible && h('div', { class: 'dlg-pie' },
                copia.estado() === 'en-pausa' && h('button', { class: 'btn primario', onclick: () => { d.close(); copia.reactivar().catch(error); } }, 'Reactivar'),
                h('button', { class: 'btn', onclick: () => { d.close(); copia.elegir().then(pintar).catch(error); } },
                    copia.estado() === 'sin-archivo' ? 'Elegir archivo' : 'Cambiar archivo')),
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
            if (!copia.esCopia(datos)) throw new Error('Ese archivo no es una copia de ClickUpper.');
            const r = await preguntar('Recuperar copia', `Sustituye tu registro actual (${state.entradas.length} entradas) por el de la copia (${datos.entradas.length}).`, [
                { texto: 'Sustituir', valor: 'si', clase: 'peligro' },
            ]);
            if (r !== 'si') return;
            await copia.recuperar(datos);
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
    document.getElementById('sincronizar').addEventListener('click', sincronizar);
    document.getElementById('ajustes').addEventListener('click', () => conexion(false));
    document.getElementById('copia').addEventListener('click', () => copia.reactivar().catch(error));
}

async function arrancar() {
    await cargar(pintar);
    m.asegurarColores();
    await copia.iniciar(pintar).catch(() => {});
    tablero.iniciar(pintar);
    registro.iniciar(pintar);
    favoritas.iniciar(pintar);
    horas.iniciar(pintar);
    iniciarControles();
    buscar.iniciar();
    pintar();
    if (state.user && state.token) sincronizar();
    else conexion(true);
    // La línea de la hora actual, sin interrumpir un arrastre.
    setInterval(() => { if (pestana === 'horas' && document.querySelector('.ahora') && !document.querySelector('.moviendo')) pintar(); }, 60000);
}

arrancar().catch(e => aviso(`No se ha podido arrancar: ${e.message}`, 'mal'));
