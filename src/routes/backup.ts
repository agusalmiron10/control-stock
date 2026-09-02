/**
 * Respaldo de UN negocio: el ferretero se lleva sus datos cuando quiera.
 *
 * Dos caminos:
 *   - manual: baja un .json con todo lo suyo y lo puede volver a subir.
 *   - automático: el cron deja una copia diaria en R2 y acá se lista y se baja.
 *
 * En los dos casos el negocio sale de la sesión, nunca de lo que mande el
 * navegador: un cliente no puede pedir el respaldo de otro.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { HttpError } from "../validate";
import { requireDueno } from "../auth";
import { negocioDe } from "../types";
import { TABLAS_RESPALDO, NOMBRES_RESPALDO, filtrarColumnas } from "../tablas";

export const backup = new Hono<{ Bindings: Env; Variables: Variables }>();
backup.use("*", requireDueno);

/** Dónde vive en R2 la copia diaria de un negocio. */
export function rutaEnR2(negocioId: string, fecha: string): string {
  return `negocios/${negocioId}/${fecha}.json`;
}

/** Junta todos los datos de un negocio, sin los campos secretos. */
export async function armarRespaldo(env: Env, negocioId: string) {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLAS_RESPALDO) {
    const rows = await env.DB.prepare(`SELECT * FROM ${t.nombre} WHERE negocio_id = ?`).bind(negocioId).all();
    data[t.nombre] = (rows.results ?? []).map((f) => filtrarColumnas(f as Record<string, unknown>, t.omitir));
  }
  return {
    _meta: {
      app: "control-stock",
      version: 2,
      negocio_id: negocioId,
      exportado_en: new Date().toISOString(),
      tablas: NOMBRES_RESPALDO,
    },
    ...data,
  };
}

/** Descarga todos los datos del negocio como JSON. */
backup.get("/", async (c) => {
  return c.json(await armarRespaldo(c.env, negocioDe(c)));
});

// ── Copias automáticas ─────────────────────────────────────

/** Las copias diarias que el sistema guardó de este negocio. */
backup.get("/automaticos", async (c) => {
  const neg = negocioDe(c);
  if (!c.env.BACKUPS) return c.json({ copias: [], disponible: false });

  const listado = await c.env.BACKUPS.list({ prefix: `negocios/${neg}/` });
  const copias = listado.objects
    .map((o) => ({
      fecha: o.key.slice(o.key.lastIndexOf("/") + 1).replace(/\.json$/, ""),
      tamano: o.size,
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  return c.json({ copias, disponible: true });
});

/** Baja una copia puntual. */
backup.get("/automaticos/:fecha", async (c) => {
  const fecha = c.req.param("fecha");
  // Se valida a rajatabla: este texto arma una ruta, y algo como "../otro"
  // dejaría leer la carpeta de otro negocio.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new HttpError(400, "Fecha inválida.");
  if (!c.env.BACKUPS) throw new HttpError(404, "No hay copias automáticas configuradas.");

  const obj = await c.env.BACKUPS.get(rutaEnR2(negocioDe(c), fecha));
  if (!obj) throw new HttpError(404, "No hay una copia de esa fecha.");

  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="respaldo-${fecha}.json"`,
    },
  });
});

// ── Restaurar ──────────────────────────────────────────────

/** Restaura desde un JSON con la misma estructura. Reemplaza TODO lo del negocio. */
backup.post("/restore", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new HttpError(400, "El archivo de respaldo no es válido.");
  if ((body as any)._meta?.app !== "control-stock") {
    throw new HttpError(400, "El archivo no parece un respaldo de esta aplicación.");
  }

  const neg = negocioDe(c);
  const stmts: D1PreparedStatement[] = [];

  // Borrar al revés del orden de inserción, por las claves foráneas.
  for (const t of [...TABLAS_RESPALDO].reverse()) {
    stmts.push(c.env.DB.prepare(`DELETE FROM ${t.nombre} WHERE negocio_id = ?`).bind(neg));
  }

  for (const t of TABLAS_RESPALDO) {
    const crudas = Array.isArray((body as any)[t.nombre])
      ? ((body as any)[t.nombre] as Record<string, unknown>[])
      : [];
    // Las filas que se apuntan a sí mismas (una NC a su factura) van primero.
    const filas = t.primero ? [...crudas].sort((a, b) => Number(t.primero!(b)) - Number(t.primero!(a))) : crudas;

    for (const fila of filas) {
      // El negocio se fuerza al de la sesión: el respaldo de otro cliente no
      // puede escribir datos acá adentro.
      const datos: Record<string, unknown> = { ...filtrarColumnas(fila, t.omitir), negocio_id: neg };
      const cols = Object.keys(datos);
      if (cols.length === 0) continue;
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO ${t.nombre} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
        ).bind(...cols.map((k) => datos[k] as any))
      );
    }
  }

  await c.env.DB.batch(stmts);
  return c.json({ ok: true, tablas: NOMBRES_RESPALDO.length });
});
