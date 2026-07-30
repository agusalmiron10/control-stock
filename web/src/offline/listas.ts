// Listas de clientes/herramientas "cache-first" para pantallas que tienen
// que funcionar sin señal: si el pedido de red falla, cae a lo último que
// se guardó en IndexedDB (mostrando cuándo se actualizó por última vez).
import { api } from "../api";
import { guardarCacheClientes, guardarCacheHerramientas, leerCacheClientes, leerCacheHerramientas, ultimaActualizacionCache } from "./cache";

export interface ListaOffline<T> {
  items: T[];
  deCache: boolean;
  actualizadoEn: string | null;
}

export async function obtenerClientes(): Promise<ListaOffline<any>> {
  try {
    const d = await api.get<any>("/api/clientes");
    void guardarCacheClientes(d.clientes);
    return { items: d.clientes, deCache: false, actualizadoEn: new Date().toISOString() };
  } catch {
    const items = await leerCacheClientes();
    return { items, deCache: true, actualizadoEn: await ultimaActualizacionCache() };
  }
}

export async function obtenerHerramientas(): Promise<ListaOffline<any>> {
  try {
    const d = await api.get<any>("/api/herramientas");
    void guardarCacheHerramientas(d.herramientas);
    return { items: d.herramientas, deCache: false, actualizadoEn: new Date().toISOString() };
  } catch {
    const items = await leerCacheHerramientas();
    return { items, deCache: true, actualizadoEn: await ultimaActualizacionCache() };
  }
}
