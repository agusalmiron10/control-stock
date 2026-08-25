// Caché local de clientes/herramientas para que la pantalla de venta rápida
// funcione con cero señal (búsqueda de cliente, lista de herramientas y
// precios). Se refresca cada vez que /api/clientes o /api/herramientas
// responden online; se lee de acá cuando no hay red.
import { STORE_CLIENTES, STORE_HERRAMIENTAS, STORE_META, obtenerTodos, putMuchos, put, obtener, limpiar } from "./db";

const CLAVE_ULTIMA_ACTUALIZACION = "cache_actualizada_en";
const CLAVE_RECIENTES = "clientes_recientes";
const CLAVE_SESION = "sesion_cacheada";
const CLAVE_NEGOCIO_CACHE = "negocio_de_la_cache";

/**
 * La caché vive en un solo IndexedDB del navegador, así que si cambia el
 * negocio hay que vaciarla: si no, los clientes y precios del negocio
 * anterior se seguirían viendo. Pasa cuando el proveedor entra a dar soporte
 * a dos clientes distintos desde la misma computadora.
 */
export async function asegurarCacheDelNegocio(negocioId: string | null): Promise<void> {
  const meta = await obtener<{ clave: string; valor: string | null }>(STORE_META, CLAVE_NEGOCIO_CACHE);
  const guardado = meta?.valor ?? null;
  if (guardado === negocioId) return;
  if (guardado !== null) {
    await limpiar(STORE_CLIENTES);
    await limpiar(STORE_HERRAMIENTAS);
    await put(STORE_META, { clave: CLAVE_RECIENTES, valor: [] });
    await put(STORE_META, { clave: CLAVE_ULTIMA_ACTUALIZACION, valor: null });
  }
  await put(STORE_META, { clave: CLAVE_NEGOCIO_CACHE, valor: negocioId });
}

export interface SesionCacheada {
  usuario: string;
  rol: "dueño" | "empleado" | "soporte" | "super";
  /** En qué negocio estaba: sin esto, al volver sin señal no se sabe de quién
   *  son los datos que quedaron en la caché. */
  negocio: { id: string; nombre: string; codigo: string } | null;
}

/** Última sesión autenticada conocida — para poder entrar a la app sin
 * señal si el proceso se reinició y no se puede confirmar la cookie contra
 * el servidor. No reemplaza la sesión real: en cuanto vuelve la red, la
 * app vuelve a chequear contra el servidor y desloguea si hace falta. */
export async function guardarSesionCacheada(sesion: SesionCacheada): Promise<void> {
  await put(STORE_META, { clave: CLAVE_SESION, valor: sesion });
}

export async function leerSesionCacheada(): Promise<SesionCacheada | null> {
  const meta = await obtener<{ clave: string; valor: SesionCacheada }>(STORE_META, CLAVE_SESION);
  return meta?.valor ?? null;
}

export async function borrarSesionCacheada(): Promise<void> {
  await put(STORE_META, { clave: CLAVE_SESION, valor: null });
}

export async function guardarCacheClientes(clientes: any[]): Promise<void> {
  await putMuchos(STORE_CLIENTES, clientes);
  await put(STORE_META, { clave: CLAVE_ULTIMA_ACTUALIZACION, valor: new Date().toISOString() });
}

export async function guardarCacheHerramientas(herramientas: any[]): Promise<void> {
  await putMuchos(STORE_HERRAMIENTAS, herramientas);
  await put(STORE_META, { clave: CLAVE_ULTIMA_ACTUALIZACION, valor: new Date().toISOString() });
}

export async function leerCacheClientes(): Promise<any[]> {
  return obtenerTodos(STORE_CLIENTES);
}

export async function leerCacheHerramientas(): Promise<any[]> {
  return obtenerTodos(STORE_HERRAMIENTAS);
}

/** Hora de la última vez que se pudo refrescar la caché (null si nunca). */
export async function ultimaActualizacionCache(): Promise<string | null> {
  const meta = await obtener<{ clave: string; valor: string }>(STORE_META, CLAVE_ULTIMA_ACTUALIZACION);
  return meta?.valor ?? null;
}

/** Últimos clientes elegidos en una venta, para tenerlos a mano en la venta rápida. */
export async function agregarClienteReciente(id: string): Promise<void> {
  const meta = await obtener<{ clave: string; valor: string[] }>(STORE_META, CLAVE_RECIENTES);
  const lista = meta?.valor ?? [];
  const nueva = [id, ...lista.filter((x) => x !== id)].slice(0, 8);
  await put(STORE_META, { clave: CLAVE_RECIENTES, valor: nueva });
}

export async function leerClientesRecientes(): Promise<string[]> {
  const meta = await obtener<{ clave: string; valor: string[] }>(STORE_META, CLAVE_RECIENTES);
  return meta?.valor ?? [];
}
