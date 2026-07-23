import { Hono } from "hono";
import type { Env, Variables, Pago } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado } from "../validate";

export const pagos = new Hono<{ Bindings: Env; Variables: Variables }>();

const MEDIOS = ["efectivo", "transferencia", "cheque", "otro"] as const;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Valida que, si el pago apunta a una venta, esa venta sea del cliente y no esté anulada. */
async function validarVenta(env: Env, clienteId: number, ventaId: number | null): Promise<number | null> {
  if (ventaId == null) return null;
  const v = await env.DB.prepare(`SELECT cliente_id, anulada FROM ventas WHERE id = ?`)
    .bind(ventaId)
    .first<{ cliente_id: number; anulada: number }>();
  if (!v) throw new HttpError(404, "La venta indicada no existe.");
  if (v.cliente_id !== clienteId) throw new HttpError(400, "La venta no pertenece a ese cliente.");
  if (v.anulada) throw new HttpError(400, "No se puede imputar un pago a una venta anulada.");
  return ventaId;
}

pagos.get("/", async (c) => {
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const clienteId = c.req.query("cliente_id");

  const cond: string[] = [];
  const args: unknown[] = [];
  if (desde) { cond.push("p.fecha >= ?"); args.push(desde); }
  if (hasta) { cond.push("p.fecha <= ?"); args.push(hasta); }
  if (clienteId) { cond.push("p.cliente_id = ?"); args.push(Number(clienteId)); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(
    `SELECT p.*, cl.nombre AS cliente_nombre, v.numero AS venta_numero
     FROM pagos p
     JOIN clientes cl ON cl.id = p.cliente_id
     LEFT JOIN ventas v ON v.id = p.venta_id
     ${where} ORDER BY p.fecha DESC, p.id DESC`
  )
    .bind(...args)
    .all<Pago & { cliente_nombre: string; venta_numero: number | null }>();
  return c.json({ pagos: rows.results ?? [] });
});

pagos.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const clienteId = entero(b.cliente_id, "cliente", { min: 1 });
  const monto = entero(b.monto, "monto", { min: 1 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const medio = enumerado(b.medio ?? "efectivo", "medio de pago", MEDIOS);
  const ventaId = await validarVenta(c.env, clienteId, b.venta_id != null ? Number(b.venta_id) : null);

  const cliente = await c.env.DB.prepare(`SELECT id FROM clientes WHERE id = ?`).bind(clienteId).first();
  if (!cliente) throw new HttpError(404, "El cliente no existe.");

  const res = await c.env.DB.prepare(
    `INSERT INTO pagos (cliente_id, venta_id, fecha, monto, medio, nota) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(clienteId, ventaId, fecha, monto, medio, texto(b.nota, "nota", { requerido: false }))
    .run();
  return c.json({ id: Number(res.meta.last_row_id) });
});

pagos.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const pago = await c.env.DB.prepare(`SELECT * FROM pagos WHERE id = ?`).bind(id).first<Pago>();
  if (!pago) throw new HttpError(404, "Pago no encontrado.");

  const monto = entero(b.monto, "monto", { min: 1 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : pago.fecha;
  const medio = enumerado(b.medio ?? pago.medio, "medio de pago", MEDIOS);
  const ventaId = await validarVenta(
    c.env,
    pago.cliente_id,
    b.venta_id !== undefined ? (b.venta_id != null ? Number(b.venta_id) : null) : pago.venta_id
  );

  await c.env.DB.prepare(`UPDATE pagos SET venta_id=?, fecha=?, monto=?, medio=?, nota=? WHERE id=?`)
    .bind(ventaId, fecha, monto, medio, texto(b.nota, "nota", { requerido: false }), id)
    .run();
  return c.json({ ok: true });
});

pagos.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const pago = await c.env.DB.prepare(`SELECT id FROM pagos WHERE id = ?`).bind(id).first();
  if (!pago) throw new HttpError(404, "Pago no encontrado.");
  await c.env.DB.prepare(`DELETE FROM pagos WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
