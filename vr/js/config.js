// Configuración. En el caso normal no hay que tocar nada: el visor deduce solo de qué
// repositorio tiene que leer a partir de la URL de GitHub Pages.

export const SOURCE = {
  /** Carpeta del repositorio donde viven los modelos. */
  folder: 'models',

  /**
   * Repositorio del que se lista la carpeta. Vacío = se detecta desde la URL
   * (https://USUARIO.github.io/REPO/ → owner=USUARIO, repo=REPO).
   * Solo hace falta rellenarlo si sirves la web desde un dominio propio.
   */
  owner: '',
  repo: '',

  /** Rama. Vacío = la rama por defecto del repositorio. */
  branch: '',
};

/**
 * Deduce owner/repo de la URL, o usa lo puesto a mano arriba.
 * @param {{hostname:string, pathname:string}} loc  inyectable para poder probarlo
 */
export function repoInfo(loc = location) {
  if (SOURCE.owner && SOURCE.repo) {
    return { owner: SOURCE.owner, repo: SOURCE.repo, detected: false };
  }
  const host = String(loc.hostname || '').match(/^([\w-]+)\.github\.io$/i);
  if (!host) return null;
  const owner = host[1];
  const first = String(loc.pathname || '/').split('/').filter(Boolean)[0];
  // Sin subcarpeta en la ruta es una «user page»: el repo se llama usuario.github.io
  return { owner, repo: first || `${owner}.github.io`, detected: true };
}
