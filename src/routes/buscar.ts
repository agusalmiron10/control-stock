import { Hono } from "hono";
import { negocioDe, type Env, type Variables } from "../types";

export const buscar = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Buscador global: clientes, herramientas y ventas (por número), hasta 6 de cada uno. */
buscar.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ clientes: [], herramientas: [], ventas: [] });

  const like = `%${q}%`;
  const numero = Number(q);

  const neg = negocioDe(c);
  const clientesRows = await c.env.DB.prepare(
    `SELECT id, nombre FROM clientes
     WHERE negocio_id = ? AND activo = 1 AND nombre LIKE ? ORDER BY nombre COLLATE NOCASE LIMIT 6`
  )
    .bind(neg, like)
    .all<{ id: string; nombre: string }>();

  const herramientasRows = await c.env.DB.prepare(
    `SELECT id, codigo, nombre FROM herramientas
     WHERE negocio_id = ? AND activo = 1 AND (nombre LIKE ? OR codigo LIKE ?)
     ORDER BY nombre COLLATE NOCASE LIMIT 6`
  )
    .bind(neg, like, like)
    .all<{ id: string; codigo: string; nombre: string }>();

  const ventasRows = Number.isInteger(numero) && numero > 0
    ? await c.env.DB.prepare(
        `SELECT v.id, v.numero, v.total, v.cliente_id, cl.nombre AS cliente_nombre
         FROM ventas v JOIN clientes cl ON cl.id = v.cliente_id
         WHERE v.negocio_id = ? AND v.numero = ? LIMIT 6`
      )
        .bind(neg, numero)
        .all<{ id: string; numero: number; total: number; cliente_id: string; cliente_nombre: string }>()
    : { results: [] };

  return c.json({
    clientes: clientesRows.results ?? [],
    herramientas: herramientasRows.results ?? [],
    ventas: ventasRows.results ?? [],
  });
});
