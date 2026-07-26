// Configuración. Los modelos viven en una carpeta de Google Drive.
//
// Hacen falta dos datos, y se rellenan una sola vez:
//
//  1) folderId — el identificador de la carpeta. Abre la carpeta en Drive y copia el
//     trozo final de la URL: https://drive.google.com/drive/folders/AQUÍ_VA_EL_ID
//     (también vale pegar la URL entera, se extrae el ID solo).
//     La carpeta tiene que estar compartida como «Cualquier persona con el enlace».
//
//  2) apiKey — una clave de API de Google con la Google Drive API activada.
//     console.cloud.google.com → proyecto nuevo → APIs y servicios → habilitar
//     «Google Drive API» → Credenciales → Crear credenciales → Clave de API.
//     Restríngela a la Drive API y a tu dominio (Sitios web → https://TUUSUARIO.github.io/*)
//     para que no la pueda usar nadie más.
//
// La clave solo da acceso de LECTURA a archivos que ya son públicos, así que no pasa nada
// porque viaje en el código de la página; la restricción por dominio es la que la protege.

export const DRIVE = {
  /** ID (o URL) de la carpeta de Drive con los modelos. */
  folderId: '166IBbsIHW1jo1UCB0geSQ8wlwWCEh8DI',

  /** Clave de API de Google con la Drive API habilitada. */
  apiKey: 'AIzaSyCOq71dBANJSXP8DabjXH-WGHQ3RxW_rkM',
};

/** Extrae el ID de una URL de carpeta de Drive, o devuelve lo que ya sea un ID. */
export function folderIdOf(value = DRIVE.folderId) {
  const raw = String(value || '').trim();
  const match = raw.match(/[-\w]{25,}/);       // los IDs de Drive son largos
  return match ? match[0] : raw;
}

/**
 * Permite abrir otra carpeta sin tocar el código: ?folder=<id o URL>.
 * Útil para tener varios enlaces guardados en las Quest, uno por proyecto.
 */
export function requestedFolder(search = location.search) {
  const param = new URLSearchParams(search).get('folder');
  return param ? folderIdOf(param) : folderIdOf();
}
