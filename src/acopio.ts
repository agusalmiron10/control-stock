/**
 * Lo compartido entre ventas.ts (vender reteniendo stock) y remitos.ts
 * (retirar de a poco lo acopiado): cuánto de cada producto está comprado en
 * acopio y todavía no se retiró. Ese número es lo que separa el stock
 * FÍSICO (herramientas.stock) del DISPONIBLE para seguir vendiendo.
 */
import type { Env } from "./types";

/**
 * Mapa herramienta_id → cantidad pendiente de retirar, sumada across todas
 * las ventas de acopio activas del negocio (o sólo las de `herramientaIds`
 * si se pasa, para no traer más de lo que hace falta).
 *
 * "Pendiente" ya excluye lo anulado en ambos lados: ventas anuladas no
 * cuentan como comprometidas, y remitos anulados no cuentan como retirados.
 */
export async function acopioPendientePorHerramienta(
  env: Env,
  neg: string,
  herramientaIds?: string[]
): Promise<Map<string, number>> {
  const ids = herramientaIds ?? [];
  const filtro = ids.length > 0 ? `AND vi.herramienta_id IN (${ids.map(() => "?").join(",")})` : "";

  const filas = await env.DB.prepare(
    `SELECT vi.herramienta_id,
            SUM(vi.cantidad) - COALESCE((
              SELECT SUM(ri.cantidad) FROM remito_items ri
              JOIN remitos r ON r.id = ri.remito_id AND r.negocio_id = ri.negocio_id
              WHERE r.negocio_id = vi.negocio_id AND r.venta_id = vi.venta_id
                AND r.estado != 'anulado' AND ri.herramienta_id = vi.herramienta_id
            ), 0) AS pendiente
       FROM venta_items vi
       JOIN ventas v ON v.id = vi.venta_id AND v.negocio_id = vi.negocio_id
      WHERE vi.negocio_id = ? AND v.es_acopio = 1 AND v.estado != 'anulada' ${filtro}
      GROUP BY vi.venta_id, vi.herramienta_id`
  )
    .bind(neg, ...ids)
    .all<{ herramienta_id: string; pendiente: number }>();

  // Una misma herramienta puede aparecer en varias ventas de acopio
  // distintas: se suma cada grupo (venta, herramienta) en el mapa final.
  const mapa = new Map<string, number>();
  for (const f of filas.results ?? []) {
    if (f.pendiente > 0) mapa.set(f.herramienta_id, (mapa.get(f.herramienta_id) ?? 0) + f.pendiente);
  }
  return mapa;
}
