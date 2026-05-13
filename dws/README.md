# Deep Work Schedule

> Planificador semanal de bloques de tiempo con integración nativa de ClickUp.  
> Sin servidor. Sin cuenta. Corre en el navegador y guarda todo en local.

---

## Tabla de contenidos

- [¿Qué es esto?](#qué-es-esto)
- [Arquitectura rápida](#arquitectura-rápida)
- [La rejilla semanal](#la-rejilla-semanal)
- [Bloques de tiempo](#bloques-de-tiempo)
  - [Crear un bloque](#crear-un-bloque)
  - [Editar un bloque](#editar-un-bloque)
  - [Arrastrar y soltar](#arrastrar-y-soltar)
  - [Redimensionar](#redimensionar)
- [El modal de edición](#el-modal-de-edición)
  - [Campos](#campos)
  - [Acciones de bloque](#acciones-de-bloque)
  - [Acciones de portapapeles](#acciones-de-portapapeles)
- [Integración con ClickUp](#integración-con-clickup)
  - [Configurar el token](#configurar-el-token)
  - [Buscar tareas](#buscar-tareas)
  - [Imputar horas](#imputar-horas)
- [Sistema de presets](#sistema-de-presets)
- [Panel de priorización](#panel-de-priorización)
- [Temas visuales](#temas-visuales)
- [Notificaciones](#notificaciones)
- [Tooltips](#tooltips)
- [Exportar e importar](#exportar-e-importar)
- [Atajos de teclado](#atajos-de-teclado)
- [Persistencia y datos](#persistencia-y-datos)
- [Instancia única](#instancia-única)

---

## ¿Qué es esto?

**Deep Work Schedule** es una aplicación web de una sola página para planificar tu semana laboral en bloques de tiempo. Está pensada para quien trabaja con ClickUp y necesita tanto planificar como registrar horas sin salir de la herramienta.

Todo corre en el navegador. No hay backend, no hay login, no hay cookies de terceros. El estado se persiste en **IndexedDB** y las credenciales de ClickUp en **localStorage**, ambos locales a tu máquina.

---

## Arquitectura rápida

```
dws/
├── index.html          — Estructura HTML y modales
├── css/
│   └── styles.css      — Temas, rejilla, componentes
└── js/
    ├── app.js          — Lógica principal y event listeners
    ├── clickup.js      — Llamadas a la API de ClickUp
    ├── config.js       — Constantes (días, intervalos, colores)
    ├── db.js           — Capa de IndexedDB
    ├── heartbeat.js    — Control de instancia única
    ├── notifications.js— Notificaciones del navegador
    ├── presets.js      — Gestión de presets de tarea
    ├── tooltip.js      — Tooltips personalizados
    └── utils.js        — Utilidades de fecha y tiempo
```

El punto de entrada es `index.html`. Importa `heartbeat.js` primero para detectar instancias duplicadas y luego carga `app.js` como módulo ES6 si es la instancia primaria.

---

## La rejilla semanal

La rejilla muestra **lunes a viernes** con franjas de **15 minutos**. Dos controles en la parte superior definen su rango visible:

| Control | Descripción | Valor por defecto |
|---|---|---|
| **Week (Monday)** | Lunes de la semana activa | Semana actual |
| **Start Time** | Primera hora visible en la rejilla | 08:00 |
| **End Time** | Última hora visible en la rejilla | 18:00 |

La semana siempre se ajusta al lunes al cargar la aplicación. Los encabezados de columna muestran el nombre del día y el número de día del mes (ej. `Tuesday 22`).

**Columna del día actual** — La columna de hoy se resalta con un fondo semitransparente tanto en el cuerpo de la tabla como en el encabezado.

**Línea de tiempo actual** — Una línea horizontal roja recorre todas las columnas mostrando la hora actual. Se actualiza cada minuto y desaparece fuera del rango visible.

---

## Bloques de tiempo

### Crear un bloque

Hay dos formas:

1. **Clic en una celda** — Abre el modal con la hora de esa celda como inicio y la siguiente franja como fin.
2. **Arrastrar sobre celdas** — Mantén pulsado y arrastra hacia abajo para seleccionar un rango. Al soltar el ratón se abre el modal con el rango completo seleccionado.

Si el rango seleccionado solapa un bloque existente, aparece un aviso y la acción se cancela.

### Editar un bloque

Haz clic sobre cualquier bloque para abrir el modal de edición con sus datos actuales.

### Arrastrar y soltar

Arrastra un bloque desde cualquier parte de su área (excepto los handles de resize) a otra celda de la rejilla.

- **Arrastre normal** — Mueve el bloque. Mantiene su duración original truncándola si no cabe.
- **Arrastre con `Shift`** — Copia el bloque. Se crea un duplicado con un nuevo ID en la celda de destino.

Si la celda de destino produciría un solapamiento, el bloque no se coloca.

### Redimensionar

Cada bloque tiene dos handles invisibles: uno en el borde superior y otro en el inferior. Al pasar el cursor sobre ellos aparece un indicador de resize.

- **Handle superior** — Ajusta la hora de inicio.
- **Handle inferior** — Ajusta la hora de fin.

El resize se encaja automáticamente a la cuadrícula de 15 minutos. Si el nuevo tamaño solapara otro bloque, se revierten los cambios y se muestra un aviso.

---

## El modal de edición

### Campos

| Campo | Descripción |
|---|---|
| **Start Time** | Hora de inicio del bloque |
| **End Time** | Hora de fin del bloque |
| **Project Name** | Nombre del proyecto (visible en el bloque si hay espacio) |
| **Task Name** | Nombre de la tarea (visible en bloques de más de 15 min) |
| **Task ID** | ID de la tarea en ClickUp. Activa el botón de imputación y el enlace externo |
| **Description** | Notas o descripción libre. Se usa como descripción en ClickUp al imputar |
| **Color** | Color del borde izquierdo del bloque. 12 opciones, distintas por tema |
| **Logged** | Marcador manual de "ya registrado". Se activa automáticamente al imputar |

### Acciones de bloque

| Botón | Comportamiento |
|---|---|
| **Accept** | Guarda el bloque (nuevo o editado) |
| **Delete** | Elimina el bloque tras confirmación |
| **Sync Card** | Propaga los cambios del modal a **todos los bloques de la semana** que tengan exactamente los mismos valores de proyecto, tarea, task ID, descripción y color |
| **Logged** | Alterna el estado de "registrado" del bloque (y de todos los que comparten día, tarea y descripción) |

### Acciones de portapapeles

| Botón | Qué copia |
|---|---|
| **Copy Description** | Solo el texto de la descripción |
| **Copy Task ID** | Solo el Task ID |
| **Copy Total Time** | Horas totales del día para el mismo proyecto y descripción, en formato decimal (ej. `2.5`) |
| **Copy** | El bloque completo en formato CSV: `"proyecto","tarea","taskId","descripción","#hexcolor","logged"` |
| **Import** | Lee el portapapeles y rellena el modal con un bloque copiado previamente (formato CSV) |

> El botón **Open in ClickUp** (icono de enlace externo junto al campo Task ID) abre la tarea directamente en ClickUp en una pestaña nueva.

---

## Integración con ClickUp

### Configurar el token

1. Haz clic en el botón **ClickUp** (panel derecho).
2. Pega tu **Personal API Token** de ClickUp (se obtiene en *Settings → Apps* en ClickUp).
3. Pulsa **Save token**.

La app verifica el token llamando a `/user` y `/team`, guarda tu nombre y el ID de tu equipo, y muestra tu nombre de usuario en el botón. Las credenciales se guardan en `localStorage` y persisten entre sesiones.

### Buscar tareas

El selector de tareas se abre con el botón **archivo** del campo Project Name. Dentro encontrarás:

**Recently used** — Presets guardados automáticamente de tus bloques anteriores.

**Fetch by ID / URL** — Escribe o pega un Task ID o una URL completa de ClickUp (`https://app.clickup.com/t/…`) y pulsa el botón de descarga. La app rellena Project, Task Name y Task ID automáticamente.

**My ClickUp Tasks** — Lista de tus tareas abiertas y asignadas, agrupadas por lista. Incluye subtareas indentadas bajo su tarea padre. Haz clic en cualquier tarea para rellenar el modal. El botón de refresco fuerza una recarga de la API.

### Imputar horas

El bloque `imputarRow` aparece en el modal **solo si** hay un Task ID configurado y ClickUp está conectado.

Hay dos modos de imputación:

---

#### Imputar bloque

Suma la duración de **todos los bloques del mismo día con el mismo Task ID** y los registra como **una sola entrada** de tiempo en ClickUp. La hora de inicio usada es la del bloque más temprano del grupo.

> Útil cuando tienes varios fragmentos de trabajo en la misma tarea y quieres registrarlo como una sesión continua.

---

#### Imputar granular

Crea **una entrada de tiempo por cada bloque** del mismo día y Task ID. Cada entrada tiene su propio timestamp de inicio y su duración exacta.

> Útil cuando quieres que el histórico de ClickUp refleje exactamente cuándo trabajaste: `10:00–11:00` y `12:00–13:00` aparecen como dos registros separados.

---

En ambos casos:
- La descripción de la entrada en ClickUp viene del campo **Description** de cada bloque.
- Los bloques imputados se marcan automáticamente como **Logged** (punto verde).
- La entrada se registra en el endpoint `POST /team/{teamId}/time_entries` con los campos `tid`, `start`, `duration`, `description` y `assignee`.

---

## Sistema de presets

Cada vez que aceptas un bloque con Project Name, Task Name o Task ID, la combinación se guarda como preset. La lista se gestiona desde el modal selector de tareas.

**Organización:**
- Los presets se agrupan por **Project Name**.
- Dentro de cada grupo, las tareas se ordenan por último uso.

**Reordenar con drag & drop:**
- Arrastra el icono `⠿` a la izquierda de un **grupo de proyecto** para reordenar grupos entre sí.
- Arrastra el icono `⠿` de una **fila de tarea** para reordenarla dentro de su grupo.
- La zona de inserción se resalta al arrastrar.

**Acciones por preset:**
| Acción | Cómo |
|---|---|
| Usar preset | Clic en el nombre de la tarea |
| Abrir en ClickUp | Clic en el icono de enlace externo (solo si tiene Task ID) |
| Eliminar | Clic en el botón `×` de la fila |

---

## Panel de priorización

Se abre y cierra con el botón **Prioritization** del panel lateral. Cuando está abierto, el contenido principal se desplaza a la derecha.

Contiene tres áreas de texto libres:

| Área | Propósito sugerido |
|---|---|
| **Top 3 tasks** | Las tres tareas más importantes del día |
| **Other Tasks** | Backlog secundario |
| **Ideas** | Notas rápidas e ideas |

**Indentación con teclado:**
- `Tab` — Añade 2 espacios de indentación en la línea actual (o en todas las seleccionadas).
- `Shift + Tab` — Elimina 2 espacios de indentación.
- `Escape` — Cierra el panel.

El contenido se guarda automáticamente con el estado de la aplicación.

---

## Temas visuales

Tres temas disponibles desde el panel lateral:

### Dark Mode *(por defecto)*
Fondo negro puro `#000000`, texto gris claro `#eeeeee`. Colores de bloque saturados y brillantes para máxima legibilidad. Fuente JetBrains Mono.

### Light Mode
Fondo blanco `#ffffff`, texto oscuro `#333333`. Los mismos 12 colores de bloque pero adaptados a fondo claro.

### Demure Mode
Paleta de colores suaves y pastel. Fondo cálido `#f5f0e8`, acentos en tonos tierra. Fuente **Nunito** (sans-serif). Pensado para sesiones largas con menos fatiga visual.

---

Cada tema define sus propios valores para los **12 colores de bloque**:

`Red · Orange · Yellow · Green · Blue · Purple · Pink · Cyan · Teal · Lime · Magenta · Gray`

Al cambiar de tema, los bloques existentes actualizan su color automáticamente (el nombre del color se preserva, el hex cambia).

---

## Notificaciones

Activa las notificaciones con el checkbox **Notify** del panel lateral. La primera vez se pedirá permiso al navegador.

**Comportamiento:**
- La app calcula el **siguiente bloque programado** para hoy.
- Dispara una notificación del sistema **1 minuto antes** de su hora de inicio.
- Tras disparar, programa automáticamente la notificación del bloque siguiente.
- Si se deniega el permiso, el toggle se desactiva solo.

> Las notificaciones solo funcionan con la pestaña abierta (no hay service worker).

---

## Tooltips

### Tooltip de bloque

Al pasar el cursor sobre un bloque (con 125ms de delay para evitar parpadeos), aparece un tooltip con:

- Nombre del proyecto y la tarea
- Task ID
- Descripción
- Lista de todos los bloques del día con la **misma combinación** de proyecto/tarea/descripción/color, con sus horas individuales
- **Total de horas** acumuladas

### Tooltip de encabezado de día

Al pasar el cursor sobre el encabezado de una columna (ej. `Tuesday 22`):

- Lista de tareas únicas del día, agrupadas
- Horas por tarea
- Total de horas del día
- "No tasks" si el día está vacío

---

## Exportar e importar

### Exportar

El botón **Export** genera un archivo JSON con todo el estado de la aplicación:

```
DWS WEEK 2025-04-21 - Saved on 2025-04-27_14-32-10.json
```

Incluye: bloques, presets, tiempos de inicio/fin, tema, notificaciones, notas de priorización y la semana activa.

### Importar

El botón **Import** abre un selector de archivo. Al cargar un JSON exportado, restaura completamente el estado. Los bloques sin campos nuevos (de versiones antiguas) reciben valores por defecto automáticamente.

### Wipe

El botón **Wipe** borra todos los bloques y las notas de priorización tras confirmación. Los presets, el tema y la configuración de ClickUp **no se borran**.

---

## Atajos de teclado

| Atajo | Contexto | Acción |
|---|---|---|
| `Enter` (Numpad) | Modal abierto | Guarda el bloque |
| `Ctrl + Enter` | Modal abierto | Guarda el bloque |
| `Enter` | Campo Task Fetch | Busca la tarea en ClickUp |
| `Tab` | Textareas de priorización | Indenta 2 espacios |
| `Shift + Tab` | Textareas de priorización | Desindenta 2 espacios |
| `Escape` | Panel de priorización abierto | Cierra el panel |
| `Shift` + drag | Bloque en rejilla | Copia el bloque en lugar de moverlo |

---

## Persistencia y datos

### Base de datos (IndexedDB)

La app usa una base de datos llamada `deepWorkScheduleDB`. Todo el estado se serializa y guarda automáticamente en cada cambio:

```js
{
  schedule: [ /* array de bloques */ ],
  startTime: "08:00",
  endTime: "18:00",
  theme: "dark",
  notificationsEnabled: false,
  projectTaskPresets: [ /* presets */ ],
  prioritization: { top3, other, ideas },
  exportDate: "2025-04-27"
}
```

### Estructura de un bloque

```js
{
  id: 1714219200000,        // timestamp único (Date.now())
  day: "Tuesday",           // nombre del día en inglés
  start: "10:00",           // HH:MM
  end: "11:30",             // HH:MM
  projectName: "DWS",
  taskName: "Documentación",
  taskId: "abc123xyz",
  description: "Escribir README",
  colorName: "blue",        // nombre del color (no hex)
  logged: false             // true si ya se imputó en ClickUp
}
```

### Credenciales ClickUp (localStorage)

```
dws_clickup_token  →  "pk_xxxxxxxxxxxx"
dws_clickup_user   →  { userId, userName, teamId }
```

---

## Instancia única

La app usa un sistema de **heartbeat** para evitar tener dos pestañas abiertas simultáneamente (lo que podría causar conflictos en IndexedDB).

- Al arrancar, genera un ID de instancia único.
- Escribe ese ID en `localStorage` cada segundo.
- Si detecta un cambio escrito por otra pestaña, muestra un overlay de advertencia y se desactiva.
- Al cerrar la pestaña, limpia el heartbeat para que la siguiente apertura funcione con normalidad.

> Si ves el mensaje de "instancia duplicada" y solo tienes una pestaña, recarga la página.

---

*Generado automáticamente a partir del código fuente.*
