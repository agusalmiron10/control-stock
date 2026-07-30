import { Hono } from "hono";
import type { Env, Variables, Venta, VentaItem, Herramienta } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado, boolOpt, uuid, uuidOpt } from "../validate";
import { estadoDeCuenta, estadoDeCuentaTodos } from "../cuenta";
import { auditar } from "../auditoria";

export const ventas = new Hono<{ Bindings: Env; Variables: Variables }>();

const MEDIOS = ["efectivo", "transferencia", "cheque", "otro"] as const;
const ORIGENES = ["celular", "escritorio"] as const;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}
/** Formato SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" (UTC). */
function ahoraSQL(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
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
  if (clienteId) { cond.push("v.cliente_id = ?"); args.push(clienteId); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(
    `SELECT v.*, cl.nombre AS cliente_nombre FROM ventas v
     JOIN clientes cl ON cl.id = v.cliente_id
     ${where} ORDER BY v.fecha DESC, v.numero DESC`
  )
    .bind(...args)
    .all<Venta & { cliente_nombre: string }>();

  // Estado de pago: batch en 2 queries (evita N+1).
  const cuentas = await estadoDeCuentaTodos(c.env);

  const lista = (rows.results ?? []).map((v) => {
    const activa = v.estado === "sincronizada" || v.estado === "confirmada";
    const r = activa ? cuentas.get(v.cliente_id)?.porVenta.get(v.id) : undefined;
    return {
      ...v,
      pagado: activa ? r?.pagado ?? 0 : 0,
      saldo: activa ? r?.saldo ?? v.total : 0,
      estado_pago: activa ? r?.estado ?? "impaga" : null,
    };
  });
  return c.json({ ventas: lista });
});

/** Ventas que llegaron del celular sin revisar, o que quedaron marcadas para revisar. */
ventas.get("/pendientes", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT v.*, cl.nombre AS cliente_nombre FROM ventas v
     JOIN clientes cl ON cl.id = v.cliente_id
     WHERE v.estado = 'sincronizada' OR v.necesita_revision = 1
     ORDER BY v.creado_en ASC`
  ).all<Venta & { cliente_nombre: string }>();
  return c.json({ ventas: rows.results ?? [] });
});

ventas.get("/:id", async (c) => {
  const id = c.req.param("id");
  const venta = await c.env.DB.prepare(
    `SELECT v.*, cl.nombre AS cliente_nombre FROM ventas v JOIN clientes cl ON cl.id = v.cliente_id WHERE v.id = ?`
  )
    .bind(id)
    .first<Venta & { cliente_nombre: string }>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");

  const items = await c.env.DB.prepare(`SELECT * FROM venta_items WHERE venta_id = ? ORDER BY id`)
    .bind(id)
    .all<VentaItem>();

  const activa = venta.estado === "sincronizada" || venta.estado === "confirmada";
  const cta = activa ? await estadoDeCuenta(c.env, venta.cliente_id) : null;
  const r = cta?.porVenta.get(id);

  return c.json({
    venta: {
      ...venta,
      pagado: activa ? r?.pagado ?? 0 : 0,
      saldo: activa ? r?.saldo ?? venta.total : 0,
      estado_pago: activa ? r?.estado ?? "impaga" : null,
    },
    items: items.results ?? [],
  });
});

interface ItemEntrada {
  herramienta_id: string;
  cantidad: number;
  precio_unitario: number;
}

/**
 * Crear venta: venta + items + descuento de stock + movimientos + pago
 * inicial, todo en un único db.batch() atómico.
 *
 * Acepta `id` e `idempotency_key` opcionales (los manda el celular cuando la
 * venta se creó offline). Si la clave ya fue procesada, devuelve el mismo
 * resultado sin volver a tocar la base — así un reintento de la cola de
 * sincronización nunca duplica la venta.
 *
 * `origen: 'celular'` nunca rechaza por falta de stock: lo permite igual y
 * marca `necesita_revision` con el detalle, para que aparezca en la bandeja
 * de pendientes. Desde escritorio, el front pide confirmación antes de
 * mandar `permitir_stock_negativo`.
 */
ventas.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const idempotencyKey = uuidOpt(b.idempotency_key, "idempotency_key");

  if (idempotencyKey) {
    const previa = await c.env.DB.prepare(`SELECT resultado FROM operaciones WHERE idempotency_key = ?`)
      .bind(idempotencyKey)
      .first<{ resultado: string }>();
    if (previa) return c.json(JSON.parse(previa.resultado));
  }

  const clienteId = uuid(b.cliente_id, "cliente");
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const origen = enumerado(b.origen ?? "escritorio", "origen", ORIGENES);
  const nota = texto(b.nota, "nota", { requerido: false, max: 1000 });
  // El celular nunca se bloquea por stock: siempre se permite, y se marca para revisar.
  const permitirNegativo = boolOpt(b.permitir_stock_negativo) || origen === "celular";

  const cliente = await c.env.DB.prepare(`SELECT id, activo FROM clientes WHERE id = ?`)
    .bind(clienteId)
    .first<{ id: string; activo: number }>();
  if (!cliente) throw new HttpError(404, "El cliente no existe.");

  const itemsIn = Array.isArray(b.items) ? (b.items as any[]) : [];
  if (itemsIn.length === 0) throw new HttpError(400, "La venta tiene que tener al menos un renglón.");

  const items: ItemEntrada[] = itemsIn.map((it, i) => ({
    herramienta_id: uuid(it.herramienta_id, `herramienta del renglón ${i + 1}`),
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
  const pedidoPorH = new Map<string, number>();
  for (const it of items) pedidoPorH.set(it.herramienta_id, (pedidoPorH.get(it.herramienta_id) ?? 0) + it.cantidad);

  // Detectar qué herramientas quedarían en negativo.
  const faltantes: string[] = [];
  for (const [hid, cant] of pedidoPorH) {
    const h = hMap.get(hid)!;
    if (h.stock < cant) faltantes.push(`${h.nombre} (hay ${h.stock}, pedís ${cant})`);
  }
  if (faltantes.length > 0 && !permitirNegativo) {
    throw new HttpError(
      409,
      `No alcanza el stock de: ${faltantes.join("; ")}. Confirmá para vender igual (quedará en negativo).`
    );
  }
  const necesitaRevision = faltantes.length > 0;
  const motivoRevision = necesitaRevision ? `Stock insuficiente: ${faltantes.join("; ")}` : null;

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

  const ventaId = uuidOpt(b.id, "id") ?? crypto.randomUUID();
  const maxRow = await c.env.DB.prepare(`SELECT COALESCE(MAX(numero), 0) AS mnum FROM ventas`).first<{ mnum: number }>();
  const numero = (maxRow?.mnum ?? 0) + 1;
  const creadoEn = texto(b.creado_en, "creado_en", { requerido: false }) ?? ahoraSQL();
  const estado = origen === "celular" ? "sincronizada" : "confirmada";

  // Armar el batch atómico.
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO ventas (id, numero, cliente_id, fecha, subtotal, descuento, total, nota, estado, origen, necesita_revision, motivo_revision, creado_en, sincronizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ventaId, numero, clienteId, fecha, subtotal, descuento, total, nota, estado, origen, necesitaRevision ? 1 : 0, motivoRevision, creadoEn, ahoraSQL())
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
  let pagoId: string | null = null;
  if (b.pago_inicial && Number(b.pago_inicial.monto) > 0) {
    const monto = entero(b.pago_inicial.monto, "pago inicial", { min: 1 });
    const medio = enumerado(b.pago_inicial.medio ?? "efectivo", "medio de pago", MEDIOS);
    pagoId = uuidOpt(b.pago_inicial.id, "id del pago") ?? crypto.randomUUID();
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO pagos (id, cliente_id, venta_id, fecha, monto, medio, nota, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(pagoId, clienteId, ventaId, fecha, monto, medio, texto(b.pago_inicial.nota, "nota del pago", { requerido: false }), creadoEn)
    );
  }

  const resultado = { id: ventaId, numero, necesita_revision: necesitaRevision, pago_id: pagoId };
  if (idempotencyKey) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO operaciones (idempotency_key, tipo, entidad_id, resultado) VALUES (?, 'venta', ?, ?)`
      ).bind(idempotencyKey, ventaId, JSON.stringify(resultado))
    );
  }

  await c.env.DB.batch(stmts);
  return c.json(resultado);
});

/** El dueño revisó la venta (llegada del celular, o marcada para revisar) y le da el ok. */
ventas.post("/:id/confirmar", async (c) => {
  const id = c.req.param("id");
  const venta = await c.env.DB.prepare(`SELECT id, estado FROM ventas WHERE id = ?`).bind(id).first<{ id: string; estado: string }>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  if (venta.estado === "anulada") throw new HttpError(400, "La venta está anulada.");
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE ventas SET estado = 'confirmada', necesita_revision = 0, motivo_revision = NULL WHERE id = ?`).bind(id),
    auditar(c.env, c.get("usuario").usuario, "confirmar_venta", "venta", id),
  ]);
  return c.json({ ok: true });
});

/** Anular: devuelve stock, registra la anulación y libera los pagos imputados. */
ventas.post("/:id/anular", async (c) => {
  const id = c.req.param("id");
  const venta = await c.env.DB.prepare(`SELECT * FROM ventas WHERE id = ?`).bind(id).first<Venta>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  if (venta.estado === "anulada") throw new HttpError(400, "La venta ya está anulada.");

  const items = await c.env.DB.prepare(`SELECT * FROM venta_items WHERE venta_id = ?`)
    .bind(id)
    .all<VentaItem>();

  const fecha = hoy();

  // Reponer stock por herramienta (agregando renglones repetidos).
  const devolverPorH = new Map<string, number>();
  for (const it of items.results ?? []) {
    devolverPorH.set(it.herramienta_id, (devolverPorH.get(it.herramienta_id) ?? 0) + it.cantidad);
  }

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(`UPDATE ventas SET estado = 'anulada', necesita_revision = 0, motivo_revision = NULL WHERE id = ?`).bind(id)
  );

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
  stmts.push(auditar(c.env, c.get("usuario").usuario, "anular_venta", "venta", id, `Venta #${venta.numero} por $${(venta.total / 100).toFixed(2)}`));

  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
