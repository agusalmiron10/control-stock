import { Hono } from "hono";
import type { Env, Variables, Cliente, Herramienta } from "../types";
import { estadoDeCuentaTodos } from "../cuenta";
import { negocioDe } from "../types";
import { configDe } from "../config";

export const panel = new Hono<{ Bindings: Env; Variables: Variables }>();

panel.get("/", async (c) => {
  const neg = negocioDe(c);
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
    ultimosMov,
    ventas7Dias
  ] = await Promise.all([
    estadoDeCuentaTodos(c.env, neg),
    c.env.DB.prepare(`SELECT * FROM clientes WHERE negocio_id = ? AND activo = 1`).bind(neg).all<Cliente>(),
    c.env.DB.prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND activo = 1 AND stock <= stock_minimo ORDER BY stock ASC, nombre`).bind(neg).all<Herramienta>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ventas WHERE negocio_id = ? AND (estado = 'sincronizada' OR necesita_revision = 1)`).bind(neg).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cant FROM ventas WHERE negocio_id = ? AND estado IN ('sincronizada', 'confirmada') AND fecha >= ? AND fecha <= ?`).bind(neg, inicioMes, finMes).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant FROM pagos WHERE negocio_id = ? AND fecha >= ? AND fecha <= ?`).bind(neg, inicioMes, finMes).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS cant FROM ventas WHERE negocio_id = ? AND estado IN ('sincronizada', 'confirmada') AND fecha >= ? AND fecha <= ?`).bind(neg, inicioMesAnterior, finMesAnterior).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(monto),0) AS total, COUNT(*) AS cant FROM pagos WHERE negocio_id = ? AND fecha >= ? AND fecha <= ?`).bind(neg, inicioMesAnterior, finMesAnterior).first<{ total: number; cant: number }>(),
    c.env.DB.prepare(`SELECT m.*, h.nombre AS herramienta_nombre, h.codigo AS herramienta_codigo FROM movimientos_stock m JOIN herramientas h ON h.id = m.herramienta_id WHERE m.negocio_id = ? ORDER BY m.id DESC LIMIT 12`).bind(neg).all(),
    // Últimos 7 días para el gráfico del Panel: un total por día, incluyendo
    // los días sin ninguna venta (para que la barra en 0 se vea, no falte).
    c.env.DB
      .prepare(
        `SELECT fecha, COALESCE(SUM(total),0) AS total, COUNT(*) AS cant
           FROM ventas
          WHERE negocio_id = ? AND estado IN ('sincronizada', 'confirmada')
                AND fecha >= date('now', '-6 days')
          GROUP BY fecha`
      )
      .bind(neg)
      .all<{ fecha: string; total: number; cant: number }>(),
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

  // Vencimientos: sólo si el rubro del negocio los usa. Un negocio que no
  // los tiene prendidos ni siquiera paga la consulta.
  const cfg = await configDe(c);
  let porVencer: any[] = [];
  if (cfg.capacidades.permite_vencimientos) {
    const limite = new Date(Date.now() + cfg.capacidades.alerta_dias_antes_vencer * 86400000)
      .toISOString()
      .slice(0, 10);
    const filas = await c.env.DB
      .prepare(
        `SELECT id, codigo, nombre, stock, vence_el,
                CAST(julianday(vence_el) - julianday(date('now')) AS INTEGER) AS dias
           FROM herramientas
          WHERE negocio_id = ? AND activo = 1 AND vence_el IS NOT NULL AND vence_el <= ?
          ORDER BY vence_el`
      )
      .bind(neg, limite)
      .all();
    porVencer = filas.results ?? [];
  }

  // Completa los días sin ninguna venta con total 0, para que el gráfico
  // siempre tenga las 7 barras en orden aunque algún día no se haya vendido.
  const porFecha = new Map((ventas7Dias.results ?? []).map((v) => [v.fecha, v]));
  const ventasUltimos7Dias = Array.from({ length: 7 }, (_, i) => {
    const f = new Date(Date.now() - (6 - i) * 86400000).toISOString().slice(0, 10);
    const v = porFecha.get(f);
    return { fecha: f, total: v?.total ?? 0, cant: v?.cant ?? 0 };
  });

  return c.json({
    por_vencer: porVencer,
    ventas_ultimos_7_dias: ventasUltimos7Dias,
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
