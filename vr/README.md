# Visor VR — modelos 3D con acabado clay

Visor de modelos 3D (`.glb .gltf .obj .stl .ply`) para revisarlos con unas **Meta Quest 2**
desde el navegador, sin instalar nada y sin configurar nada.

Los modelos viven en una **carpeta de Google Drive**. El visor la lista solo, así que para
añadir uno basta con soltarlo en Drive y pulsar **↻**.

---

## Conectar la carpeta de Drive

Se hace una vez y ya está. Son dos datos, los dos van en [`js/config.js`](js/config.js).

**1 · La carpeta.** En Drive, botón derecho sobre ella → **Compartir** → *Acceso general* →
**Cualquier persona con el enlace** (lector). Copia el final de su URL:

```
https://drive.google.com/drive/folders/1AbCdEf...   ← eso es el folderId
```

**2 · La clave.** En [console.cloud.google.com](https://console.cloud.google.com):
proyecto nuevo → **APIs y servicios → Habilitar APIs** → *Google Drive API* → **Habilitar**
→ **Credenciales → Crear credenciales → Clave de API**. Después edítala y restríngela:
*Restricción de la aplicación* → **Sitios web** → `https://<usuario>.github.io/*`, y
*Restricción de la API* → solo **Google Drive API**.

```js
export const DRIVE = {
  folderId: '1AbCdEf...',
  apiKey:   'AIza...',
};
```

> La clave viaja en el código de la página, y no pasa nada: solo permite **leer** archivos
> que ya son públicos, y la restricción por dominio impide usarla desde otro sitio.
>
> Hace falta sí o sí: los enlaces de descarga normales de Drive no se pueden leer desde
> otra web (no mandan cabeceras CORS). La API sí, y por eso va por ahí.

**Varias carpetas.** `?folder=<id o URL>` abre otra sin tocar el código — un enlace
guardado en las Quest por proyecto.

## Publicarlo en GitHub Pages

WebXR **solo funciona en contexto seguro** (HTTPS o `localhost`). Un `http://192.168.x.x`
de tu PC no vale, por eso GitHub Pages es la vía correcta. Ahí solo va la web; los modelos
siguen en Drive.

1. Crea un repositorio y sube el contenido de esta carpeta **en la raíz**
   (que `index.html` quede arriba del todo, no dentro de otra carpeta).
2. `Settings → Pages → Deploy from a branch`, rama `main`, carpeta `/ (root)`.
3. Espera un par de minutos y abre `https://<usuario>.github.io/<repo>/`
   **en el navegador de las propias Quest**. Pulsa **Entrar en VR**.

## Añadir modelos

Súbelos a la carpeta de Drive (o a una subcarpeta suya, se puede entrar en ellas desde el
visor) y pulsa **↻**. Formatos: **`.glb`** —el recomendado—, `.gltf`, `.obj`, `.stl`, `.ply`.
Todo se descarga a la memoria de las gafas, así que por encima de ~150 MB va a ir justo.

Extra: `?model=https://…/algo.glb` abre un modelo suelto que no esté en la carpeta.

---

## Controles

### Escritorio
| | |
|---|---|
| Ratón / rueda | orbitar y acercar |
| Caminar | primera persona: `WASD`, `Espacio`/`C` subir y bajar, `Shift` correr, `Esc` salir |
| ⟲X ⟲Y ⟲Z | giros de 90° para enderezar modelos tumbados (Z-up vs Y-up) |
| 1:1 | tamaño real, sin normalizar (para glTF en metros) |
| Ajustes | exposición, fuerza de la AO, sombra de contacto, suavidad y color de la arcilla |

### Quest 2
| | |
|---|---|
| Stick izquierdo | andar (a la velocidad que toque según tu tamaño) |
| Stick derecho | girar a saltos de 30° |
| **Gatillo** | puntero: pulsa el panel de muñeca, o teletransporta al suelo |
| **Agarre (grip)** | arrastrarte por el mundo: el punto que agarras se queda pegado a la mano |
| **Los dos agarres** | **escalarte**: separar las manos agranda el mundo, juntarlas te hace gigante |
| Manos (sin mandos) | el **pellizco** hace de puntero y de agarre |

El modelo **no se coge**: lo que se mueve al agarrar eres tú. Así se queda siempre clavado
en su sitio, con sus sombras horneadas, y no hay forma de descolocarlo sin querer.

El **panel de control va anclado a la muñeca izquierda**: gírala hacia ti, como para mirar
el reloj (o simplemente apúntale con el otro mando, también aparece). Arriba a la derecha
tienes a qué escala estás viendo el mundo y a cuántos hercios va la sesión.

### Ponerse a escala y andar de verdad

1. Con los **dos agarres**, separa o junta las manos hasta que el espacio te quede al
   tamaño que quieres. Tus pies siguen siempre en el suelo, así que el suelo real y el
   virtual son el mismo.
2. Pulsa **Mundo fijo** en el panel. A partir de ahí los sticks, el teletransporte y el
   agarre dejan de responder: puedes caminar físicamente por la habitación sin miedo a
   mover nada de un roce.
3. Para volver a moverlo todo, vuelve a pulsar el mismo botón. **Salir de VR**, al lado,
   cierra la sesión sin tener que quitarte las gafas.

---

## Cómo se consigue el acabado clay

El visor **no usa postproceso**. La versión anterior aplicaba `GTAOPass`, que además de no
poder funcionar en estéreo era lo que pintaba el rectángulo negro sobre el modelo.

Como el modelo está quieto, todo lo caro se calcula **una sola vez al cargar** y en marcha
—también dentro de las gafas— sale gratis:

1. **Entorno de estudio (IBL)** generado por código: un cenital grande, un softbox cálido a
   la izquierda, un relleno frío a la derecha, contraluz y rebote de suelo.
2. **Oclusión ambiental horneada por vértice** (`js/ao-bake.js`): se renderiza el modelo en
   profundidad desde 20–40 direcciones repartidas por la esfera y se mide, vértice a
   vértice, cuánto cielo ve, ponderado por el coseno. Es AO de hemisferio de verdad —una
   esfera da exactamente 1,0 y el interior de un toro baja a ~0,35—. Se guarda en el
   atributo `aAO` y el shader la aplica a la luz indirecta, como un `aoMap` nativo.
3. **Sombras de suelo horneadas** (`js/lighting.js`): dos texturas difuminadas, una con la
   silueta proyectada según el rayo de la luz principal y otra con el oscurecimiento de
   contacto. Al ser texturas que se desvanecen por los cuatro lados, no pueden producir el
   borde recto de un plano cazasombras.
4. **Auto-sombra en tiempo real** con mapa VSM, que sí es blanda de verdad y sigue al
   modelo cuando lo agarras y lo giras.

La AO se hornea **después** de mostrar el modelo, con barra de progreso: se ve enseguida y
el detalle de los recovecos va apareciendo. En mallas de más de 2 millones de vértices se
salta (avisa) y se queda solo con la luz de estudio.

### Rendimiento en Quest 2
En *Ajustes → Calidad*. **Media** es el ajuste pensado para las Quest 2: foveated rendering
al 0,8, mapa de sombras de 1024 y 32 direcciones de AO. Si notas tirones con modelos
pesados, baja a **Baja** (escala el framebuffer a 0,8 y sube la foveación al máximo).

Al entrar, el visor pide **el refresco más alto que ofrezca el casco** (72 / 90 / 120 Hz
según el modelo y lo que tengas habilitado en los ajustes del propio visor). El casco solo
lo concede si la escena llega; los hercios reales se ven en el panel de muñeca. Si ves 90
pero notas que va a saltos, es que no llega: baja la calidad.

El mapa de sombras no se recalcula por fotograma —el modelo está quieto—, solo cuando algo
cambia de verdad. Esa era la mayor factura fija que había.

---

## Estructura

```
index.html            armazón e importmap
css/styles.css
js/config.js          carpeta de Drive y clave de API
js/sources.js         listado y descarga de la carpeta de Drive
js/state.js           estado compartido entre la UI de escritorio y el panel de VR
js/viewer.js          renderizador, escena, cámara, bucle, modo caminar
js/lighting.js        entorno de estudio, luces y horneado de sombras de suelo
js/clay.js            material de arcilla e inyección de AO y realce de silueta
js/ao-bake.js         horneado de oclusión ambiental por vértice
js/loaders.js         formatos (Draco, Meshopt y KTX2 incluidos)
js/ui.js              interfaz de escritorio
js/xr.js              sesión WebXR, mandos, manos, refresco y desplazamiento
js/xr-world.js        agarrar el mundo: arrastrarte y escalarte
js/xr-panel.js        panel de control anclado a la muñeca
js/main.js            orquestación
```

Los modelos no están en el repositorio: se leen de Drive.

## Probarlo en local

```bash
python -m http.server 8000
```

y abre `http://localhost:8000`. En `localhost` WebXR funciona, así que también se puede
probar con Quest Link.

La lista de Drive funciona igual en local, pero si has restringido la clave por dominio
tendrás que añadir también `http://localhost:8000/*` a los sitios permitidos; si no, Google
la rechaza y el visor avisa de que la clave no vale desde este dominio.
