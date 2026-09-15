/**
 * Un import() dinámico que sobrevive a un deploy.
 *
 * Las partes pesadas de la app (el gráfico del panel, el tour, la librería
 * de PDF) se cargan aparte, recién cuando hacen falta. El archivo de cada
 * una lleva un hash en el nombre, así que cuando sale una versión nueva los
 * archivos viejos dejan de existir. Para quien ya tenía la pantalla abierta
 * desde antes, ese pedido termina en el index.html del servidor en vez del
 * JS que pedía, el navegador lo rechaza y —sin nada que lo atrape— se cae
 * toda la pantalla.
 *
 * La salida correcta es recargar una vez: la app vuelve con la versión
 * nueva y el archivo que busca sí existe. El flag en sessionStorage es para
 * no quedar en un bucle de recargas si el problema fuera otro (por ejemplo,
 * quedarse sin conexión justo ahí).
 */
const CLAVE = "cs_recarga_por_version_nueva";

export function conReintento<T>(cargar: () => Promise<T>): Promise<T> {
  return cargar().then(
    (modulo) => {
      // Cargó bien: se limpia el flag para que un deploy futuro, en esta
      // misma sesión, también pueda recuperarse solo.
      try { sessionStorage.removeItem(CLAVE); } catch { /* modo privado */ }
      return modulo;
    },
    (error) => {
      let yaRecargo = false;
      try { yaRecargo = sessionStorage.getItem(CLAVE) === "1"; } catch { /* modo privado */ }
      if (yaRecargo) throw error;
      try { sessionStorage.setItem(CLAVE, "1"); } catch { /* modo privado */ }
      window.location.reload();
      // La recarga corta todo; esta promesa no tiene que resolver nunca.
      return new Promise<T>(() => {});
    }
  );
}
