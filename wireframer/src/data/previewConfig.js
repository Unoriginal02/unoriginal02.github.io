// src/data/previewConfig.js
//
// CONFIGURACIÓN DEL PREVIEW MODE
// - Define las categorías visibles en el dropdown.
// - Para cada categoría, lista las imágenes disponibles en /assets/<categoria>/…
// - Mapea colores objetivo (p. ej. #e3e3e3) a "subcarpetas" (por si en el futuro quieres #e4e4e4 → otra subcarpeta)
//
// NOTA: para un sitio estático, el navegador no puede listar carpetas. Por eso
//       necesitamos declarar aquí los nombres de archivo que ya tienes en /assets/…
//
// Ejemplo de estructura de carpetas que usarás:
// /assets/automocion/01.jpg, 02.jpg, 03.jpg
// /assets/moda/01.jpg, 02.jpg
// /assets/farmacia/01.jpg, 02.jpg
//
// Si en el futuro manejas #e4e4e4, podrías tener:
// /assets/automocion/alt/…  (para los #e4e4e4)

export const PREVIEW_CATEGORIES = [
  { key: "automocion", label: "Automoción" },
  { key: "moda",       label: "Moda" },
];

export const PREVIEW_FILL_MODE = "cover";

// Lista de imágenes por categoría
 export const PREVIEW_IMAGES = {
   automocion: {
     banners: [
       "./assets/automocion/banners/01.webp",
       "./assets/automocion/banners/02.webp",
       "./assets/automocion/banners/03.webp",
       "./assets/automocion/banners/04.webp",
       "./assets/automocion/banners/05.webp",
       "./assets/automocion/banners/06.webp",
       "./assets/automocion/banners/07.webp",
     ],
     products: [
       "./assets/automocion/products/01.webp",
       "./assets/automocion/products/02.webp",
       "./assets/automocion/products/03.webp",
       "./assets/automocion/products/04.jpg",
       "./assets/automocion/products/05.webp",
       "./assets/automocion/products/06.webp",
       "./assets/automocion/products/07.webp",
     ],
   },
   moda: {
     banners: [
       "./assets/moda/banners/01.webp",
       "./assets/moda/banners/02.webp",
       "./assets/moda/banners/03.webp",
       "./assets/moda/banners/04.webp",
       "./assets/moda/banners/05.webp",
       "./assets/moda/banners/06.webp",
       "./assets/moda/banners/07.webp",
       "./assets/moda/banners/08.webp",
       "./assets/moda/banners/09.webp",
       "./assets/moda/banners/10.webp",
     ],
     products: [
       "./assets/moda/products/01.webp",
       "./assets/moda/products/02.webp",
       "./assets/moda/products/03.webp",
       "./assets/moda/products/04.webp",
     ],
   },
 };

// Asignación de COLORES → SUBCARPETA (para crecer en el futuro)
// Por ahora, #e3e3e3 usa la raíz de la categoría (array PREVIEW_IMAGES[categoria]).
// Cuando añadas #e4e4e4, podrías apuntar a una variante "alt":
export const COLOR_TARGETS = {
  "#e3e3e3": { variant: "banners" },  // usa PREVIEW_IMAGES[categoria]
  "#e4e4e4": { variant: "products" },      // podrás definir PREVIEW_IMAGES_ALT[categoria]
};

// (Opcional futuro) listas alternativas para otros colores:
export const PREVIEW_IMAGES_ALT = {
  automocion: [
    // p.ej. "assets/automocion/alt/01.jpg"
  ],
  moda: [],
  farmacia: [],
};

// === CONTRASTE SOBRE TEXTO/FORMAS ===
// Lista de grises a vigilar (minúsculas). Puedes añadir o quitar.
export const PREVIEW_TEXT_GREYS = [
  "#8a8a8a", // ejemplo del caso que comentas
  "#1c1c1c",
  "#686868",
  "#000000",
  "black"
];

// Umbral de brillo [0..1]. Si el promedio bajo el elemento es < umbral → rellenamos en blanco.
export const PREVIEW_BRIGHTNESS_THRESHOLD = 0.65;

// Opcional: margen en px alrededor del bbox del elemento para muestrear un poco más de fondo
export const PREVIEW_SAMPLE_PADDING = 0;
