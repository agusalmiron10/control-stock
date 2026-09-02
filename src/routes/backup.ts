/**
 * Respaldo de UN negocio: el ferretero se lleva sus datos cuando quiera.
 *
 * El ferretero baja un .json con todo lo suyo cuando quiere, y lo puede
 * volver a subir. No se le guarda nada: se arma en el momento y se descarga.
 *
 * Las copias diarias que deja el cron en R2 NO se listan acá. Las administra
 * el proveedor desde su panel (src/routes/super.ts), que es quien las tiene
 * que conservar y entregar si un cliente las necesita.
 *
 * El negocio sale siempre de la sesión, nunca de lo que mande el navegador:
 * un cliente no puede pedir el respaldo de otro.
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

export const RETENCION_DIAS = 30;

/**
 * Una copia por negocio en R2: negocios/<id>/<fecha>.json
 *
 * Devuelve cuántas salieron bien, porque si una falla las demás tienen que
 * guardarse igual — es lo último que uno quiere descubrir el día que hace
 * falta restaurar.
 */
export async function guardarCopias(env: Env, negocios: string[]): Promise<{ ok: number; fallaron: number }> {
  if (!env.BACKUPS) {
    console.error("No hay bucket de backups configurado: no se guardó ninguna copia.");
    return { ok: 0, fallaron: negocios.length };
  }
  const hoy = new Date().toISOString().slice(0, 10);
  let ok = 0;
  let fallaron = 0;

  for (const id of negocios) {
    try {
      const dump = await armarRespaldo(env, id);
      await env.BACKUPS.put(rutaEnR2(id, hoy), JSON.stringify(dump), {
        httpMetadata: { contentType: "application/json" },
      });
      ok++;
    } catch (e) {
      fallaron++;
      console.error(`No se pudo respaldar el negocio ${id}:`, e);
    }
  }

  await limpiarViejas(env);
  return { ok, fallaron };
}

/** Retención: se borran las copias de más de RETENCION_DIAS días. */
async function limpiarViejas(env: Env): Promise<void> {
  const limite = new Date(Date.now() - RETENCION_DIAS * 86400000).toISOString().slice(0, 10);
  // R2 pagina: hay que seguir el cursor o quedan copias viejas sin borrar
  // acumulándose para siempre.
  let cursor: string | undefined;
  do {
    const listado = await env.BACKUPS.list({ prefix: "negocios/", cursor });
    for (const obj of listado.objects) {
      const m = /\/(\d{4}-\d{2}-\d{2})\.json$/.exec(obj.key);
      if (m && m[1] < limite) await env.BACKUPS.delete(obj.key);
    }
    cursor = listado.truncated ? listado.cursor : undefined;
  } while (cursor);

  // Barrido de los backups viejos del esquema anterior (un archivo global por
  // día). Ya no se generan; esto los va limpiando.
  const viejos = await env.BACKUPS.list({ prefix: "backup-" });
  for (const obj of viejos.objects) {
    const m = /^backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(obj.key);
    if (m && m[1] < limite) await env.BACKUPS.delete(obj.key);
  }
}

/** Descarga todos los datos del negocio como JSON. */
backup.get("/", async (c) => {
  return c.json(await armarRespaldo(c.env, negocioDe(c)));
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
  const restaurables = TABLAS_RESPALDO.filter((t) => !t.soloExportar);
  for (const t of [...restaurables].reverse()) {
    stmts.push(c.env.DB.prepare(`DELETE FROM ${t.nombre} WHERE negocio_id = ?`).bind(neg));
  }

  for (const t of restaurables) {
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
  return c.json({ ok: true, tablas: restaurables.length });
});
