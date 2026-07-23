/**
 * Cron Trigger diario (ver wrangler.jsonc → triggers.crons).
 * 1) Calcula el resumen del día anterior y lo guarda en resumenes_diarios
 *    (lo lee el Panel para mostrar la tarjeta "Resumen de ayer").
 * 2) Sube un backup completo de la base a R2, con retención de 30 días.
 */
import type { Env } from "./types";
import { calcularResumenDia } from "./routes/reportes";

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
] as const;

const RETENCION_DIAS = 30;

function ayer(): string {
  const d = new Date(Date.now() - 86400000);
  return d.toISOString().slice(0, 10);
}

async function guardarResumenDeAyer(env: Env): Promise<void> {
  const fecha = ayer();
  const r = await calcularResumenDia(env, fecha);
  await env.DB.prepare(
    `INSERT INTO resumenes_diarios
       (fecha, ventas_total, ventas_cant, cobranzas_total, cobranzas_cant, saldo_pendiente, clientes_con_deuda, stock_bajo_cant)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fecha) DO UPDATE SET
       ventas_total=excluded.ventas_total, ventas_cant=excluded.ventas_cant,
       cobranzas_total=excluded.cobranzas_total, cobranzas_cant=excluded.cobranzas_cant,
       saldo_pendiente=excluded.saldo_pendiente, clientes_con_deuda=excluded.clientes_con_deuda,
       stock_bajo_cant=excluded.stock_bajo_cant, generado_en=datetime('now')`
  )
    .bind(
      r.fecha,
      r.ventas_total,
      r.ventas_cant,
      r.cobranzas_total,
      r.cobranzas_cant,
      r.saldo_pendiente,
      r.clientes_con_deuda,
      r.stock_bajo_cant
    )
    .run();
}

async function backupAR2(env: Env): Promise<void> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLAS) {
    const rows = await env.DB.prepare(`SELECT * FROM ${t}`).all();
    data[t] = rows.results ?? [];
  }
  const hoy = new Date().toISOString().slice(0, 10);
  const dump = { _meta: { app: "control-stock", version: 1, exportado_en: new Date().toISOString() }, ...data };
  await env.BACKUPS.put(`backup-${hoy}.json`, JSON.stringify(dump), {
    httpMetadata: { contentType: "application/json" },
  });

  // Retención: borra backups de más de RETENCION_DIAS días.
  const limite = new Date(Date.now() - RETENCION_DIAS * 86400000).toISOString().slice(0, 10);
  const listado = await env.BACKUPS.list({ prefix: "backup-" });
  for (const obj of listado.objects) {
    const m = /^backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(obj.key);
    if (m && m[1] < limite) await env.BACKUPS.delete(obj.key);
  }
}

export async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
    (async () => {
      await guardarResumenDeAyer(env);
      await backupAR2(env);
    })()
  );
}
