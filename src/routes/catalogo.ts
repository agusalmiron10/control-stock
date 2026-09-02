/**
 * Catálogo maestro: nombres de artículos comunes de ferretería para
 * autocompletar al crear un producto.
 *
 * Es una tabla GLOBAL, compartida por todos los negocios y de sólo lectura:
 * no guarda precios, stock ni nada que pertenezca a nadie. Por eso las
 * consultas de acá no filtran por negocio_id — ver el comentario en
 * migrations/0018_mostrador_agil.sql.
 *
 * Lo único que se escribe es el contador veces_usado, que sirve para que las
 * sugerencias se ordenen por lo que la gente realmente elige.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { normalizarBusqueda } from "../validate";

export const catalogo = new Hono<{ Bindings: Env; Variables: Variables }>();

export interface ArticuloCatalogo {
  id: number;
  nombre: string;
  rubro: string;
}

/** Sugerencias para el buscador. Vacío si no hay con qué buscar. */
catalogo.get("/", async (c) => {
  const q = normalizarBusqueda(c.req.query("q") ?? "");
  if (q.length < 2) return c.json({ articulos: [] });

  // Primero los que empiezan con lo tipeado (es lo que uno espera al tipear),
  // después los que lo contienen en el medio; dentro de cada grupo, lo más usado.
  const r = await c.env.DB.prepare(
    `SELECT id, nombre, rubro FROM catalogo_maestro
     WHERE busqueda LIKE ?1 || '%' OR busqueda LIKE '%' || ?1 || '%'
     ORDER BY (busqueda LIKE ?1 || '%') DESC, veces_usado DESC, nombre
     LIMIT 8`
  )
    .bind(q)
    .all<ArticuloCatalogo>();

  return c.json({ articulos: r.results ?? [] });
});
