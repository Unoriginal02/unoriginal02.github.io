// Copia automática del registro en un archivo del ordenador (solo Chrome y Edge). El archivo se elige una vez
// y se reescribe solo tras cada cambio. Si el navegador borra sus datos, el archivo sigue ahí para recuperarlo.
import { state, guardar, trasGuardar, leerExtra, guardarExtra } from './store.js';
import { asegurarColores } from './model.js';
import { aviso, preguntar } from './ui.js';

const CLAVE = 'copiaArchivo';
export const disponible = 'showSaveFilePicker' in window;

let archivo = null;     // el archivo elegido
let activa = false;     // con permiso para escribir en él
let pendiente = null;
let alCambiar = () => {};

/** 'no-disponible' | 'sin-archivo' | 'en-pausa' | 'activa' */
export const estado = () => !disponible ? 'no-disponible' : !archivo ? 'sin-archivo' : activa ? 'activa' : 'en-pausa';
export const nombre = () => archivo?.name || '';

const contenido = () => JSON.stringify({ tipo: 'clickupper', fecha: new Date().toISOString(), entradas: state.entradas, prefs: state.prefs }, null, 2);

async function escribir() {
    clearTimeout(pendiente);
    pendiente = null;
    if (!archivo || !activa) return;
    try {
        const w = await archivo.createWritable();
        await w.write(contenido());
        await w.close();
    } catch (e) {
        activa = false;
        alCambiar();
        aviso(`La copia automática se ha parado: ${e.message}`, 'mal');
    }
}

export async function iniciar(cb) {
    alCambiar = cb;
    if (!disponible) return;
    archivo = (await leerExtra(CLAVE)) || null;
    if (archivo) activa = (await archivo.queryPermission({ mode: 'readwrite' })) === 'granted';
    trasGuardar(claves => {
        if (activa && (claves.includes('entradas') || claves.includes('prefs'))) {
            clearTimeout(pendiente);
            pendiente = setTimeout(escribir, 500);
        }
    });
    // Que no se quede nada sin copiar al cerrar la pestaña.
    document.addEventListener('visibilitychange', () => { if (document.hidden && pendiente) escribir(); });
}

/** Tras abrir el navegador, Chrome puede pedir permiso otra vez; necesita un clic. */
export async function reactivar() {
    if (!archivo) return;
    activa = (await archivo.requestPermission({ mode: 'readwrite' })) === 'granted';
    if (activa) await escribir();
    alCambiar();
}

/** Sustituye el registro por el de una copia. */
export async function recuperar(datos) {
    state.entradas = datos.entradas;
    state.prefs = { ...state.prefs, ...datos.prefs };
    asegurarColores();
    await guardar('entradas', 'prefs');
}

export const esCopia = d => d?.tipo === 'clickupper' && Array.isArray(d.entradas);

export async function elegir() {
    let elegido;
    try {
        elegido = await window.showSaveFilePicker({
            id: 'clickupper-copia', suggestedName: 'clickupper-copia.json',
            types: [{ description: 'Copia de ClickUpper', accept: { 'application/json': ['.json'] } }],
        });
    } catch (e) {
        if (e.name === 'AbortError') return;
        throw e;
    }
    // Si ya es una copia (p. ej. después de que el navegador borre sus datos), se ofrece recuperarla antes de escribir encima.
    let datos = null;
    try { datos = JSON.parse(await (await elegido.getFile()).text()); } catch { /* vacío o no es una copia */ }
    if (esCopia(datos) && datos.entradas.length) {
        const r = await preguntar('Ese archivo ya tiene una copia',
            `La copia tiene ${datos.entradas.length} entradas y tu registro aquí tiene ${state.entradas.length}.`, [
                { texto: 'Recuperar la copia', valor: 'recuperar', clase: 'primario' },
                { texto: 'Escribir encima', valor: 'encima', clase: 'peligro' },
            ]);
        if (!r) return;
        if (r === 'recuperar') await recuperar(datos);
    }
    archivo = elegido;
    activa = true;
    await guardarExtra(CLAVE, archivo);
    await escribir();
    alCambiar();
    if (activa) aviso(`Copia automática en ${archivo.name}`, 'bien');
}
