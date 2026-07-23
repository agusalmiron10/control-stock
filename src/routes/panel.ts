import { Hono } from "hono";
import type { Env, Variables, Cliente, Herramienta } from "../types";
import { estadoDeCuentaTodos } from "../cuenta";

export const panel = new Hono<{ Bindings: Env; Variables: Variables }>();

panel.get("/", async (c) => {
  const cuentas = await estadoDeCuentaTodos(c.env);

  const clientesRows = await c.env.DB.prepare(`SELECT * FROM clientes WHERE activo = 1`).all<Cliente>();
  const clientesMap = new Map((clientesRows.results ?? []).map((cl) => [cl.id, cl]));

  // Deudas.
  let totalACobrar = 0;
  const deudores: { id: number; nombre: string; saldo: number }[] = [];
  for (const [cid, cta] of cuentas) {
    if (cta.saldoCliente > 0 && clientesMap.has(cid)) {
      totalACobrar += cta.saldoCliente;
      deudores.push({ id: cid, nombre: clientesMap.get(cid)!.nombre, saldo: cta.saldoCliente });
    }
  }
  deudores.sort((a, b) => b.saldo - a.saldo);

  // Herramientas con alerta.
  const herr = await c.env.DB.prepare(
    `SELECT * FROM herramientas WHERE activo = 1 AND stock <= stock_minimo ORDER BY stock ASC, nombre`
  ).all<Herramienta>();

  // Mes en curso.
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const inicioMes = `${ym}-01`;
  const finMes = `${ym}-31`;

  const ventasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cant
     FROM ventas WHERE anulada = 0 AND fecha >= ? AND fecha <= ?`
  )
    .bind(inicioMes, finMes)
    .first<{ total: number; cant: number }>();

  const cobranzasMes = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant
     FROM pagos WHERE fecha >= ? AND fecha <= ?`
  )
    .bind(inicioMes, finMes)
    .first<{ total: number; cant: number }>();

  // Últimos movimientos de stock.
  const ultimosMov = await c.env.DB.prepare(
    `SELECT m.*, h.nombre AS herramienta_nombre, h.codigo AS herramienta_codigo
     FROM movimientos_stock m JOIN herramientas h ON h.id = m.herramienta_id
     ORDER BY m.id DESC LIMIT 12`
  ).all();

  return c.json({
    total_a_cobrar: totalACobrar,
    clientes_con_deuda: deudores.length,
    ranking_deudores: deudores.slice(0, 8),
    herramientas_alerta: (herr.results ?? []).map((h) => ({
      ...h,
      estado_stock: h.stock <= 0 ? "cero" : "bajo",
    })),
    mes: ym,
    ventas_mes: ventasMes,
    cobranzas_mes: cobranzasMes,
    ultimos_movimientos: ultimosMov.results ?? [],
  });
});
