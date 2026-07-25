# Modelos

Deja aquí tus archivos. El visor lista esta carpeta solo — no hay que apuntarlos en
ningún sitio.

**Para subir un modelo:** entra en esta carpeta en github.com → botón **Add file** →
**Upload files** → arrastra los archivos → **Commit changes**. En un par de minutos
aparecen en el visor (o pulsa ↻ para releer la lista).

- Formatos: `.glb` · `.gltf` · `.obj` · `.stl` · `.ply`
- Usa **`.glb`**, no `.gltf` suelto: un `.gltf` con su `.bin` y sus texturas aparte no
  resuelve bien las rutas.
- **Máximo 100 MB por archivo** (límite de GitHub). Si te pasas, exporta con compresión
  **Draco** o **Meshopt** — el visor los descomprime solo y suelen bajar más del 80 %.
  En Blender: *Exportar glTF 2.0 → Compresión → Draco*.
- Puedes crear subcarpetas para organizar. El visor deja entrar en ellas, también desde
  el panel de la muñeca con las gafas puestas.

Los archivos que no sean modelos (un `.pdf`, un `.txt`) salen en gris y no se pueden
abrir. No molestan, así que puedes dejar aquí notas si quieres.

---

### `models.json` (opcional)

Solo hace falta si quieres probar el visor **en local antes de publicar el repositorio**,
cuando la API de GitHub todavía no tiene nada que listar. Crea un `models.json` aquí:

```json
{ "models": [ { "name": "Carcasa", "file": "carcasa.glb" } ] }
```

Una vez publicado en GitHub Pages, el listado automático manda y este archivo se ignora.
