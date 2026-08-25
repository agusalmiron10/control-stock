import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { HttpError } from "../validate";
import { requireDueno } from "../auth";
import { negocioDe } from "../types";

export const backup = new Hono<{ Bindings: Env; Variables: Variables }>();
backup.use("*", requireDueno);

const TABLAS = [
  "clientes",
  "herramientas",
  "ventas",
  "venta_items",
  "pagos",
  "movimientos_stock",
  "precios_historial",
  "presupuestos",
  "presupuesto_items",
  "operaciones",
] as const;

/** Descarga toda la base (menos usuarios) como JSON. */
backup.get("/", async (c) => {
  // Sólo los datos de ESTE negocio: un cliente nunca se lleva los de otro.
  const neg = negocioDe(c);
  const data: Record<string, unknown[]> = {};
  for (const t of TABLAS) {
    const rows = await c.env.DB.prepare(`SELECT * FROM ${t} WHERE negocio_id = ?`).bind(neg).all();
    data[t] = rows.results ?? [];
  }
  const dump = {
    _meta: { app: "control-stock", version: 1, exportado_en: new Date().toISOString() },
    ...data,
  };
  return c.json(dump);
});

/** Restaura la base desde un JSON con la misma estructura. Reemplaza TODO. */
backup.post("/restore", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new HttpError(400, "El archivo de respaldo no es válido.");
  if (body._meta?.app !== "control-stock") {
    throw new HttpError(400, "El archivo no parece un respaldo de esta aplicación.");
  }

  const stmts: D1PreparedStatement[] = [];

  // Borrar en orden inverso por las claves foráneas — sólo de este negocio.
  const neg = negocioDe(c);
  for (const t of [...TABLAS].reverse()) {
    stmts.push(c.env.DB.prepare(`DELETE FROM ${t} WHERE negocio_id = ?`).bind(neg));
  }

  // Reinsertar en orden directo.
  for (const t of TABLAS) {
    const filas = Array.isArray((body as any)[t]) ? ((body as any)[t] as Record<string, unknown>[]) : [];
    for (const fila of filas) {
      // El negocio se fuerza al de la sesión: un respaldo de otro cliente
      // no puede escribir datos dentro de éste.
      const datos: Record<string, unknown> = { ...fila, negocio_id: neg };
      const cols = Object.keys(datos);
      if (cols.length === 0) continue;
      const placeholders = cols.map(() => "?").join(",");
      stmts.push(
        c.env.DB.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${placeholders})`).bind(
          ...cols.map((k) => datos[k] as any)
        )
      );
    }
  }

  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
