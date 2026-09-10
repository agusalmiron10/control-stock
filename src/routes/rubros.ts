import { Hono } from "hono";
import type { Env, Variables } from "../types";

export const rubros = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Los rubros que se ofrecen en el selector. Sólo los activos, en su orden.
 *
 * No devuelve las capacidades de cada uno a propósito: el que elige no tiene
 * que entender qué prende cada rubro, y el front no decide nada con eso —
 * la configuración efectiva se la da /api/config después de elegir.
 */
rubros.get("/", async (c) => {
  const filas = await c.env.DB
    .prepare(`SELECT id, nombre, icono FROM rubros WHERE activo = 1 ORDER BY orden, nombre`)
    .all<{ id: string; nombre: string; icono: string | null }>();
  return c.json({ rubros: filas.results ?? [] });
});
