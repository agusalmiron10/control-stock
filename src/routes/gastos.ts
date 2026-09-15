/**
 * Gastos: la plata que sale y no es mercadería.
 *
 * Lo que compra para revender ya está en compras.ts (mueve stock y recalcula
 * el costo). Acá va todo lo otro —alquiler, sueldos, luz, impuestos,
 * fletes—, que no mueve nada más que la caja. Es lo que le falta al reporte
 * de rentabilidad para pasar de margen bruto a ganancia de verdad.
 */
import { Hono } from "hono";
import type { Env, Variables, Gasto } from "../types";
import { HttpError, texto, entero, fechaISO, normalizarBusqueda } from "../validate";
import { negocioDe } from "../types";
import { requireModulo } from "../config";
import { auditarDe } from "../auditoria";

export const gastos = new Hono<{ Bindings: Env; Variables: Variables }>();
gastos.use("*", requireModulo("gastos"));

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lo que se carga o se corrige, validado igual en el alta y en la edición. */
function leerCampos(b: any) {
  const monto = entero(b.monto, "monto", { min: 1 });
  return {
    fecha: b.fecha ? fechaISO(b.fecha, "fecha") : hoy(),
    categoria: texto(b.categoria, "categoría", { max: 60 })!,
    descripcion: texto(b.descripcion, "descripción", { requerido: false, max: 300 }),
    monto,
    medio_pago: texto(b.medio_pago, "medio de pago", { requerido: false, max: 40 }),
  };
}

/** Listado por rango de fechas, con el total del período ya sumado. */
gastos.get("/", async (c) => {
  const neg = negocioDe(c);
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const buscar = c.req.query("buscar")?.trim();

  const cond = ["g.negocio_id = ?"];
  const args: unknown[] = [neg];
  if (desde) { cond.push("g.fecha >= ?"); args.push(fechaISO(desde, "desde")); }
  if (hasta) { cond.push("g.fecha <= ?"); args.push(fechaISO(hasta, "hasta")); }

  const filas = await c.env.DB.prepare(
    `SELECT g.*, u.usuario AS cargado_por
       FROM gastos g
       LEFT JOIN usuarios u ON u.id = g.atendido_por AND u.negocio_id = g.negocio_id
      WHERE ${cond.join(" AND ")}
      ORDER BY g.fecha DESC, g.creado_en DESC`
  )
    .bind(...args)
    .all<Gasto & { cargado_por: string | null }>();

  let lista = filas.results ?? [];
  if (buscar) {
    const q = normalizarBusqueda(buscar);
    lista = lista.filter(
      (g) => normalizarBusqueda(g.categoria).includes(q) || normalizarBusqueda(g.descripcion ?? "").includes(q)
    );
  }

  // El total del período y el corte por categoría: es lo que se mira
  // primero, y sacarlo acá evita que cada pantalla lo sume por su cuenta.
  const porCategoria = new Map<string, number>();
  let total = 0;
  for (const g of lista) {
    total += g.monto;
    porCategoria.set(g.categoria, (porCategoria.get(g.categoria) ?? 0) + g.monto);
  }

  return c.json({
    gastos: lista,
    total,
    por_categoria: [...porCategoria.entries()]
      .map(([categoria, monto]) => ({ categoria, monto }))
      .sort((a, b) => b.monto - a.monto),
  });
});

/**
 * Las categorías que este negocio ya usó, de la más usada a la menos.
 * Se ofrecen como sugerencia al cargar: sin una lista fija, pero sin
 * obligar a tipear "Alquiler" de nuevo cada mes (y que termine escrito de
 * tres formas distintas).
 */
gastos.get("/categorias", async (c) => {
  const filas = await c.env.DB.prepare(
    `SELECT categoria, COUNT(*) AS veces FROM gastos
      WHERE negocio_id = ? GROUP BY categoria ORDER BY veces DESC, categoria`
  )
    .bind(negocioDe(c))
    .all<{ categoria: string; veces: number }>();
  return c.json({ categorias: (filas.results ?? []).map((f) => f.categoria) });
});

gastos.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const d = leerCampos(b);
  const neg = negocioDe(c);
  const id = crypto.randomUUID();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO gastos (id, negocio_id, fecha, categoria, descripcion, monto, medio_pago, atendido_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, neg, d.fecha, d.categoria, d.descripcion, d.monto, d.medio_pago, c.get("usuario").uid),
    auditarDe(c, "crear_gasto", "gasto", id, `${d.categoria} · $${(d.monto / 100).toFixed(2)}`),
  ]);
  return c.json({ id });
});

gastos.put("/:id", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const previo = await c.env.DB.prepare(`SELECT * FROM gastos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Gasto>();
  if (!previo) throw new HttpError(404, "Ese gasto no existe.");

  const d = leerCampos(await c.req.json().catch(() => ({})));
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE gastos SET fecha = ?, categoria = ?, descripcion = ?, monto = ?, medio_pago = ?
        WHERE negocio_id = ? AND id = ?`
    ).bind(d.fecha, d.categoria, d.descripcion, d.monto, d.medio_pago, neg, id),
    auditarDe(c, "editar_gasto", "gasto", id, `${d.categoria} · $${(d.monto / 100).toFixed(2)}`,
      { anterior: { categoria: previo.categoria, monto: previo.monto, fecha: previo.fecha },
        nuevo: { categoria: d.categoria, monto: d.monto, fecha: d.fecha } }),
  ]);
  return c.json({ ok: true });
});

/**
 * Borrado de verdad, no archivado: un gasto no tiene nada colgando (no mueve
 * stock ni se imputa contra nada), así que borrarlo no deja huérfanos. Queda
 * en la auditoría con su monto, que es lo que importa para rastrearlo.
 */
gastos.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const g = await c.env.DB.prepare(`SELECT * FROM gastos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Gasto>();
  if (!g) throw new HttpError(404, "Ese gasto no existe.");

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM gastos WHERE negocio_id = ? AND id = ?`).bind(neg, id),
    auditarDe(c, "borrar_gasto", "gasto", id, `${g.categoria} · $${(g.monto / 100).toFixed(2)} del ${g.fecha}`),
  ]);
  return c.json({ ok: true });
});
