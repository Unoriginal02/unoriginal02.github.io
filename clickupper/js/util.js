// Utilidades puras: fechas, horas, texto y creación de nodos.

/** Crea un nodo. Los textos van siempre como texto: nada de datos de ClickUp en innerHTML. */
export function h(tag, props = {}, ...hijos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
    }
    for (const hijo of hijos.flat(Infinity)) {
        if (hijo === null || hijo === undefined || hijo === false) continue;
        el.append(hijo.nodeType ? hijo : document.createTextNode(String(hijo)));
    }
    return el;
}

export const pad = n => String(n).padStart(2, '0');
export const toMin = hhmm => { const [a, b] = hhmm.split(':').map(Number); return a * 60 + b; };
export const toHHMM = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const hoyISO = () => toISO(new Date());
export function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
export function lunesDe(iso) { const d = fromISO(iso); return addDays(iso, d.getDay() === 0 ? -6 : 1 - d.getDay()); }
export function msDe(iso, hhmm) { const d = fromISO(iso); d.setHours(0, toMin(hhmm), 0, 0); return d.getTime(); }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const capital = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const nombreDia = iso => DIAS[fromISO(iso).getDay()];
export const nombreMes = (y, m) => `${MESES[m]} ${y}`;
export function fechaCorta(iso) { const d = fromISO(iso); return `${DIAS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; }

/** Hora actual redondeada a los 15 min más cercanos (D8 del Companion). 23:53 se queda en 23:45. */
export function horaRedondeada(ahora = new Date()) {
    return toHHMM(Math.min(Math.round((ahora.getHours() * 60 + ahora.getMinutes()) / 15) * 15, 23 * 60 + 45));
}

/** "2h", "1h30", "1h 30m", "90m", "1.5" (horas), "1,5", "1:30" → milisegundos. '' → null. undefined si no se entiende. */
export function parseEstimacion(txt) {
    const s = String(txt).trim().toLowerCase().replace(',', '.');
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d+):(\d{1,2})$/))) return (+m[1] * 60 + +m[2]) * 60000;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m?)?$/))) return Math.round((+m[1] * 60 + +(m[2] || 0)) * 60000);
    if ((m = s.match(/^(\d+)\s*m(?:in)?$/))) return +m[1] * 60000;
    if ((m = s.match(/^\d+(?:\.\d+)?$/))) return Math.round(+m[0] * 3600000);
    return undefined;
}

/** Minutos → "1h 30" / "45m". */
export function fmtMin(min) {
    const t = Math.round(min);
    const a = Math.floor(t / 60), b = t % 60;
    if (!a) return `${b}m`;
    return b ? `${a}h ${pad(b)}` : `${a}h`;
}

export const plano = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Parecido de `q` en `txt`: todas las palabras dentro, o letras en orden para tolerar erratas. 0 = no casa. */
export function parecido(q, txt) {
    const a = plano(q).trim(), b = plano(txt);
    if (!a) return 1;
    const palabras = a.split(/\s+/);
    if (palabras.every(p => b.includes(p))) return 3 - (b.startsWith(palabras[0]) ? 0 : 1) - b.length / 1000;
    let i = 0;
    for (const c of b) if (c === a[i]) i++;
    return i === a.length && a.length >= 3 ? 0.5 : 0;
}

/** Tras "v1.3" va "v1.4"; tras "Fase 2", "Fase 3"; tras "Banner", "Banner 2" (como el Companion). */
export function siguienteNombre(nombre) {
    const vers = [...nombre.matchAll(/([vV])(\d+(?:\.\d+)*)/g)];
    if (vers.length) {
        const m = vers.at(-1), partes = m[2].split('.');
        partes[partes.length - 1] = String(+partes.at(-1) + 1);
        return nombre.slice(0, m.index) + m[1] + partes.join('.') + nombre.slice(m.index + m[0].length);
    }
    const nums = [...nombre.matchAll(/\d+/g)];
    if (nums.length) {
        const n = nums.at(-1);
        return nombre.slice(0, n.index) + (+n[0] + 1) + nombre.slice(n.index + n[0].length);
    }
    return `${nombre} 2`;
}

/** ID de tarea en un texto pegado (ID suelto o URL de ClickUp); null si no lo parece. */
export function idDeTarea(txt) {
    const s = txt.trim();
    const m = s.match(/clickup\.com\/t\/(?:\d+\/)?([^/?#\s]+)/i);
    if (m) return m[1];
    return /^[a-z0-9_-]{6,}$/i.test(s) && /\d/.test(s) ? s : null;
}

/** Los colores de bloque de DWS, sin el gris, que no se asigna solo. */
export const COLORES = {
    red: '#f7768e', orange: '#ff9e64', yellow: '#e0af68', lime: '#cfe86b', green: '#9ece6a', teal: '#73daca',
    cyan: '#7dcfff', blue: '#7aa2f7', purple: '#9d7cd8', magenta: '#bb9af7', pink: '#ff9ec3',
};
export const GRIS = '#565f89';
export const hexDeColor = nombre => COLORES[nombre] || GRIS;

/** Color estable por proyecto, para lo que no es una entrada del registro: lo imputado fuera y el resumen del mes. */
export function colorDe(id) {
    const lista = Object.values(COLORES);
    let n = 0;
    for (const c of String(id || '')) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return lista[n % lista.length];
}
