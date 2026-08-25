import { Hono } from "hono";
import type { Env, Variables, Cliente, Venta, Herramienta } from "../types";
import { estadoDeCuentaTodos } from "../cuenta";
import { requireDueno } from "../auth";
import { requireModulo } from "../config";
import { negocioDe } from "../types";

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
reportes.get("/cobranzas", requireModulo("cuenta_corriente"), async (c) => {
  const neg = negocioDe(c);
  const cuentas = await estadoDeCuentaTodos(c.env, neg);

  const clientesRows = await c.env.DB.prepare(
    `SELECT id, nombre, telefono, localidad FROM clientes WHERE negocio_id = ? AND activo = 1`
  ).bind(neg).all<Pick<Cliente, "id" | "nombre" | "telefono" | "localidad">>();
  const clientesMap = new Map((clientesRows.results ?? []).map((cl) => [cl.id, cl]));

  const ventasRows = await c.env.DB.prepare(
    `SELECT id, cliente_id, fecha, numero FROM ventas
     WHERE negocio_id = ? AND estado IN ('sincronizada','confirmada') ORDER BY fecha ASC, numero ASC`
  ).bind(neg).all<Pick<Venta, "id" | "cliente_id" | "fecha" | "numero">>();

  const ventasPorCliente = new Map<string, typeof ventasRows.results>();
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
reportes.get("/rentabilidad", requireDueno, async (c) => {
  const desde = c.req.query("desde") || undefined;
  const hasta = c.req.query("hasta") || undefined;

  const neg = negocioDe(c);
  const cond: string[] = ["vi.negocio_id = ?", "v.estado IN ('sincronizada','confirmada')"];
  const args: string[] = [neg];
  if (desde) { cond.push("v.fecha >= ?"); args.push(desde); }
  if (hasta) { cond.push("v.fecha <= ?"); args.push(hasta); }

  const vendidas = await c.env.DB.prepare(
    `SELECT vi.herramienta_id AS hid, SUM(vi.cantidad) AS unidades, SUM(vi.subtotal) AS vendido
     FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
     WHERE ${cond.join(" AND ")} GROUP BY vi.herramienta_id`
  ).bind(...args).all<{ hid: string; unidades: number; vendido: number }>();
  const vmap = new Map((vendidas.results ?? []).map((r) => [r.hid, r]));

  const herr = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE negocio_id = ?`).bind(neg).all<Herramienta>();

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

/**
 * Plan de producción: qué conviene fabricar. Cruza stock actual + mínimo con
 * la velocidad de venta de los últimos 30 y 60 días. Sugiere una cantidad a
 * producir para volver a tener ~1 mes de stock por encima del mínimo.
 */
reportes.get("/produccion", requireModulo("produccion"), async (c) => {
  const esDueno = c.get("usuario").rol === "dueño";
  const hoy = hoyISO();
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const hace60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

  const neg = negocioDe(c);
  const herr = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND activo = 1`).bind(neg).all<Herramienta>();

  const v30 = await c.env.DB.prepare(
    `SELECT vi.herramienta_id AS hid, SUM(vi.cantidad) AS u FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id
     WHERE vi.negocio_id = ? AND v.estado IN ('sincronizada','confirmada') AND v.fecha >= ?
     GROUP BY vi.herramienta_id`
  ).bind(neg, hace30).all<{ hid: string; u: number }>();
  const v60 = await c.env.DB.prepare(
    `SELECT vi.herramienta_id AS hid, SUM(vi.cantidad) AS u FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id
     WHERE vi.negocio_id = ? AND v.estado IN ('sincronizada','confirmada') AND v.fecha >= ?
     GROUP BY vi.herramienta_id`
  ).bind(neg, hace60).all<{ hid: string; u: number }>();
  const map30 = new Map((v30.results ?? []).map((r) => [r.hid, r.u]));
  const map60 = new Map((v60.results ?? []).map((r) => [r.hid, r.u]));

  const sugeridos = (herr.results ?? [])
    .map((h) => {
      const vendidas30 = map30.get(h.id) ?? 0;
      const vendidas60 = map60.get(h.id) ?? 0;
      // Velocidad mensual: promedia 30 y 60 días (dividido 2) para suavizar picos.
      const velocidadMensual = Math.round((vendidas30 + vendidas60 / 2) / 2);
      // Objetivo: mínimo + 1 mes de venta por delante.
      const objetivo = h.stock_minimo + velocidadMensual;
      const sugerido = Math.max(0, objetivo - h.stock);
      return {
        id: h.id, codigo: h.codigo, nombre: h.nombre, rubro: h.rubro ?? "",
        stock: h.stock, stock_minimo: h.stock_minimo, costo: esDueno ? h.costo : 0,
        vendidas_30d: vendidas30, vendidas_60d: vendidas60, velocidad_mensual: velocidadMensual,
        cantidad_sugerida: sugerido,
        urgente: h.stock <= h.stock_minimo,
      };
    })
    .filter((x) => x.cantidad_sugerida > 0 || x.urgente)
    .sort((a, b) => (b.urgente ? 1 : 0) - (a.urgente ? 1 : 0) || b.cantidad_sugerida - a.cantidad_sugerida);

  return c.json({ generado: hoy, sugeridos });
});

/** Caja del día: ventas y cobranzas de hoy (o de la fecha pedida), por medio de pago. */
reportes.get("/caja", async (c) => {
  const fecha = c.req.query("fecha") || hoyISO();
  const neg = negocioDe(c);

  const ventasDia = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cant FROM ventas
     WHERE negocio_id = ? AND estado IN ('sincronizada','confirmada') AND fecha = ?`
  ).bind(neg, fecha).first<{ total: number; cant: number }>();

  const porMedio = await c.env.DB.prepare(
    `SELECT medio, COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant FROM pagos
     WHERE negocio_id = ? AND fecha = ? GROUP BY medio`
  ).bind(neg, fecha).all<{ medio: string; total: number; cant: number }>();

  const pagosRows = await c.env.DB.prepare(
    `SELECT p.*, cl.nombre AS cliente_nombre, v.numero AS venta_numero FROM pagos p
     JOIN clientes cl ON cl.id = p.cliente_id LEFT JOIN ventas v ON v.id = p.venta_id
     WHERE p.negocio_id = ? AND p.fecha = ? ORDER BY p.id`
  ).bind(neg, fecha).all();

  const totalCobrado = (porMedio.results ?? []).reduce((a, m) => a + m.total, 0);

  return c.json({
    fecha,
    ventas_total: ventasDia?.total ?? 0,
    ventas_cant: ventasDia?.cant ?? 0,
    cobrado_total: totalCobrado,
    por_medio: porMedio.results ?? [],
    pagos: pagosRows.results ?? [],
  });
});

/** Evolución mensual de ventas y cobranzas (últimos N meses). */
reportes.get("/evolucion", async (c) => {
  const meses = Math.min(24, Math.max(1, Number(c.req.query("meses")) || 6));
  const desde = new Date();
  desde.setUTCDate(1);
  desde.setUTCMonth(desde.getUTCMonth() - (meses - 1));
  const neg = negocioDe(c);
  const desdeStr = desde.toISOString().slice(0, 10);

  const ventasPorMes = await c.env.DB.prepare(
    `SELECT substr(fecha,1,7) AS mes, COALESCE(SUM(total),0) AS total, COUNT(*) AS cant
     FROM ventas WHERE negocio_id = ? AND estado IN ('sincronizada','confirmada') AND fecha >= ?
     GROUP BY mes ORDER BY mes`
  ).bind(neg, desdeStr).all<{ mes: string; total: number; cant: number }>();

  const cobranzasPorMes = await c.env.DB.prepare(
    `SELECT substr(fecha,1,7) AS mes, COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant
     FROM pagos WHERE negocio_id = ? AND fecha >= ? GROUP BY mes ORDER BY mes`
  ).bind(neg, desdeStr).all<{ mes: string; total: number; cant: number }>();

  // Completar meses sin datos con 0, para que el gráfico no tenga huecos.
  const claves: string[] = [];
  const cursor = new Date(desde);
  for (let i = 0; i < meses; i++) {
    claves.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const vMap = new Map((ventasPorMes.results ?? []).map((r) => [r.mes, r]));
  const cMap = new Map((cobranzasPorMes.results ?? []).map((r) => [r.mes, r]));

  const evolucion = claves.map((mes) => ({
    mes,
    ventas_total: vMap.get(mes)?.total ?? 0,
    ventas_cant: vMap.get(mes)?.cant ?? 0,
    cobranzas_total: cMap.get(mes)?.total ?? 0,
    cobranzas_cant: cMap.get(mes)?.cant ?? 0,
  }));

  // Deuda pendiente en el tiempo: usamos los resúmenes diarios del cron (si ya hay historial).
  const deuda = await c.env.DB.prepare(
    `SELECT fecha, saldo_pendiente FROM resumenes_diarios WHERE negocio_id = ? AND fecha >= ? ORDER BY fecha`
  ).bind(neg, desdeStr).all<{ fecha: string; saldo_pendiente: number }>();

  return c.json({ evolucion, deuda_diaria: deuda.results ?? [] });
});

/**
 * Detalle de qué se vendió y a quién, en un rango de fechas (y cliente opcional).
 * Sin costos ni márgenes — accesible para cualquier rol. La usa el botón
 * "Descargar PDF" de Ventas.
 */
reportes.get("/ventas-detalle", async (c) => {
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const clienteId = c.req.query("cliente_id");

  const cond: string[] = ["vi.negocio_id = ?", "v.estado IN ('sincronizada','confirmada')"];
  const args: unknown[] = [negocioDe(c)];
  if (desde) { cond.push("v.fecha >= ?"); args.push(desde); }
  if (hasta) { cond.push("v.fecha <= ?"); args.push(hasta); }
  if (clienteId) { cond.push("v.cliente_id = ?"); args.push(clienteId); }

  const rows = await c.env.DB.prepare(
    `SELECT v.fecha, v.numero, v.total AS venta_total, cl.id AS cliente_id, cl.nombre AS cliente_nombre,
            vi.nombre_herramienta AS producto, vi.cantidad, vi.precio_unitario, vi.subtotal
     FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id
     JOIN clientes cl ON cl.id = v.cliente_id
     WHERE ${cond.join(" AND ")}
     ORDER BY v.fecha, v.numero, vi.id`
  ).bind(...args).all();

  const items = rows.results ?? [];
  const totalVendido = items.reduce((a, r: any) => a + r.subtotal, 0);
  const ventasUnicas = new Set(items.map((r: any) => r.numero)).size;

  return c.json({
    desde: desde ?? null,
    hasta: hasta ?? null,
    cliente_id: clienteId ?? null,
    items,
    total_vendido: totalVendido,
    cantidad_ventas: ventasUnicas,
  });
});

/** Último resumen diario generado por el Cron (para la tarjeta "Resumen de ayer" del Panel). */
reportes.get("/resumen-diario", async (c) => {
  const fecha = c.req.query("fecha");
  const row = fecha
    ? await c.env.DB.prepare(`SELECT * FROM resumenes_diarios WHERE negocio_id = ? AND fecha = ?`)
        .bind(negocioDe(c), fecha).first()
    : await c.env.DB.prepare(`SELECT * FROM resumenes_diarios WHERE negocio_id = ? ORDER BY fecha DESC LIMIT 1`)
        .bind(negocioDe(c)).first();
  return c.json({ resumen: row ?? null });
});

/**
 * Calcula el resumen de UN día (ventas, cobranzas, saldo pendiente, stock bajo).
 * La usa el Cron Trigger (src/scheduled.ts) para guardar el snapshot diario.
 * Exportada para poder testearla o llamarla manualmente si hace falta.
 */
export async function calcularResumenDia(env: Env, negocioId: string, fecha: string) {
  const ventasDia = await env.DB.prepare(
    `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cant FROM ventas
     WHERE negocio_id = ? AND estado IN ('sincronizada','confirmada') AND fecha = ?`
  ).bind(negocioId, fecha).first<{ total: number; cant: number }>();

  const cobranzasDia = await env.DB.prepare(
    `SELECT COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant FROM pagos
     WHERE negocio_id = ? AND fecha = ?`
  ).bind(negocioId, fecha).first<{ total: number; cant: number }>();

  const cuentas = await estadoDeCuentaTodos(env, negocioId);
  let saldoPendiente = 0;
  let clientesConDeuda = 0;
  for (const cta of cuentas.values()) {
    if (cta.saldoCliente > 0) {
      saldoPendiente += cta.saldoCliente;
      clientesConDeuda++;
    }
  }

  const stockBajo = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM herramientas WHERE negocio_id = ? AND activo = 1 AND stock <= stock_minimo`
  ).bind(negocioId).first<{ n: number }>();

  return {
    fecha,
    ventas_total: ventasDia?.total ?? 0,
    ventas_cant: ventasDia?.cant ?? 0,
    cobranzas_total: cobranzasDia?.total ?? 0,
    cobranzas_cant: cobranzasDia?.cant ?? 0,
    saldo_pendiente: saldoPendiente,
    clientes_con_deuda: clientesConDeuda,
    stock_bajo_cant: stockBajo?.n ?? 0,
  };
}
