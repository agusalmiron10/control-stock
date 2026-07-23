import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { HttpError } from "../validate";

export const backup = new Hono<{ Bindings: Env; Variables: Variables }>();

const TABLAS = [
  "clientes",
  "herramientas",
  "ventas",
  "venta_items",
  "pagos",
  "movimientos_stock",
  "precios_historial",
] as const;

/** Descarga toda la base (menos usuarios) como JSON. */
backup.get("/", async (c) => {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLAS) {
    const rows = await c.env.DB.prepare(`SELECT * FROM ${t}`).all();
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

  // Borrar en orden inverso por las claves foráneas.
  for (const t of [...TABLAS].reverse()) {
    stmts.push(c.env.DB.prepare(`DELETE FROM ${t}`));
  }
  stmts.push(
    c.env.DB.prepare(
      `DELETE FROM sqlite_sequence WHERE name IN (${TABLAS.map(() => "?").join(",")})`
    ).bind(...TABLAS)
  );

  // Reinsertar en orden directo.
  for (const t of TABLAS) {
    const filas = Array.isArray((body as any)[t]) ? ((body as any)[t] as Record<string, unknown>[]) : [];
    for (const fila of filas) {
      const cols = Object.keys(fila);
      if (cols.length === 0) continue;
      const placeholders = cols.map(() => "?").join(",");
      stmts.push(
        c.env.DB.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${placeholders})`).bind(
          ...cols.map((k) => fila[k] as any)
        )
      );
    }
  }

  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
