import { Hono } from "hono";
import type { Env, Variables, Cliente, Venta, Herramienta } from "../types";
import { estadoDeCuentaTodos } from "../cuenta";

export const reportes = new Hono<{ Bindings: Env; Variables: Variables }>();

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function diasEntre(desde: string, hasta: string): number {
  const ms = Date.parse(hasta + "T00:00:00Z") - Date.parse(desde + "T00:00:00Z");
  return Math.max(0, Math.floor(ms / 86400000));
}
function tramoDe(dias: number): string {
  if (dias <= 30) return "0-30";
  if (dias <= 60) return "31-60";
  if (dias <= 90) return "61-90";
  return "+90";
}

/**
 * Cobranzas: clientes que deben, ordenados por antigüedad de la deuda más vieja.
 * La "deuda más vieja" es la venta impaga/parcial más antigua (según imputación FIFO).
 */
reportes.get("/cobranzas", async (c) => {
  const cuentas = await estadoDeCuentaTodos(c.env);

  const clientesRows = await c.env.DB.prepare(
    `SELECT id, nombre, telefono, localidad FROM clientes WHERE activo = 1`
  ).all<Pick<Cliente, "id" | "nombre" | "telefono" | "localidad">>();
  const clientesMap = new Map((clientesRows.results ?? []).map((cl) => [cl.id, cl]));

  const ventasRows = await c.env.DB.prepare(
    `SELECT id, cliente_id, fecha, numero FROM ventas WHERE anulada = 0 ORDER BY fecha ASC, numero ASC`
  ).all<Pick<Venta, "id" | "cliente_id" | "fecha" | "numero">>();

  const ventasPorCliente = new Map<number, typeof ventasRows.results>();
  for (const v of ventasRows.results ?? []) {
    const arr = ventasPorCliente.get(v.cliente_id) ?? [];
    arr!.push(v);
    ventasPorCliente.set(v.cliente_id, arr);
  }

  const hoy = hoyISO();
  const tramos = { "0-30": 0, "31-60": 0, "61-90": 0, "+90": 0 } as Record<string, number>;
  const lista: any[] = [];

  for (const [cid, cta] of cuentas) {
    if (cta.saldoCliente <= 0 || !clientesMap.has(cid)) continue;
    const cl = clientesMap.get(cid)!;

    // Venta impaga/parcial más vieja (ya vienen ordenadas por fecha).
    let deudaDesde: string | null = null;
    for (const v of ventasPorCliente.get(cid) ?? []) {
      const r = cta.porVenta.get(v.id);
      if (r && r.saldo > 0) { deudaDesde = v.fecha; break; }
    }
    const dias = deudaDesde ? diasEntre(deudaDesde, hoy) : 0;
    const tramo = tramoDe(dias);
    tramos[tramo] += cta.saldoCliente;

    lista.push({
      cliente_id: cid,
      nombre: cl.nombre,
      telefono: cl.telefono,
      localidad: cl.localidad,
      saldo: cta.saldoCliente,
      deuda_desde: deudaDesde,
      dias,
      tramo,
    });
  }

  lista.sort((a, b) => b.dias - a.dias || b.saldo - a.saldo);
  const total = lista.reduce((acc, x) => acc + x.saldo, 0);

  return c.json({ total_a_cobrar: total, cantidad: lista.length, tramos, clientes: lista });
});

/**
 * Rentabilidad: margen y ganancia estimada por producto (usa el costo ACTUAL).
 * Filtro opcional por rango de fechas de venta.
 */
reportes.get("/rentabilidad", async (c) => {
  const desde = c.req.query("desde") || undefined;
  const hasta = c.req.query("hasta") || undefined;

  const cond: string[] = ["v.anulada = 0"];
  const args: string[] = [];
  if (desde) { cond.push("v.fecha >= ?"); args.push(desde); }
  if (hasta) { cond.push("v.fecha <= ?"); args.push(hasta); }

  const vendidas = await c.env.DB.prepare(
    `SELECT vi.herramienta_id AS hid, SUM(vi.cantidad) AS unidades, SUM(vi.subtotal) AS vendido
     FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
     WHERE ${cond.join(" AND ")} GROUP BY vi.herramienta_id`
  ).bind(...args).all<{ hid: number; unidades: number; vendido: number }>();
  const vmap = new Map((vendidas.results ?? []).map((r) => [r.hid, r]));

  const herr = await c.env.DB.prepare(`SELECT * FROM herramientas`).all<Herramienta>();

  const porProducto = (herr.results ?? []).map((h) => {
    const v = vmap.get(h.id);
    const unidades = v?.unidades ?? 0;
    const vendido = v?.vendido ?? 0;
    const costoEstimado = unidades * h.costo;
    const ganancia = vendido - costoEstimado;
    const margen = vendido > 0 ? Math.round((ganancia / vendido) * 1000) / 10 : 0;
    return {
      id: h.id, codigo: h.codigo, nombre: h.nombre, rubro: h.rubro ?? "",
      costo: h.costo, precio: h.precio, stock: h.stock,
      unidades_vendidas: unidades, vendido, costo_estimado: costoEstimado,
      ganancia, margen_pct: margen,
      valor_stock_costo: h.stock * h.costo, valor_stock_venta: h.stock * h.precio,
    };
  });

  const totalVendido = porProducto.reduce((a, p) => a + p.vendido, 0);
  const totalCosto = porProducto.reduce((a, p) => a + p.costo_estimado, 0);
  const ganancia = totalVendido - totalCosto;
  const valorStockCosto = porProducto.reduce((a, p) => a + p.valor_stock_costo, 0);
  const valorStockVenta = porProducto.reduce((a, p) => a + p.valor_stock_venta, 0);

  porProducto.sort((a, b) => b.ganancia - a.ganancia);

  return c.json({
    resumen: {
      total_vendido: totalVendido,
      costo_estimado: totalCosto,
      ganancia_estimada: ganancia,
      margen_pct: totalVendido > 0 ? Math.round((ganancia / totalVendido) * 1000) / 10 : 0,
      valor_stock_costo: valorStockCosto,
      valor_stock_venta: valorStockVenta,
      desde: desde ?? null, hasta: hasta ?? null,
    },
    productos: porProducto,
  });
});
