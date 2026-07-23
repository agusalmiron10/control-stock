import { Hono } from "hono";
import type { Env, Variables, Presupuesto, PresupuestoItem, Herramienta } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado } from "../validate";

export const presupuestos = new Hono<{ Bindings: Env; Variables: Variables }>();

const ESTADOS = ["pendiente", "aceptado", "rechazado", "vencido"] as const;
const MEDIOS = ["efectivo", "transferencia", "cheque", "otro"] as const;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

presupuestos.get("/", async (c) => {
  const estado = c.req.query("estado");
  const cond: string[] = [];
  const args: unknown[] = [];
  if (estado) { cond.push("p.estado = ?"); args.push(estado); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(
    `SELECT p.*, cl.nombre AS cliente_nombre FROM presupuestos p
     JOIN clientes cl ON cl.id = p.cliente_id
     ${where} ORDER BY p.fecha DESC, p.numero DESC`
  )
    .bind(...args)
    .all<Presupuesto & { cliente_nombre: string }>();
  return c.json({ presupuestos: rows.results ?? [] });
});

presupuestos.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const p = await c.env.DB.prepare(
    `SELECT p.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono FROM presupuestos p
     JOIN clientes cl ON cl.id = p.cliente_id WHERE p.id = ?`
  )
    .bind(id)
    .first<Presupuesto & { cliente_nombre: string; cliente_telefono: string | null }>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");

  const items = await c.env.DB.prepare(`SELECT * FROM presupuesto_items WHERE presupuesto_id = ? ORDER BY id`)
    .bind(id)
    .all<PresupuestoItem>();

  return c.json({ presupuesto: p, items: items.results ?? [] });
});

interface ItemEntrada {
  herramienta_id: number;
  cantidad: number;
  precio_unitario: number;
}

presupuestos.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const clienteId = entero(b.cliente_id, "cliente", { min: 1 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const validoHasta = b.valido_hasta ? fechaISO(b.valido_hasta, "válido hasta") : null;
  const nota = texto(b.nota, "nota", { requerido: false, max: 1000 });

  const cliente = await c.env.DB.prepare(`SELECT id FROM clientes WHERE id = ?`).bind(clienteId).first();
  if (!cliente) throw new HttpError(404, "El cliente no existe.");

  const itemsIn = Array.isArray(b.items) ? (b.items as any[]) : [];
  if (itemsIn.length === 0) throw new HttpError(400, "El presupuesto tiene que tener al menos un renglón.");

  const items: ItemEntrada[] = itemsIn.map((it, i) => ({
    herramienta_id: entero(it.herramienta_id, `herramienta del renglón ${i + 1}`, { min: 1 }),
    cantidad: entero(it.cantidad, `cantidad del renglón ${i + 1}`, { min: 1 }),
    precio_unitario: entero(it.precio_unitario, `precio del renglón ${i + 1}`, { min: 0 }),
  }));

  const ids = [...new Set(items.map((i) => i.herramienta_id))];
  const placeholders = ids.map(() => "?").join(",");
  const hRows = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<Herramienta>();
  const hMap = new Map((hRows.results ?? []).map((h) => [h.id, h]));
  for (const it of items) {
    if (!hMap.has(it.herramienta_id)) throw new HttpError(404, `La herramienta #${it.herramienta_id} no existe.`);
  }

  const subtotal = items.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);
  let descuento = 0;
  if (b.descuento && b.descuento.tipo) {
    const tipo = enumerado(b.descuento.tipo, "tipo de descuento", ["monto", "porcentaje"]);
    const valor = Number(b.descuento.valor);
    if (!Number.isFinite(valor) || valor < 0) throw new HttpError(400, "El descuento no es válido.");
    descuento = tipo === "monto" ? Math.round(valor) : Math.round((subtotal * valor) / 100);
  }
  if (descuento > subtotal) descuento = subtotal;
  const total = subtotal - descuento;

  const maxRow = await c.env.DB
    .prepare(`SELECT COALESCE(MAX(id),0) AS mid, COALESCE(MAX(numero),0) AS mnum FROM presupuestos`)
    .first<{ mid: number; mnum: number }>();
  const presupuestoId = (maxRow?.mid ?? 0) + 1;
  const numero = (maxRow?.mnum ?? 0) + 1;

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO presupuestos (id, numero, cliente_id, fecha, subtotal, descuento, total, estado, valido_hasta, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`
    ).bind(presupuestoId, numero, clienteId, fecha, subtotal, descuento, total, validoHasta, nota)
  );
  for (const it of items) {
    const h = hMap.get(it.herramienta_id)!;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO presupuesto_items (presupuesto_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(presupuestoId, it.herramienta_id, h.nombre, it.cantidad, it.precio_unitario, it.cantidad * it.precio_unitario)
    );
  }

  await c.env.DB.batch(stmts);
  return c.json({ id: presupuestoId, numero });
});

/** Cambiar estado (pendiente/aceptado/rechazado/vencido) sin convertir a venta. */
presupuestos.post("/:id/estado", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const estado = enumerado(b.estado, "estado", ESTADOS);

  const p = await c.env.DB.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(id).first<Presupuesto>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");
  if (p.venta_id) throw new HttpError(400, "Este presupuesto ya se convirtió en venta.");

  await c.env.DB.prepare(`UPDATE presupuestos SET estado = ? WHERE id = ?`).bind(estado, id).run();
  return c.json({ ok: true });
});

/**
 * Convertir un presupuesto en venta real: crea la venta + items + descuenta
 * stock + movimientos + pago inicial opcional, todo en el mismo batch atómico
 * que usa una venta normal. Marca el presupuesto como aceptado.
 */
presupuestos.post("/:id/convertir", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const p = await c.env.DB.prepare(`SELECT * FROM presupuestos WHERE id = ?`).bind(id).first<Presupuesto>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");
  if (p.venta_id) throw new HttpError(400, "Este presupuesto ya se convirtió en venta.");
  if (p.estado === "rechazado") throw new HttpError(400, "Este presupuesto está rechazado.");

  const itemsRows = await c.env.DB.prepare(`SELECT * FROM presupuesto_items WHERE presupuesto_id = ?`)
    .bind(id)
    .all<PresupuestoItem>();
  const items = itemsRows.results ?? [];
  if (items.length === 0) throw new HttpError(400, "El presupuesto no tiene renglones.");

  const permitirNegativo = !!b.permitir_stock_negativo;
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const ids = [...new Set(items.map((i) => i.herramienta_id))];
  const placeholders = ids.map(() => "?").join(",");
  const hRows = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<Herramienta>();
  const hMap = new Map((hRows.results ?? []).map((h) => [h.id, h]));

  const pedidoPorH = new Map<number, number>();
  for (const it of items) pedidoPorH.set(it.herramienta_id, (pedidoPorH.get(it.herramienta_id) ?? 0) + it.cantidad);

  if (!permitirNegativo) {
    const faltan: string[] = [];
    for (const [hid, cant] of pedidoPorH) {
      const h = hMap.get(hid);
      if (h && h.stock < cant) faltan.push(`${h.nombre} (hay ${h.stock}, pedís ${cant})`);
    }
    if (faltan.length) {
      throw new HttpError(
        409,
        `No alcanza el stock de: ${faltan.join("; ")}. Confirmá para vender igual (quedará en negativo).`
      );
    }
  }

  const maxRow = await c.env.DB
    .prepare(`SELECT COALESCE(MAX(id),0) AS mid, COALESCE(MAX(numero),0) AS mnum FROM ventas`)
    .first<{ mid: number; mnum: number }>();
  const ventaId = (maxRow?.mid ?? 0) + 1;
  const numero = (maxRow?.mnum ?? 0) + 1;

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO ventas (id, numero, cliente_id, fecha, subtotal, descuento, total, nota, anulada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(ventaId, numero, p.cliente_id, fecha, p.subtotal, p.descuento, p.total, `Presupuesto #${p.numero}`)
  );
  for (const it of items) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO venta_items (venta_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(ventaId, it.herramienta_id, it.nombre_herramienta, it.cantidad, it.precio_unitario, it.subtotal)
    );
  }
  for (const [hid, cant] of pedidoPorH) {
    const h = hMap.get(hid)!;
    const resultante = h.stock - cant;
    stmts.push(c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE id = ?`).bind(resultante, hid));
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, motivo)
         VALUES (?, ?, 'venta', ?, ?, ?, NULL)`
      ).bind(hid, fecha, -cant, resultante, ventaId)
    );
  }
  if (b.pago_inicial && Number(b.pago_inicial.monto) > 0) {
    const monto = entero(b.pago_inicial.monto, "pago inicial", { min: 1 });
    const medio = enumerado(b.pago_inicial.medio ?? "efectivo", "medio de pago", MEDIOS);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO pagos (cliente_id, venta_id, fecha, monto, medio, nota) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(p.cliente_id, ventaId, fecha, monto, medio, "Pago al convertir presupuesto")
    );
  }
  stmts.push(
    c.env.DB.prepare(`UPDATE presupuestos SET estado = 'aceptado', venta_id = ? WHERE id = ?`).bind(ventaId, id)
  );

  await c.env.DB.batch(stmts);
  return c.json({ venta_id: ventaId, numero });
});
