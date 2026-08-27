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

/** Un resumen por negocio activo. */
async function guardarResumenDeAyer(env: Env, negocioId: string): Promise<void> {
  const fecha = ayer();
  const r = await calcularResumenDia(env, negocioId, fecha);
  await env.DB.prepare(
    `INSERT INTO resumenes_diarios
       (negocio_id, fecha, ventas_total, ventas_cant, cobranzas_total, cobranzas_cant, saldo_pendiente, clientes_con_deuda, stock_bajo_cant)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(negocio_id, fecha) DO UPDATE SET
       ventas_total=excluded.ventas_total, ventas_cant=excluded.ventas_cant,
       cobranzas_total=excluded.cobranzas_total, cobranzas_cant=excluded.cobranzas_cant,
       saldo_pendiente=excluded.saldo_pendiente, clientes_con_deuda=excluded.clientes_con_deuda,
       stock_bajo_cant=excluded.stock_bajo_cant, generado_en=datetime('now')`
  )
    .bind(
      negocioId,
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

/**
 * Suspende a los que se pasaron del vencimiento más los días de gracia.
 *
 * Es deliberadamente conservador: sólo toca negocios 'activo' (nunca los que
 * están en 'prueba', que todavía no compraron nada, ni los que ya están de
 * 'baja'), respeta la marca `sin_corte`, y no hace nada si el negocio nunca
 * tuvo una fecha de pago cargada — sin eso no se sabe si debe o si todavía no
 * le pusiste plan, y cortarle el sistema por las dudas sería lo peor.
 */
async function suspenderVencidos(env: Env): Promise<void> {
  const r = await env.DB
    .prepare(
      `UPDATE negocios
          SET estado = 'suspendido'
        WHERE estado = 'activo'
          AND sin_corte = 0
          AND paga_hasta IS NOT NULL
          AND julianday(date('now')) > julianday(paga_hasta) + dias_gracia`
    )
    .run();
  const cortados = r.meta?.changes ?? 0;
  if (cortados > 0) console.log(`Suspendidos por falta de pago: ${cortados}`);
}

export async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(
    (async () => {
      // El resumen diario es por negocio: uno por cada cliente activo.
      const negocios = await env.DB
        .prepare(`SELECT id FROM negocios WHERE estado IN ('prueba','activo')`)
        .all<{ id: string }>();
      for (const n of negocios.results ?? []) {
        // Que un negocio falle no debe frenar a los demás.
        await guardarResumenDeAyer(env, n.id).catch((e) =>
          console.error(`No se pudo calcular el resumen de ${n.id}:`, e)
        );
      }
      // Que falle el corte no debe impedir el backup, ni al revés.
      await suspenderVencidos(env).catch((e) => console.error("No se pudo revisar vencimientos:", e));
      await backupAR2(env);
    })()
  );
}
