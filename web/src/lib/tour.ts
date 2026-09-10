/**
 * Sólo la parte del tour guiado que hace falta ANTES de cargarlo: si ya lo
 * vio, no tiene sentido ni siquiera bajar el chunk de react-joyride (~27 KB
 * gzip) — por eso esto vive en un archivo aparte y liviano, sin importar
 * react-joyride, y App.tsx lo usa para decidir si monta <TourInicial> o no.
 */

/** Una clave por negocio + usuario: si el mismo empleado atiende dos negocios, cada uno le muestra el suyo. */
export function claveTourVisto(negocioId: string, usuario: string): string {
  return `stockeate_tour_visto_${negocioId}_${usuario}`;
}

export function tourYaVisto(negocioId: string, usuario: string): boolean {
  try {
    return localStorage.getItem(claveTourVisto(negocioId, usuario)) === "1";
  } catch {
    // Sin storage (modo incógnito, cuotas): no se puede recordar, así que
    // no se bloquea — mejor mostrarlo de más que perderlo para siempre.
    return false;
  }
}
