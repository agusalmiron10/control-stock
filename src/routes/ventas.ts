import { Hono } from "hono";
import type { Env, Variables, Venta, VentaItem, Herramienta } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado, boolOpt } from "../validate";
import { estadoDeCuenta } from "../cuenta";

export const ventas = new Hono<{ Bindings: Env; Variables: Variables }>();

const MEDIOS = ["efectivo", "transferencia", "cheque", "otro"] as const;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Listado con filtros de fecha / cliente y estado de pago. */
ventas.get("/", async (c) => {
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const clienteId = c.req.query("cliente_id");

  const cond: string[] = [];
  const args: unknown[] = [];
  if (desde) { cond.push("v.fecha >= ?"); args.push(desde); }
  if (hasta) { cond.push("v.fecha <= ?"); args.push(hasta); }
  if (clienteId) { cond.push("v.cliente_id = ?"); args.push(Number(clienteId)); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(
    `SELECT v.*, cl.nombre AS cliente_nombre FROM ventas v
     JOIN clientes cl ON cl.id = v.cliente_id
     ${where} ORDER BY v.fecha DESC, v.numero DESC`
  )
    .bind(...args)
    .all<Venta & { cliente_nombre: string }>();

  // Estado de pago: se calcula por cliente presente en el resultado.
  const clientesIds = new Set((rows.results ?? []).map((v) => v.cliente_id));
  const cuentas = new Map<number, Awaited<ReturnType<typeof estadoDeCuenta>>>();
  for (const cid of clientesIds) cuentas.set(cid, await estadoDeCuenta(c.env, cid));

  const lista = (rows.results ?? []).map((v) => {
    const r = cuentas.get(v.cliente_id)?.porVenta.get(v.id);
    return {
      ...v,
      pagado: v.anulada ? 0 : r?.pagado ?? 0,
      saldo: v.anulada ? 0 : r?.saldo ?? v.total,
      estado: v.anulada ? "anulada" : r?.estado ?? "impaga",
    };
  });
  return c.json({ ventas: lista });
});

ventas.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const venta = await c.env.DB.prepare(
    `SELECT v.*, cl.nombre AS cliente_nombre FROM ventas v JOIN clientes cl ON cl.id = v.cliente_id WHERE v.id = ?`
  )
    .bind(id)
    .first<Venta & { cliente_nombre: string }>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");

  const items = await c.env.DB.prepare(`SELECT * FROM venta_items WHERE venta_id = ? ORDER BY id`)
    .bind(id)
    .all<VentaItem>();

  const cta = await estadoDeCuenta(c.env, venta.cliente_id);
  const r = cta.porVenta.get(id);

  return c.json({
    venta: {
      ...venta,
      pagado: venta.anulada ? 0 : r?.pagado ?? 0,
      saldo: venta.anulada ? 0 : r?.saldo ?? venta.total,
      estado: venta.anulada ? "anulada" : r?.estado ?? "impaga",
    },
    items: items.results ?? [],
  });
});

interface ItemEntrada {
  herramienta_id: number;
  cantidad: number;
  precio_unitario: number;
}

/** Crear venta: venta + items + descuento de stock + movimientos + pago inicial, todo atómico. */
ventas.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const clienteId = entero(b.cliente_id, "cliente", { min: 1 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const permitirNegativo = boolOpt(b.permitir_stock_negativo);
  const nota = texto(b.nota, "nota", { requerido: false, max: 1000 });

  const cliente = await c.env.DB.prepare(`SELECT id, activo FROM clientes WHERE id = ?`)
    .bind(clienteId)
    .first<{ id: number; activo: number }>();
  if (!cliente) throw new HttpError(404, "El cliente no existe.");

  const itemsIn = Array.isArray(b.items) ? (b.items as any[]) : [];
  if (itemsIn.length === 0) throw new HttpError(400, "La venta tiene que tener al menos un renglón.");

  const items: ItemEntrada[] = itemsIn.map((it, i) => ({
    herramienta_id: entero(it.herramienta_id, `herramienta del renglón ${i + 1}`, { min: 1 }),
    cantidad: entero(it.cantidad, `cantidad del renglón ${i + 1}`, { min: 1 }),
    precio_unitario: entero(it.precio_unitario, `precio del renglón ${i + 1}`, { min: 0 }),
  }));

  // Traer las herramientas involucradas.
  const ids = [...new Set(items.map((i) => i.herramienta_id))];
  const placeholders = ids.map(() => "?").join(",");
  const hRows = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<Herramienta>();
  const hMap = new Map((hRows.results ?? []).map((h) => [h.id, h]));
  for (const it of items) {
    if (!hMap.has(it.herramienta_id)) throw new HttpError(404, `La herramienta #${it.herramienta_id} no existe.`);
  }

  // Cantidad total pedida por herramienta (por si se repite en varios renglones).
  const pedidoPorH = new Map<number, number>();
  for (const it of items) pedidoPorH.set(it.herramienta_id, (pedidoPorH.get(it.herramienta_id) ?? 0) + it.cantidad);

  // Chequeo de stock.
  if (!permitirNegativo) {
    const faltan: string[] = [];
    for (const [hid, cant] of pedidoPorH) {
      const h = hMap.get(hid)!;
      if (h.stock < cant) faltan.push(`${h.nombre} (hay ${h.stock}, pedís ${cant})`);
    }
    if (faltan.length) {
      throw new HttpError(
        409,
        `No alcanza el stock de: ${faltan.join("; ")}. Confirmá para vender igual (quedará en negativo).`
      );
    }
  }

  // Montos.
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

  // Próximos id y número (single-user: sin carrera; ante colisión, el batch falla atómico).
  const maxRow = await c.env.DB
    .prepare(`SELECT COALESCE(MAX(id),0) AS mid, COALESCE(MAX(numero),0) AS mnum FROM ventas`)
    .first<{ mid: number; mnum: number }>();
  const ventaId = (maxRow?.mid ?? 0) + 1;
  const numero = (maxRow?.mnum ?? 0) + 1;

  // Armar el batch atómico.
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO ventas (id, numero, cliente_id, fecha, subtotal, descuento, total, nota, anulada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(ventaId, numero, clienteId, fecha, subtotal, descuento, total, nota)
  );

  for (const it of items) {
    const h = hMap.get(it.herramienta_id)!;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO venta_items (venta_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(ventaId, it.herramienta_id, h.nombre, it.cantidad, it.precio_unitario, it.cantidad * it.precio_unitario)
    );
  }

  // Descontar stock y registrar un movimiento 'venta' por herramienta.
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

  // Pago inicial opcional.
  if (b.pago_inicial && Number(b.pago_inicial.monto) > 0) {
    const monto = entero(b.pago_inicial.monto, "pago inicial", { min: 1 });
    const medio = enumerado(b.pago_inicial.medio ?? "efectivo", "medio de pago", MEDIOS);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO pagos (cliente_id, venta_id, fecha, monto, medio, nota)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(clienteId, ventaId, fecha, monto, medio, texto(b.pago_inicial.nota, "nota del pago", { requerido: false }))
    );
  }

  await c.env.DB.batch(stmts);
  return c.json({ id: ventaId, numero });
});

/** Anular: devuelve stock, registra la anulación y libera los pagos imputados. */
ventas.post("/:id/anular", async (c) => {
  const id = Number(c.req.param("id"));
  const venta = await c.env.DB.prepare(`SELECT * FROM ventas WHERE id = ?`).bind(id).first<Venta>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  if (venta.anulada) throw new HttpError(400, "La venta ya está anulada.");

  const items = await c.env.DB.prepare(`SELECT * FROM venta_items WHERE venta_id = ?`)
    .bind(id)
    .all<VentaItem>();

  const fecha = hoy();

  // Reponer stock por herramienta (agregando renglones repetidos).
  const devolverPorH = new Map<number, number>();
  for (const it of items.results ?? []) {
    devolverPorH.set(it.herramienta_id, (devolverPorH.get(it.herramienta_id) ?? 0) + it.cantidad);
  }

  const stmts: D1PreparedStatement[] = [];
  stmts.push(c.env.DB.prepare(`UPDATE ventas SET anulada = 1 WHERE id = ?`).bind(id));

  for (const [hid, cant] of devolverPorH) {
    const h = await c.env.DB.prepare(`SELECT stock FROM herramientas WHERE id = ?`).bind(hid).first<{ stock: number }>();
    const resultante = (h?.stock ?? 0) + cant;
    stmts.push(c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE id = ?`).bind(resultante, hid));
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, motivo)
         VALUES (?, ?, 'anulacion', ?, ?, ?, 'Anulación de venta')`
      ).bind(hid, fecha, cant, resultante, id)
    );
  }

  // Liberar los pagos que estaban imputados a esta venta (pasan a cuenta → reimputan solos).
  stmts.push(c.env.DB.prepare(`UPDATE pagos SET venta_id = NULL WHERE venta_id = ?`).bind(id));

  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
