/**
 * Dos Cron Triggers (ver wrangler.jsonc → triggers.crons), que caen en la
 * misma función — `event.cron` dice cuál disparó:
 *
 *   "0 5 * * *"    una vez por día. Acá vive todo lo de siempre:
 *     1) Calcula el resumen del día anterior y lo guarda en
 *        resumenes_diarios (lo lee el Panel para "Resumen de ayer").
 *     2) Deja en R2 una copia de los datos DE CADA NEGOCIO, con retención de
 *        30 días. Una copia por ferretería y no un archivo con todo junto:
 *        así cada una se puede bajar o restaurar sola, sin tocar a las
 *        demás, y sin que nadie tenga que abrir un archivo con datos de
 *        todos para recuperar los de uno.
 *
 *   cada media hora (ver CRON_HUERFANOS más abajo). Sólo resuelve comprobantes huérfanos
 *     (ver resolverHuerfanosDeTodos) — es lo único de acá que de verdad se
 *     beneficia de correr seguido: un huérfano deja bloqueada la venta hasta
 *     que se resuelve, así que esperar hasta el cron diario sería dejar a
 *     alguien sin poder facturar de nuevo por hasta 24hs por un corte de red.
 */
import type { Env, FacturacionConfig } from "./types";
import { calcularResumenDia } from "./routes/reportes";
import { guardarCopias } from "./routes/backup";
import { leerConfig } from "./config";
import { resolverHuerfanosDeNegocio } from "./routes/facturacion";
import { auditar } from "./auditoria";

const CRON_HUERFANOS = "*/30 * * * *";

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

/** No hace falta guardar errores para siempre — con 30 días alcanza para ver un patrón. */
async function limpiarErroresViejos(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM errores_sistema WHERE creado_en < datetime('now', '-30 days')`).run();
}

// ── Correo diario de stock bajo y vencimientos próximos ────────────────────
//
// Antes esto sólo se veía si alguien entraba al Panel a mirarlo. Ahora,
// además, le llega un resumen por correo al dueño de cada negocio que tenga
// algo para avisar.
//
// La parte que importa para el rendimiento: en vez de una consulta por
// negocio (que con muchos tenants multiplica la lectura de filas en D1sin
// necesidad), se trae TODO de una sola vez —ya acotado a los negocios
// activos, en tandas de a lo sumo LOTE_IDS por el límite de parámetros de un
// IN (...)— y se agrupa en memoria. Con 5 negocios o con 500, siguen siendo
// sólo un puñado de consultas, no una por cada uno.

const LOTE_IDS = 50;

interface FilaStockBajo {
  negocio_id: string; id: string; codigo: string; nombre: string; stock: number; stock_minimo: number;
}
interface FilaVencimiento {
  negocio_id: string; id: string; codigo: string; nombre: string; vence_el: string; dias: number;
}

/** Corre `armarSql(placeholders)` en tandas, para no pasarse del límite de bind params de un solo IN (...). */
async function traerPorLotesDeIds<T>(
  env: Env,
  ids: string[],
  armarSql: (placeholders: string) => string
): Promise<T[]> {
  const salida: T[] = [];
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const tanda = ids.slice(i, i + LOTE_IDS);
    const placeholders = tanda.map(() => "?").join(",");
    const r = await env.DB.prepare(armarSql(placeholders)).bind(...tanda).all<T>();
    salida.push(...(r.results ?? []));
  }
  return salida;
}

function agruparPorNegocio<T extends { negocio_id: string }>(filas: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const arr = m.get(f.negocio_id);
    if (arr) arr.push(f);
    else m.set(f.negocio_id, [f]);
  }
  return m;
}

function filaHtml(cols: (string | number)[]): string {
  return `<tr>${cols.map((v, i) => `<td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;${i === cols.length - 1 ? "text-align:right" : ""}">${v}</td>`).join("")}</tr>`;
}

async function enviarResumenPorEmail(
  env: Env,
  negocio: { id: string; nombre: string; email: string },
  stock: FilaStockBajo[],
  venc: FilaVencimiento[]
): Promise<void> {
  const MAX_FILAS = 30;
  const bloqueStock =
    stock.length === 0
      ? ""
      : `<h2 style="font:600 16px system-ui">Stock bajo (${stock.length})</h2>
         <table style="border-collapse:collapse;width:100%;font:14px system-ui">
           <tr><th align="left">Código</th><th align="left">Producto</th><th align="right">Stock / mínimo</th></tr>
           ${stock.slice(0, MAX_FILAS).map((h) => filaHtml([h.codigo, h.nombre, `${h.stock} / ${h.stock_minimo}`])).join("")}
         </table>
         ${stock.length > MAX_FILAS ? `<p>…y ${stock.length - MAX_FILAS} más.</p>` : ""}`;
  const bloqueVenc =
    venc.length === 0
      ? ""
      : `<h2 style="font:600 16px system-ui">Vencen pronto (${venc.length})</h2>
         <table style="border-collapse:collapse;width:100%;font:14px system-ui">
           <tr><th align="left">Código</th><th align="left">Producto</th><th align="right">Vence</th></tr>
           ${venc.slice(0, MAX_FILAS).map((h) => filaHtml([h.codigo, h.nombre, h.dias <= 0 ? `${h.vence_el} (vencido)` : `${h.vence_el} (en ${h.dias} días)`])).join("")}
         </table>
         ${venc.length > MAX_FILAS ? `<p>…y ${venc.length - MAX_FILAS} más.</p>` : ""}`;

  const asunto = [
    stock.length > 0 ? `${stock.length} con stock bajo` : "",
    venc.length > 0 ? `${venc.length} por vencer` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM ?? "ChauPapel <avisos@chaupapel.com>",
      to: negocio.email,
      subject: `ChauPapel — ${asunto}`,
      html: `<p style="font:14px system-ui">Resumen de hoy para <b>${negocio.nombre}</b>:</p>${bloqueStock}${bloqueVenc}`,
    }),
  });
  if (!res.ok) {
    console.error(`Resend devolvió ${res.status} para el negocio ${negocio.id}: ${await res.text().catch(() => "")}`);
  }
}

/** Junta stock bajo y próximos vencimientos de todos los negocios activos y le manda el resumen por correo a cada dueño que tenga algo para avisar. */
async function avisarStockYVencimientos(env: Env, ids: string[]): Promise<void> {
  if (ids.length === 0 || !env.RESEND_API_KEY) return;

  const [stockBajo, vencimientos, negociosRows] = await Promise.all([
    traerPorLotesDeIds<FilaStockBajo>(env, ids, (ph) =>
      `SELECT negocio_id, id, codigo, nombre, stock, stock_minimo
         FROM herramientas
        WHERE negocio_id IN (${ph}) AND activo = 1 AND stock <= stock_minimo
        ORDER BY negocio_id, stock ASC`
    ),
    // Se trae con margen (30 días) y se recorta por negocio más abajo, porque
    // el umbral real (alerta_dias_antes_vencer) es una capacidad por negocio.
    traerPorLotesDeIds<FilaVencimiento>(env, ids, (ph) =>
      `SELECT negocio_id, id, codigo, nombre, vence_el,
              CAST(julianday(vence_el) - julianday(date('now')) AS INTEGER) AS dias
         FROM herramientas
        WHERE negocio_id IN (${ph}) AND activo = 1 AND vence_el IS NOT NULL
              AND vence_el <= date('now', '+30 days')
        ORDER BY negocio_id, vence_el`
    ),
    traerPorLotesDeIds<{ id: string; nombre: string; email: string | null }>(env, ids, (ph) =>
      `SELECT id, nombre, email FROM negocios WHERE id IN (${ph})`
    ),
  ]);

  const porNegocioStock = agruparPorNegocio(stockBajo);
  const porNegocioVenc = agruparPorNegocio(vencimientos);
  const negociosMap = new Map(negociosRows.map((n) => [n.id, n]));

  for (const id of ids) {
    const negocio = negociosMap.get(id);
    if (!negocio?.email) continue; // sin correo cargado, no hay a quién avisarle

    const stock = porNegocioStock.get(id) ?? [];
    let venc = porNegocioVenc.get(id) ?? [];

    if (venc.length > 0) {
      // permite_vencimientos y el umbral de días son una capacidad por
      // negocio (rubro + override) — se resuelve sólo para los que
      // realmente tienen algo por vencer, no para los 30 días de todos.
      const cfg = await leerConfig(env, id).catch(() => null);
      venc = cfg?.capacidades.permite_vencimientos
        ? venc.filter((v) => v.dias <= cfg.capacidades.alerta_dias_antes_vencer)
        : [];
    }

    if (stock.length === 0 && venc.length === 0) continue;

    await enviarResumenPorEmail(env, { id: negocio.id, nombre: negocio.nombre, email: negocio.email }, stock, venc).catch((e) =>
      console.error(`No se pudo mandar el resumen de stock/vencimientos a ${id}:`, e)
    );
  }
}

/**
 * Junta los negocios con al menos un comprobante huérfano y le pregunta a
 * ARCA por cada uno (ver resolverHuerfanosDeNegocio, en la ruta de
 * facturación — es la misma función que usa "Verificar con ARCA" a mano).
 * Que un negocio falle (sin conexión, delegación caída) no frena a los
 * demás: cada uno se resuelve solo.
 */
async function resolverHuerfanosDeTodos(env: Env): Promise<void> {
  const negocios = await env.DB
    .prepare(`SELECT DISTINCT negocio_id AS id FROM facturas WHERE estado = 'huerfano'`)
    .all<{ id: string }>();
  const ids = (negocios.results ?? []).map((n) => n.id);
  if (ids.length === 0) return;

  for (const negocioId of ids) {
    try {
      const cfg = await env.DB
        .prepare(`SELECT * FROM facturacion_config WHERE negocio_id = ?`)
        .bind(negocioId)
        .first<FacturacionConfig>();
      // No debería pasar (no se puede haber emitido nada sin esto), pero por
      // las dudas: sin CUIT no hay con qué autenticarse.
      if (!cfg?.cuit) continue;

      const resultados = await resolverHuerfanosDeNegocio(env, negocioId, cfg);
      const autorizados = resultados.filter((r) => r.resultado === "autorizada");
      if (autorizados.length > 0) {
        await env.DB.batch(
          autorizados.map((r) =>
            auditar(env, negocioId, "cron", "recuperar_factura", "factura", r.id,
              `La factura ${r.puntoVenta}-${r.numero} sí estaba autorizada en ARCA · CAE ${r.cae} (verificado automático)`)
          )
        );
      }
      if (resultados.length > 0) {
        console.log(
          `Huérfanos de ${negocioId}: ${resultados.length} revisados, ${autorizados.length} recuperados, ${resultados.length - autorizados.length} liberados.`
        );
      }
    } catch (e) {
      // Un negocio sin conexión a ARCA ahora no pierde nada: sigue
      // huérfano y se reintenta solo en la próxima pasada, media hora después.
      console.error(`No se pudieron revisar los huérfanos de ${negocioId}:`, e);
    }
  }
}

export async function scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  if (event.cron === CRON_HUERFANOS) {
    ctx.waitUntil(resolverHuerfanosDeTodos(env));
    return;
  }

  ctx.waitUntil(
    (async () => {
      // El resumen diario es por negocio: uno por cada cliente activo.
      const negocios = await env.DB
        .prepare(`SELECT id FROM negocios WHERE estado IN ('prueba','activo')`)
        .all<{ id: string }>();
      const ids = (negocios.results ?? []).map((n) => n.id);
      for (const n of negocios.results ?? []) {
        // Que un negocio falle no debe frenar a los demás.
        await guardarResumenDeAyer(env, n.id).catch((e) =>
          console.error(`No se pudo calcular el resumen de ${n.id}:`, e)
        );
      }
      // Que falle el corte no debe impedir el backup, ni al revés.
      await suspenderVencidos(env).catch((e) => console.error("No se pudo revisar vencimientos:", e));
      await limpiarErroresViejos(env).catch((e) => console.error("No se pudo limpiar errores viejos:", e));
      await avisarStockYVencimientos(env, ids).catch((e) => console.error("No se pudo mandar los avisos de stock/vencimientos:", e));

      const r = await guardarCopias(env, ids);
      console.log(`Copias guardadas: ${r.ok} de ${ids.length}` + (r.fallaron ? ` (${r.fallaron} fallaron)` : ""));
    })()
  );
}
