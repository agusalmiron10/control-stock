import { Hono } from "hono";
import type { Env, Variables, Cliente, Venta, VentaItem, Pago, Herramienta, MovimientoStock, PrecioHistorial } from "../types";
import { HttpError } from "../validate";
import { estadoDeCuenta, estadoDeCuentaTodos } from "../cuenta";

export const exportar = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Aplica filtro de fechas opcional a una columna. */
function rango(col: string, desde?: string, hasta?: string): { sql: string; args: string[] } {
  const cond: string[] = [];
  const args: string[] = [];
  if (desde) { cond.push(`${col} >= ?`); args.push(desde); }
  if (hasta) { cond.push(`${col} <= ?`); args.push(hasta); }
  return { sql: cond.length ? ` AND ${cond.join(" AND ")}` : "", args };
}

/** Datos para el Excel de un cliente. Todo en centavos (el front formatea). */
exportar.get("/cliente/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const cliente = await c.env.DB.prepare(`SELECT * FROM clientes WHERE id = ?`).bind(id).first<Cliente>();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado.");

  const cta = await estadoDeCuenta(c.env, id);

  const ventasRows = await c.env.DB.prepare(
    `SELECT * FROM ventas WHERE cliente_id = ? ORDER BY fecha, numero`
  ).bind(id).all<Venta>();
  const ventas = (ventasRows.results ?? []).map((v) => {
    const r = cta.porVenta.get(v.id);
    return {
      fecha: v.fecha, numero: v.numero, total: v.total,
      pagado: v.anulada ? 0 : r?.pagado ?? 0,
      saldo: v.anulada ? 0 : r?.saldo ?? v.total,
      estado: v.anulada ? "anulada" : r?.estado ?? "impaga",
      nota: v.nota ?? "",
    };
  });

  const detalleRows = await c.env.DB.prepare(
    `SELECT vi.*, v.fecha, v.numero FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id
     WHERE v.cliente_id = ? AND v.anulada = 0 ORDER BY v.fecha, v.numero, vi.id`
  ).bind(id).all<VentaItem & { fecha: string; numero: number }>();

  const pagosRows = await c.env.DB.prepare(
    `SELECT p.*, v.numero AS venta_numero FROM pagos p
     LEFT JOIN ventas v ON v.id = p.venta_id
     WHERE p.cliente_id = ? ORDER BY p.fecha, p.id`
  ).bind(id).all<Pago & { venta_numero: number | null }>();

  const ultimaCompra = ventas.filter((v) => v.estado !== "anulada").at(-1)?.fecha ?? null;
  const ultimoPago = (pagosRows.results ?? []).at(-1)?.fecha ?? null;

  return c.json({
    cliente,
    resumen: {
      total_comprado: cta.totalVentas,
      total_pagado: cta.totalPagado,
      saldo: cta.saldoCliente,
      saldo_a_favor: cta.saldoAFavor,
      ultima_compra: ultimaCompra,
      ultimo_pago: ultimoPago,
    },
    ventas,
    detalle: (detalleRows.results ?? []).map((d) => ({
      fecha: d.fecha, venta: d.numero, herramienta: d.nombre_herramienta,
      cantidad: d.cantidad, precio_unitario: d.precio_unitario, subtotal: d.subtotal,
    })),
    pagos: (pagosRows.results ?? []).map((p) => ({
      fecha: p.fecha, monto: p.monto, medio: p.medio,
      aplicado_a: p.venta_numero ? `Venta #${p.venta_numero}` : "A cuenta", nota: p.nota ?? "",
    })),
  });
});

/** Datos para el Excel general del negocio. */
exportar.get("/general", async (c) => {
  const desde = c.req.query("desde") || undefined;
  const hasta = c.req.query("hasta") || undefined;

  const clientesRows = await c.env.DB.prepare(`SELECT * FROM clientes ORDER BY nombre COLLATE NOCASE`).all<Cliente>();
  const cuentas = await estadoDeCuentaTodos(c.env);

  // Última compra / último pago por cliente.
  const ultimaCompra = await c.env.DB.prepare(
    `SELECT cliente_id, MAX(fecha) AS f FROM ventas WHERE anulada = 0 GROUP BY cliente_id`
  ).all<{ cliente_id: number; f: string }>();
  const ultimoPago = await c.env.DB.prepare(
    `SELECT cliente_id, MAX(fecha) AS f FROM pagos GROUP BY cliente_id`
  ).all<{ cliente_id: number; f: string }>();
  const ucMap = new Map((ultimaCompra.results ?? []).map((r) => [r.cliente_id, r.f]));
  const upMap = new Map((ultimoPago.results ?? []).map((r) => [r.cliente_id, r.f]));
  const cantVentas = await c.env.DB.prepare(
    `SELECT cliente_id, COUNT(*) AS n FROM ventas WHERE anulada = 0 GROUP BY cliente_id`
  ).all<{ cliente_id: number; n: number }>();
  const cvMap = new Map((cantVentas.results ?? []).map((r) => [r.cliente_id, r.n]));

  const clientes = (clientesRows.results ?? []).map((cl) => {
    const cta = cuentas.get(cl.id);
    return {
      nombre: cl.nombre, localidad: cl.localidad ?? "", telefono: cl.telefono ?? "",
      total_comprado: cta?.totalVentas ?? 0, total_pagado: cta?.totalPagado ?? 0,
      debe: Math.max(0, cta?.saldoCliente ?? 0), saldo_a_favor: cta?.saldoAFavor ?? 0,
      cantidad_ventas: cvMap.get(cl.id) ?? 0,
      ultima_compra: ucMap.get(cl.id) ?? null, ultimo_pago: upMap.get(cl.id) ?? null,
      activo: cl.activo ? "sí" : "archivado",
    };
  });

  const rv = rango("v.fecha", desde, hasta);
  const ventasRows = await c.env.DB.prepare(
    `SELECT v.*, cl.nombre AS cliente_nombre FROM ventas v JOIN clientes cl ON cl.id = v.cliente_id
     WHERE 1=1${rv.sql} ORDER BY v.fecha, v.numero`
  ).bind(...rv.args).all<Venta & { cliente_nombre: string }>();

  // Estado por venta (imputación por cliente).
  const ventas = (ventasRows.results ?? []).map((v) => {
    const r = cuentas.get(v.cliente_id)?.porVenta.get(v.id);
    return {
      fecha: v.fecha, numero: v.numero, cliente: v.cliente_nombre,
      subtotal: v.subtotal, descuento: v.descuento, total: v.total,
      pagado: v.anulada ? 0 : r?.pagado ?? 0, saldo: v.anulada ? 0 : r?.saldo ?? v.total,
      estado: v.anulada ? "anulada" : r?.estado ?? "impaga", nota: v.nota ?? "",
    };
  });

  const rd = rango("v.fecha", desde, hasta);
  const detalleRows = await c.env.DB.prepare(
    `SELECT vi.*, v.fecha, v.numero, cl.nombre AS cliente_nombre FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id JOIN clientes cl ON cl.id = v.cliente_id
     WHERE v.anulada = 0${rd.sql} ORDER BY v.fecha, v.numero, vi.id`
  ).bind(...rd.args).all<VentaItem & { fecha: string; numero: number; cliente_nombre: string }>();

  const rp = rango("p.fecha", desde, hasta);
  const pagosRows = await c.env.DB.prepare(
    `SELECT p.*, cl.nombre AS cliente_nombre, v.numero AS venta_numero FROM pagos p
     JOIN clientes cl ON cl.id = p.cliente_id LEFT JOIN ventas v ON v.id = p.venta_id
     WHERE 1=1${rp.sql} ORDER BY p.fecha, p.id`
  ).bind(...rp.args).all<Pago & { cliente_nombre: string; venta_numero: number | null }>();

  const herrRows = await c.env.DB.prepare(`SELECT * FROM herramientas ORDER BY codigo`).all<Herramienta>();
  const vendidas = await c.env.DB.prepare(
    `SELECT vi.herramienta_id AS hid, SUM(vi.cantidad) AS u FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id WHERE v.anulada = 0 GROUP BY vi.herramienta_id`
  ).all<{ hid: number; u: number }>();
  const vendMap = new Map((vendidas.results ?? []).map((r) => [r.hid, r.u]));

  const rm = rango("m.fecha", desde, hasta);
  const movRows = await c.env.DB.prepare(
    `SELECT m.*, h.nombre AS herramienta_nombre FROM movimientos_stock m
     JOIN herramientas h ON h.id = m.herramienta_id WHERE 1=1${rm.sql} ORDER BY m.fecha, m.id`
  ).bind(...rm.args).all<MovimientoStock & { herramienta_nombre: string }>();

  // Resumen del negocio.
  let totalDeuda = 0, totalFavor = 0, totalComprado = 0, totalPagado = 0;
  for (const cta of cuentas.values()) {
    if (cta.saldoCliente > 0) totalDeuda += cta.saldoCliente;
    totalFavor += cta.saldoAFavor;
    totalComprado += cta.totalVentas;
    totalPagado += cta.totalPagado;
  }
  const valorStock = (herrRows.results ?? []).reduce((a, h) => a + h.stock * h.costo, 0);

  return c.json({
    resumen: {
      total_a_cobrar: totalDeuda, saldo_a_favor_total: totalFavor,
      total_comprado: totalComprado, total_pagado: totalPagado,
      clientes: (clientesRows.results ?? []).length,
      herramientas: (herrRows.results ?? []).length,
      valor_stock_costo: valorStock,
      desde: desde ?? null, hasta: hasta ?? null,
    },
    clientes,
    ventas,
    detalle: (detalleRows.results ?? []).map((d) => ({
      fecha: d.fecha, venta: d.numero, cliente: d.cliente_nombre, herramienta: d.nombre_herramienta,
      cantidad: d.cantidad, precio_unitario: d.precio_unitario, subtotal: d.subtotal,
    })),
    pagos: (pagosRows.results ?? []).map((p) => ({
      fecha: p.fecha, cliente: p.cliente_nombre, monto: p.monto, medio: p.medio,
      aplicado_a: p.venta_numero ? `Venta #${p.venta_numero}` : "A cuenta", nota: p.nota ?? "",
    })),
    herramientas: (herrRows.results ?? []).map((h) => ({
      codigo: h.codigo, nombre: h.nombre, precio: h.precio, stock: h.stock,
      stock_minimo: h.stock_minimo, valor_stock: h.stock * h.costo, unidades_vendidas: vendMap.get(h.id) ?? 0,
      activo: h.activo ? "sí" : "archivada",
    })),
    movimientos: (movRows.results ?? []).map((m) => ({
      fecha: m.fecha, herramienta: m.herramienta_nombre, tipo: m.tipo, cantidad: m.cantidad,
      stock_resultante: m.stock_resultante, referencia: m.venta_id ? `Venta #${m.venta_id}` : m.motivo ?? "",
    })),
  });
});

/** Datos para el Excel de lista de precios + historial. */
exportar.get("/precios", async (c) => {
  const herrRows = await c.env.DB.prepare(
    `SELECT * FROM herramientas WHERE activo = 1 ORDER BY codigo`
  ).all<Herramienta>();

  // Fecha de última actualización de precio por herramienta.
  const ult = await c.env.DB.prepare(
    `SELECT herramienta_id, MAX(fecha) AS f FROM precios_historial GROUP BY herramienta_id`
  ).all<{ herramienta_id: number; f: string }>();
  const ultMap = new Map((ult.results ?? []).map((r) => [r.herramienta_id, r.f]));

  const histRows = await c.env.DB.prepare(
    `SELECT ph.*, h.nombre AS herramienta_nombre, h.codigo AS herramienta_codigo FROM precios_historial ph
     JOIN herramientas h ON h.id = ph.herramienta_id ORDER BY ph.fecha DESC, ph.id DESC`
  ).all<PrecioHistorial & { herramienta_nombre: string; herramienta_codigo: string }>();

  return c.json({
    lista: (herrRows.results ?? []).map((h) => ({
      codigo: h.codigo, herramienta: h.nombre, precio: h.precio,
      actualizado: ultMap.get(h.id) ?? h.creado_en.slice(0, 10), stock: h.stock,
    })),
    historial: (histRows.results ?? []).map((ph) => ({
      herramienta: ph.herramienta_nombre, fecha: ph.fecha,
      precio_anterior: ph.precio_anterior, precio_nuevo: ph.precio_nuevo,
      diferencia: ph.precio_nuevo - ph.precio_anterior,
      variacion_pct: ph.precio_anterior > 0
        ? Math.round(((ph.precio_nuevo - ph.precio_anterior) / ph.precio_anterior) * 1000) / 10
        : 0,
      motivo: ph.motivo ?? "",
    })),
  });
});
