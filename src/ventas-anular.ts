/**
 * La mecánica de anular una venta (devolver stock, liberar pagos imputados,
 * marcar estado) — compartida entre la ruta normal de anular
 * (src/routes/ventas.ts) y la emisión de Nota de Crédito
 * (src/routes/facturacion.ts), que la corre recién después de que ARCA
 * autoriza la NC. Arma los statements, no los ejecuta — el llamador decide
 * con qué más los agrupa en el mismo batch atómico.
 */
import type { Env, Venta, VentaItem } from "./types";
import { auditar } from "./auditoria";

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function armarAnulacionVenta(
  env: Env,
  negocioId: string,
  usuario: string,
  /** Visita de soporte, si la anulación la hace el proveedor dentro de la cuenta. */
  sesionSoporte: string | null,
  venta: Venta
): Promise<D1PreparedStatement[]> {
  const items = await env.DB.prepare(`SELECT * FROM venta_items WHERE negocio_id = ? AND venta_id = ?`)
    .bind(negocioId, venta.id)
    .all<VentaItem>();

  const fecha = hoy();
  const devolverPorH = new Map<string, number>();
  for (const it of items.results ?? []) {
    devolverPorH.set(it.herramienta_id, (devolverPorH.get(it.herramienta_id) ?? 0) + it.cantidad);
  }

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE ventas SET estado = 'anulada', necesita_revision = 0, motivo_revision = NULL
       WHERE negocio_id = ? AND id = ?`
    ).bind(negocioId, venta.id),
  ];

  for (const [hid, cant] of devolverPorH) {
    const h = await env.DB.prepare(`SELECT stock FROM herramientas WHERE negocio_id = ? AND id = ?`)
      .bind(negocioId, hid)
      .first<{ stock: number }>();
    const resultante = (h?.stock ?? 0) + cant;
    stmts.push(env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE negocio_id = ? AND id = ?`).bind(resultante, negocioId, hid));
    stmts.push(
      env.DB.prepare(
        `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, motivo)
         VALUES (?, ?, ?, 'anulacion', ?, ?, ?, 'Anulación de venta')`
      ).bind(negocioId, hid, fecha, cant, resultante, venta.id)
    );
  }

  stmts.push(env.DB.prepare(`UPDATE pagos SET venta_id = NULL WHERE negocio_id = ? AND venta_id = ?`).bind(negocioId, venta.id));
  stmts.push(
    auditar(
      env, negocioId, usuario, "anular_venta", "venta", venta.id,
      `Venta #${venta.numero} por $${(venta.total / 100).toFixed(2)}`,
      { anterior: { estado: venta.estado, total: venta.total }, nuevo: { estado: "anulada" } },
      sesionSoporte
    )
  );

  return stmts;
}
