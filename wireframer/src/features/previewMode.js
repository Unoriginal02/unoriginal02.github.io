// src/features/previewMode.js
//
// Lógica del Preview Mode:
// - UI: dropdown de categorías + switch ON/OFF
// - Escaneo de SVG inline y reemplazo de <rect> con fill #e3e3e3 (≥ 32x32)
//   por un pattern <image> tipo "cover" aleatorio de /assets/<categoria>/...
// - Estado persistido en localStorage
// - Reaplica al añadir módulos nuevos (escucha evento 'svg:inlined')

import { PREVIEW_CATEGORIES, PREVIEW_IMAGES, PREVIEW_IMAGES_ALT, COLOR_TARGETS } from "../data/previewConfig.js";
import { el } from "../ui/domRefs.js";
import { PREVIEW_FILL_MODE } from "../data/previewConfig.js"
import { PREVIEW_TEXT_GREYS, PREVIEW_BRIGHTNESS_THRESHOLD, PREVIEW_SAMPLE_PADDING} from "../data/previewConfig.js";

const LS_KEY_ENABLED = "previewMode:enabled";
const LS_KEY_CATEGORY = "previewMode:category";

const MIN_W = 32;
const MIN_H = 32;

let enabled = false;
let currentCategory = PREVIEW_CATEGORIES[0]?.key || "automocion";


// ---- CONTRASTE SOBRE ELEMENTOS GRISES SOBRE LA IMAGEN DE FONDO ----

async function adjustGreysOnSvg(svg) {
  // Candidatos: cualquier shape con fill en la lista de grises, excepto los rect "previewed"
  const selector = PREVIEW_TEXT_GREYS
    .map(c => `[fill="${c}"]`)
    .join(",");

  if (!selector) return;

  const all = Array.from(svg.querySelectorAll(selector))
    .filter(el => !(el.tagName.toLowerCase() === "rect" && el.hasAttribute("data-previewed")));

  if (!all.length) return;

  // Resuelve rects con preview que intersecten con cada elemento
  const previewRects = Array.from(svg.querySelectorAll('rect[data-previewed="1"]'));

  // Procesamos secuencialmente para no saturar el main thread con muchos canvases
  for (const el of all) {
    try {
      const bbox = el.getBBox(); // en coords del SVG
      const bgRect = findIntersectingPreviewRect(previewRects, bbox);
      if (!bgRect) continue; // nada debajo, no tocamos

      const imgUrl = bgRect.getAttribute("data-preview-img");
      if (!imgUrl) continue;

      const rectX = parseFloat(bgRect.getAttribute("data-preview-x") || "0");
      const rectY = parseFloat(bgRect.getAttribute("data-preview-y") || "0");
      const rectW = parseFloat(bgRect.getAttribute("data-preview-w") || "0");
      const rectH = parseFloat(bgRect.getAttribute("data-preview-h") || "0");

      // Ampliamos un pelín el área de muestreo si se ha configurado
      const pad = PREVIEW_SAMPLE_PADDING || 0;
      const sample = {
        x: Math.max(rectX, bbox.x - pad),
        y: Math.max(rectY, bbox.y - pad),
        w: Math.min(rectX + rectW, bbox.x + bbox.width + pad) - Math.max(rectX, bbox.x - pad),
        h: Math.min(rectY + rectH, bbox.y + bbox.height + pad) - Math.max(rectY, bbox.y - pad),
      };
      if (sample.w <= 0 || sample.h <= 0) continue;

      const brightness = await sampleAverageBrightness(imgUrl, rectW, rectH, sample, { rectX, rectY });
      if (brightness < PREVIEW_BRIGHTNESS_THRESHOLD) {
        // Cambiamos a blanco si no lo estaba ya; guardamos fill original
        if (!el.hasAttribute("data-contrast-adjusted")) {
          const orig = el.getAttribute("fill");
          if (orig && !el.hasAttribute("data-original-fill")) {
            el.setAttribute("data-original-fill", orig);
          }
          el.setAttribute("fill", "#ffffff");
          el.setAttribute("data-contrast-adjusted", "1");
        }
      } else {
        // Suficiente brillo: si antes lo pusimos blanco, volvemos al original
        if (el.getAttribute("data-contrast-adjusted") === "1") {
          const orig = el.getAttribute("data-original-fill");
          if (orig) el.setAttribute("fill", orig);
          el.removeAttribute("data-contrast-adjusted");
        }
      }
    } catch (err) {
      console.warn("adjustGreysOnSvg error:", err);
    }
  }
}

function findIntersectingPreviewRect(rects, bbox) {
  for (const r of rects) {
    const rb = r.getBBox();
    const inter =
      rb.x < bbox.x + bbox.width &&
      rb.x + rb.width > bbox.x &&
      rb.y < bbox.y + bbox.height &&
      rb.y + rb.height > bbox.y;
    if (inter) return r;
  }
  return null;
}

/**
 * Calcula el brillo medio [0..1] del área `sample` proyectada sobre la imagen de fondo.
 * La imagen se dibuja a un canvas de tamaño rectW x rectH con "cover" (slice) centrado,
 * igual que en el pattern, y luego muestreamos el sub-rect correspondiente.
 */
function sampleAverageBrightness(imgUrl, rectW, rectH, sample, { rectX, rectY }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // por si en algún momento sirves con CORS
    img.onload = () => {
      try {
        // Escala estilo "cover"
        const scale = Math.max(rectW / img.width, rectH / img.height);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const offsetX = (rectW - drawW) / 2;
        const offsetY = (rectH - drawH) / 2;

        // Canvas del tamaño del rect de fondo
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(rectW));
        c.height = Math.max(1, Math.round(rectH));
        const ctx = c.getContext("2d");

        // Dibuja la imagen escalada+centrada para que cubra el rect
        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

        // Coordenadas del área a muestrear en el canvas (rect-space)
        const sx = Math.max(0, Math.round(sample.x - rectX));
        const sy = Math.max(0, Math.round(sample.y - rectY));
        const sw = Math.min(c.width - sx, Math.round(sample.w));
        const sh = Math.min(c.height - sy, Math.round(sample.h));
        if (sw <= 0 || sh <= 0) return resolve(1); // fallback alto brillo

        const data = ctx.getImageData(sx, sy, sw, sh).data;
        let sum = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          // luminancia relativa sRGB (perceptual)
          sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        resolve(sum / n);
      } catch (e) {
        // Si el canvas se "tainta" por CORS, devolvemos brillo alto para no tocar el fill
        resolve(1);
      }
    };
    img.onerror = reject;
    img.src = imgUrl;
  });
}

// ---------- UI ----------

export function injectPreviewControls() {
  // Crea contenedor (dropdown + switch) en la top-bar, junto al bloque de botones existente
  const btnGroup = document.querySelector(".top-bar .button-group");
  if (!btnGroup || document.getElementById("previewControls")) return;

  const wrap = document.createElement("div");
  wrap.id = "previewControls";
  wrap.className = "d-flex align-items-center ms-3 me-3";

  // Dropdown de categorías
  const select = document.createElement("select");
  select.id = "previewCategory";
  select.className = "form-select form-select-sm";
  select.style.width = "180px";
  select.style.marginRight = "10px";

  PREVIEW_CATEGORIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = c.label;
    select.appendChild(opt);
  });

  // Switch ON/OFF
  const label = document.createElement("label");
  label.className = "form-check-label me-2";
  label.textContent = "Preview";

  const swWrap = document.createElement("div");
  swWrap.className = "form-check form-switch m-0";

  const sw = document.createElement("input");
  sw.id = "previewToggle";
  sw.className = "form-check-input";
  sw.type = "checkbox";

  // swWrap.appendChild(sw);

  // wrap.appendChild(select);
  // wrap.appendChild(label);
  // wrap.appendChild(swWrap);

  btnGroup.prepend(wrap); // lo colocamos al principio del grupo de botones

  // Restaurar estado desde localStorage
  try {
    const savedCat = localStorage.getItem(LS_KEY_CATEGORY);
    const savedEn  = localStorage.getItem(LS_KEY_ENABLED);
    if (savedCat && PREVIEW_IMAGES[savedCat]) {
      currentCategory = savedCat;
    }
    select.value = currentCategory;

    enabled = savedEn === "1";
    sw.checked = enabled;
  } catch (_) {}

  // Handlers
  select.addEventListener("change", () => {
    currentCategory = select.value;
    persistState();
    if (enabled) {
      revertPreviewFromPage();
      applyPreviewToPage();
    }
  });

  sw.addEventListener("change", () => {
    enabled = sw.checked;
    persistState();
    if (enabled) applyPreviewToPage();
    else revertPreviewFromPage();
  });
}

function persistState() {
  try {
    localStorage.setItem(LS_KEY_CATEGORY, currentCategory);
    localStorage.setItem(LS_KEY_ENABLED, enabled ? "1" : "0");
  } catch (_) {}
}

// ---------- Núcleo: aplicar / revertir ----------

export function applyPreviewToPage() {
  // Recorre todos los SVG inline del canvas
  const svgs = el.canvas().querySelectorAll("svg");
  svgs.forEach((svg) => applyPreviewToSvg(svg));
  applyPreviewToFreeform(el.canvas());
}

export function revertPreviewFromPage() {
  const svgs = el.canvas().querySelectorAll("svg");
  svgs.forEach((svg) => revertPreviewFromSvg(svg));
  revertPreviewFromFreeform(el.canvas());
}

// Aplica preview a UN svg concreto
export function applyPreviewToSvg(svg) {
  if (!enabled) return;

  const rects = svg.querySelectorAll("rect");
  if (!rects.length) return;

  // Asegura que exista <defs> para meter patterns
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.prepend(defs);
  }

  // Normaliza hex de fill a minúsculas (#RRGGBB → #rrggbb)
  Array.from(svg.querySelectorAll("[fill]")).forEach(el => {
    const f = (el.getAttribute("fill") || "").trim();
    if (/^#[0-9A-F]{6}$/i.test(f)) el.setAttribute("fill", f.toLowerCase());
  });

  rects.forEach((rect, idx) => {
    const f = (rect.getAttribute("fill") || "").trim().toLowerCase();
    const w = parseFloat(rect.getAttribute("width")  || "0");
    const h = parseFloat(rect.getAttribute("height") || "0");
    const rx = parseFloat(rect.getAttribute("rx") || "0"); // por si hay esquinas redondeadas

    // ¿Es un candidato? (≥ 32x32, color #e3e3e3)
    const isTargetColor = Object.keys(COLOR_TARGETS).includes(f);
    if (!isTargetColor) return;
    if (w < MIN_W || h < MIN_H) return;

    // Guarda fill original si no lo tenía guardado
    if (!rect.hasAttribute("data-original-fill")) {
      rect.setAttribute("data-original-fill", f);
    }

    // Escoge imagen aleatoria según el color (puede usar lista "default" o "alt" en el futuro)
    const variant = COLOR_TARGETS[f]?.variant || "banners";
    const imgUrl = pickRandomImage(currentCategory, variant);
    if (!imgUrl) return;

    // Construye un pattern “cover” (como CSS background-size: cover)
    const x = parseFloat(rect.getAttribute("x") || "0");
    const y = parseFloat(rect.getAttribute("y") || "0");
    const patId = ensurePattern(defs, idx, imgUrl, w, h, x, y);

    // Aplica el pattern como fill
    rect.setAttribute("fill", `url(#${patId})`);

    // Marca que este rect está “previewed”
    rect.setAttribute("data-previewed", "1");

    // Guardamos info para el muestreo de brillo
    rect.setAttribute("data-preview-img", imgUrl);
    rect.setAttribute("data-preview-x", String(x));
    rect.setAttribute("data-preview-y", String(y));
    rect.setAttribute("data-preview-w", String(w));
    rect.setAttribute("data-preview-h", String(h));

    // Si hay borde, mantenlo; si hay rx, se respeta automáticamente
    if (rx) rect.setAttribute("rx", String(rx));
  });

  adjustGreysOnSvg(svg).catch(console.warn);
}

// Revierte preview en UN svg concreto
export function revertPreviewFromSvg(svg) {
  const rects = svg.querySelectorAll('rect[data-previewed="1"]');
  rects.forEach((rect) => {
    const orig = rect.getAttribute("data-original-fill");
    if (orig) rect.setAttribute("fill", orig);
    rect.removeAttribute("data-previewed");
  });

  // Restaurar elementos cuyo fill cambiamos a blanco
  const adjusted = svg.querySelectorAll('[data-contrast-adjusted="1"]');
  adjusted.forEach(el => {
    const orig = el.getAttribute("data-original-fill");
    if (orig) el.setAttribute("fill", orig);
    el.removeAttribute("data-contrast-adjusted");
    el.removeAttribute("data-original-fill");
  });
  

  // Limpia patterns generados por nosotros (opcional)
  const defs = svg.querySelector("defs");
  if (!defs) return;
  [...defs.querySelectorAll('pattern[data-preview-generated="1"]')].forEach((p) => p.remove());

  
}



// Crea (o reaprovecha) un pattern para una imagen. Devuelve el id.
function ensurePattern(defs, idx, imgUrl, rectW, rectH, rectX = 0, rectY = 0) {
  const patId = `prvw_${Date.now()}_${Math.floor(Math.random() * 1e6)}_${idx}`;

  const pat = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
  pat.setAttribute("id", patId);

  // ¡CLAVE! El patrón mide EXACTAMENTE lo que mide el rect:
  pat.setAttribute("patternUnits", "userSpaceOnUse");
  pat.setAttribute("patternContentUnits", "userSpaceOnUse");
  pat.setAttribute("x", String(rectX));
  pat.setAttribute("y", String(rectY));
  pat.setAttribute("width", String(rectW));
  pat.setAttribute("height", String(rectH));
  pat.setAttribute("data-preview-generated", "1");

  // La imagen ocupa TODO el patrón (igual tamaño que el rect)
  const img = document.createElementNS("http://www.w3.org/2000/svg", "image");
  // compat SVG2 + legacy
  img.setAttribute("href", imgUrl);
  img.setAttributeNS("http://www.w3.org/1999/xlink", "href", imgUrl);
  img.setAttribute("x", "0");
  img.setAttribute("y", "0");
  img.setAttribute("width", String(rectW));
  img.setAttribute("height", String(rectH));

  // Mantener proporción SIEMPRE, sin estirar; cubrir recortando si hace falta:
  img.setAttribute("preserveAspectRatio", "xMidYMid slice");

  pat.appendChild(img);
  defs.appendChild(pat);
  return patId;
}

// Elige aleatoriamente una imagen de la categoría actual (y variante)
function pickRandomImage(category, variant) {
  const byCat = PREVIEW_IMAGES[category] || {};
  const pool = byCat[variant] || byCat["banners"] || []; // fallback "banners"
  if (!Array.isArray(pool) || !pool.length) return null;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

// ---------- Integraciones ----------

export function initPreviewMode() {
  injectPreviewControls();

  // Si al cargar estaba activo, aplica
  if (enabled) applyPreviewToPage();

  // Escucha cuando un módulo SVG se ha inyectado inline
  // (lanzamos este evento desde replaceWithInlineSvg en modulesModal.js)
  document.addEventListener("svg:inlined", (e) => {
    if (!enabled) return;
    const svg = e.detail?.svg;
    if (svg) applyPreviewToSvg(svg);
  });

  // NUEVO: cuando se crea o actualiza un FreeForm
  document.addEventListener("freeform:created", (e) => {
    if (!enabled) return;
    const root = e.detail?.wrapper || document;
    applyPreviewToFreeform(root);
  });

  // Si cambia Desktop/Mobile, re-aplica para refrescar patterns (por si se reconstruyen)
  document.addEventListener("viewmode:changed", () => {
    if (enabled) applyPreviewToPage();
  });

}

// --- NUEVO: aplicar preview a columnas FreeForm (divs) ---
function applyPreviewToFreeform(root = document) {
  const cols = root.querySelectorAll(".freeform-column");
  cols.forEach((col) => {
    // Si ya está “previsualizado” y no estamos forzando un refresh, sáltalo
    if (col.getAttribute("data-previewed") === "1") return;

    const imgUrl = pickRandomImage(currentCategory, "default");
    if (!imgUrl) return;

    col.setAttribute("data-previewed", "1");
    col.setAttribute("data-preview-img", imgUrl);

    // Mismo comportamiento que los patterns: cubrir, centrado, no-repeat
    col.style.backgroundImage = `url("${imgUrl}")`;
    col.style.backgroundSize = (typeof PREVIEW_FILL_MODE !== "undefined" ? PREVIEW_FILL_MODE : "cover");
    col.style.backgroundPosition = "center";
    col.style.backgroundRepeat = "no-repeat";
  });
}

function revertPreviewFromFreeform(root = document) {
  const cols = root.querySelectorAll('.freeform-column[data-previewed="1"]');
  cols.forEach((col) => {
    col.style.backgroundImage = "";
    col.style.backgroundSize = "";
    col.style.backgroundPosition = "";
    col.style.backgroundRepeat = "";
    col.removeAttribute("data-previewed");
    col.removeAttribute("data-preview-img");
    // Volvemos al gris “wireframe”
    col.style.background = "#e3e3e3";
  });
}

