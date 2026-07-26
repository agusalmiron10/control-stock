import { Hono } from "hono";
import type { Env, Variables, Cliente, Herramienta } from "../types";
import { estadoDeCuentaTodos } from "../cuenta";

export const panel = new Hono<{ Bindings: Env; Variables: Variables }>();

panel.get("/", async (c) => {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const inicioMes = `${ym}-01`;
  const finMes = `${ym}-31`;

  const mesAnteriorDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ymAnterior = `${mesAnteriorDate.getFullYear()}-${String(mesAnteriorDate.getMonth() + 1).padStart(2, "0")}`;
  const inicioMesAnterior = `${ymAnterior}-01`;
  const finMesAnterior = `${ymAnterior}-31`;

  const [
    cuentas,
    clientesRows,
    herr,
    pendientes,
    ventasMes,
    cobranzasMes,
    ventasMesAnterior,
    cobranzasMesAnterior,
    ultimosMov
  ] = await Promise.all([
    estadoDeCuentaTodos(c.env),
    c.env.DB.prepare(`SELECT * FROM clientes WHERE activo = 1`).all<Cliente>(),
    c.env.DB.prepare(`SELECT * FROM herramientas WHERE activo = 1 AND stock <= stock_minimo ORDER BY stock ASC, nombre`).all<Herramienta>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ventas WHERE estado = 'sincronizada' OR necesita_revision = 1`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cant FROM ventas WHERE estado IN ('sincronizada', 'confirmada') AND fecha >= ? AND fecha <= ?`).bind(inicioMes, finMes).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant FROM pagos WHERE fecha >= ? AND fecha <= ?`).bind(inicioMes, finMes).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cant FROM ventas WHERE estado IN ('sincronizada', 'confirmada') AND fecha >= ? AND fecha <= ?`).bind(inicioMesAnterior, finMesAnterior).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant FROM pagos WHERE fecha >= ? AND fecha <= ?`).bind(inicioMesAnterior, finMesAnterior).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT m.*, h.nombre AS herramienta_nombre, h.codigo AS herramienta_codigo FROM movimientos_stock m JOIN herramientas h ON h.id = m.herramienta_id ORDER BY m.id DESC LIMIT 12`).all()
  ]);

  const clientesMap = new Map((clientesRows.results ?? []).map((cl) => [cl.id, cl]));

  // Deudas.
  let totalACobrar = 0;
  const deudores: { id: string; nombre: string; saldo: number }[] = [];
  for (const [cid, cta] of cuentas) {
    if (cta.saldoCliente > 0 && clientesMap.has(cid)) {
      totalACobrar += cta.saldoCliente;
      deudores.push({ id: cid, nombre: clientesMap.get(cid)!.nombre, saldo: cta.saldoCliente });
    }
  }
  deudores.sort((a, b) => b.saldo - a.saldo);

  return c.json({
    total_a_cobrar: totalACobrar,
    clientes_con_deuda: deudores.length,
    ranking_deudores: deudores.slice(0, 8),
    herramientas_alerta: (herr.results ?? []).map((h) => ({
      ...h,
      estado_stock: h.stock <= 0 ? "cero" : "bajo",
    })),
    ventas_pendientes: pendientes?.n ?? 0,
    mes: ym,
    ventas_mes: ventasMes,
    cobranzas_mes: cobranzasMes,
    ventas_mes_anterior: ventasMesAnterior,
    cobranzas_mes_anterior: cobranzasMesAnterior,
    ultimos_movimientos: ultimosMov.results ?? [],
  });
});
