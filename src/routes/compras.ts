/**
 * Compras y proveedores. La contracara de las ventas: acá el stock sube.
 *
 * Al registrar una compra se hacen tres cosas en un solo batch: se guarda la
 * compra con sus renglones, sube el stock de cada producto y se recalcula su
 * costo como promedio ponderado (mismo criterio que Producción, así la
 * ganancia de los reportes sigue siendo comparable). Anular una compra hace
 * exactamente lo inverso.
 */
import { Hono } from "hono";
import type { Env, Variables, Herramienta, Compra, Proveedor } from "../types";
import { HttpError, texto, entero, fechaISO, uuid, uuidOpt, boolOpt } from "../validate";
import { negocioDe } from "../types";
import { requireModulo } from "../config";
import { auditar } from "../auditoria";

export const compras = new Hono<{ Bindings: Env; Variables: Variables }>();
compras.use("*", requireModulo("compras"));

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Proveedores ────────────────────────────────────────────

compras.get("/proveedores", async (c) => {
  const neg = negocioDe(c);
  const incluirArchivados = boolOpt(c.req.query("incluirArchivados"));
  const buscar = c.req.query("buscar")?.trim().toLowerCase() ?? "";

  const rows = await c.env.DB.prepare(
    `SELECT p.*,
            (SELECT COUNT(*) FROM compras co WHERE co.negocio_id = p.negocio_id AND co.proveedor_id = p.id AND co.estado = 'registrada') AS compras_hechas,
            (SELECT COALESCE(SUM(co.total), 0) FROM compras co WHERE co.negocio_id = p.negocio_id AND co.proveedor_id = p.id AND co.estado = 'registrada') AS total_comprado,
            (SELECT MAX(co.fecha) FROM compras co WHERE co.negocio_id = p.negocio_id AND co.proveedor_id = p.id AND co.estado = 'registrada') AS ultima_compra
     FROM proveedores p
     WHERE p.negocio_id = ? AND (? = 1 OR p.activo = 1)
     ORDER BY p.nombre COLLATE NOCASE`
  )
    .bind(neg, incluirArchivados ? 1 : 0)
    .all<Proveedor & { compras_hechas: number; total_comprado: number; ultima_compra: string | null }>();

  let lista = rows.results ?? [];
  if (buscar) lista = lista.filter((p) => p.nombre.toLowerCase().includes(buscar));
  return c.json({ proveedores: lista });
});

compras.post("/proveedores", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const id = uuidOpt(b.id, "id") ?? crypto.randomUUID();

  const repetido = await c.env.DB
    .prepare(`SELECT id FROM proveedores WHERE negocio_id = ? AND nombre = ? COLLATE NOCASE`)
    .bind(neg, nombre)
    .first();
  if (repetido) throw new HttpError(409, `Ya tenés un proveedor que se llama "${nombre}".`);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO proveedores (id, negocio_id, nombre, telefono, email, direccion, cuit, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, neg, nombre,
      texto(b.telefono, "teléfono", { requerido: false, max: 60 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      texto(b.direccion, "dirección", { requerido: false }),
      texto(b.cuit, "CUIT", { requerido: false, max: 20 }),
      texto(b.notas, "notas", { requerido: false, max: 1000 })
    ),
    auditar(c.env, neg, c.get("usuario").usuario, "crear_proveedor", "proveedor", id, nombre),
  ]);
  return c.json({ id });
});

compras.put("/proveedores/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const existe = await c.env.DB.prepare(`SELECT id FROM proveedores WHERE negocio_id = ? AND id = ?`).bind(neg, id).first();
  if (!existe) throw new HttpError(404, "Proveedor no encontrado.");

  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const repetido = await c.env.DB
    .prepare(`SELECT id FROM proveedores WHERE negocio_id = ? AND nombre = ? COLLATE NOCASE AND id != ?`)
    .bind(neg, nombre, id)
    .first();
  if (repetido) throw new HttpError(409, `Ya tenés otro proveedor que se llama "${nombre}".`);

  await c.env.DB.prepare(
    `UPDATE proveedores SET nombre=?, telefono=?, email=?, direccion=?, cuit=?, notas=? WHERE negocio_id=? AND id=?`
  )
    .bind(
      nombre,
      texto(b.telefono, "teléfono", { requerido: false, max: 60 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      texto(b.direccion, "dirección", { requerido: false }),
      texto(b.cuit, "CUIT", { requerido: false, max: 20 }),
      texto(b.notas, "notas", { requerido: false, max: 1000 }),
      neg, id
    )
    .run();
  return c.json({ ok: true });
});

/** Archivar / reactivar. No se borra: las compras viejas lo siguen nombrando. */
compras.post("/proveedores/:id/archivar", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const activo = boolOpt(b.activar) ? 1 : 0;
  const neg = negocioDe(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE proveedores SET activo = ? WHERE negocio_id = ? AND id = ?`).bind(activo, neg, id),
    auditar(c.env, neg, c.get("usuario").usuario, activo ? "reactivar_proveedor" : "archivar_proveedor", "proveedor", id),
  ]);
  return c.json({ ok: true });
});

// ── Compras ────────────────────────────────────────────────

compras.get("/", async (c) => {
  const neg = negocioDe(c);
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");
  const proveedorId = c.req.query("proveedor_id");

  const cond = ["co.negocio_id = ?"];
  const args: unknown[] = [neg];
  if (desde) { cond.push("co.fecha >= ?"); args.push(fechaISO(desde, "desde")); }
  if (hasta) { cond.push("co.fecha <= ?"); args.push(fechaISO(hasta, "hasta")); }
  if (proveedorId) { cond.push("co.proveedor_id = ?"); args.push(uuid(proveedorId, "proveedor")); }

  const rows = await c.env.DB.prepare(
    `SELECT co.*, p.nombre AS proveedor_nombre,
            (SELECT COUNT(*) FROM compra_items ci WHERE ci.negocio_id = co.negocio_id AND ci.compra_id = co.id) AS renglones
     FROM compras co
     JOIN proveedores p ON p.id = co.proveedor_id AND p.negocio_id = co.negocio_id
     WHERE ${cond.join(" AND ")}
     ORDER BY co.fecha DESC, co.numero DESC`
  )
    .bind(...args)
    .all<Compra & { proveedor_nombre: string; renglones: number }>();

  const lista = rows.results ?? [];
  const total = lista.filter((x) => x.estado === "registrada").reduce((s, x) => s + x.total, 0);
  return c.json({ compras: lista, total_periodo: total });
});

compras.get("/:id", async (c) => {
  const neg = negocioDe(c);
  const compra = await c.env.DB.prepare(
    `SELECT co.*, p.nombre AS proveedor_nombre, p.telefono AS proveedor_telefono, p.cuit AS proveedor_cuit
     FROM compras co
     JOIN proveedores p ON p.id = co.proveedor_id AND p.negocio_id = co.negocio_id
     WHERE co.negocio_id = ? AND co.id = ?`
  )
    .bind(neg, c.req.param("id"))
    .first<Compra & { proveedor_nombre: string }>();
  if (!compra) throw new HttpError(404, "Compra no encontrada.");

  const items = await c.env.DB
    .prepare(`SELECT * FROM compra_items WHERE negocio_id = ? AND compra_id = ? ORDER BY rowid`)
    .bind(neg, compra.id)
    .all();
  return c.json({ compra, items: items.results ?? [] });
});

interface ItemCompra { herramienta_id: string; cantidad: number; costo_unitario: number }

compras.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const proveedorId = uuid(b.proveedor_id, "proveedor");
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const proveedor = await c.env.DB.prepare(`SELECT id, nombre FROM proveedores WHERE negocio_id = ? AND id = ?`)
    .bind(neg, proveedorId)
    .first<{ id: string; nombre: string }>();
  if (!proveedor) throw new HttpError(404, "El proveedor no existe.");

  const itemsIn = Array.isArray(b.items) ? (b.items as any[]) : [];
  if (itemsIn.length === 0) throw new HttpError(400, "La compra tiene que tener al menos un renglón.");
  const items: ItemCompra[] = itemsIn.map((it, i) => ({
    herramienta_id: uuid(it.herramienta_id, `producto del renglón ${i + 1}`),
    cantidad: entero(it.cantidad, `cantidad del renglón ${i + 1}`, { min: 1 }),
    costo_unitario: entero(it.costo_unitario, `costo del renglón ${i + 1}`, { min: 0 }),
  }));

  const ids = [...new Set(items.map((i) => i.herramienta_id))];
  const hRows = await c.env.DB
    .prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(neg, ...ids)
    .all<Herramienta>();
  const hMap = new Map((hRows.results ?? []).map((h) => [h.id, h]));
  for (const it of items) {
    if (!hMap.has(it.herramienta_id)) throw new HttpError(404, "Uno de los productos de la compra no existe.");
  }

  const total = items.reduce((s, it) => s + it.cantidad * it.costo_unitario, 0);
  const compraId = crypto.randomUUID();

  const ultimo = await c.env.DB.prepare(`SELECT COALESCE(MAX(numero), 0) AS n FROM compras WHERE negocio_id = ?`)
    .bind(neg)
    .first<{ n: number }>();
  const numero = (ultimo?.n ?? 0) + 1;

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO compras (id, negocio_id, numero, proveedor_id, fecha, comprobante, total, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      compraId, neg, numero, proveedorId, fecha,
      texto(b.comprobante, "comprobante", { requerido: false, max: 60 }),
      total,
      texto(b.nota, "nota", { requerido: false, max: 1000 })
    ),
  ];

  // Agrupado por producto: si el mismo aparece en dos renglones, el stock y el
  // costo se calculan una sola vez sobre el total, no dos veces en cascada.
  const porProducto = new Map<string, { cantidad: number; costoTotal: number }>();
  for (const it of items) {
    const acc = porProducto.get(it.herramienta_id) ?? { cantidad: 0, costoTotal: 0 };
    acc.cantidad += it.cantidad;
    acc.costoTotal += it.cantidad * it.costo_unitario;
    porProducto.set(it.herramienta_id, acc);
  }

  for (const it of items) {
    const h = hMap.get(it.herramienta_id)!;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO compra_items (id, negocio_id, compra_id, herramienta_id, nombre_herramienta, cantidad, costo_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), neg, compraId, h.id, h.nombre, it.cantidad, it.costo_unitario, it.cantidad * it.costo_unitario)
    );
  }

  for (const [hid, acc] of porProducto) {
    const h = hMap.get(hid)!;
    const resultante = h.stock + acc.cantidad;
    // Costo promedio ponderado: mezcla lo que ya había con lo que entra.
    const costoLote = Math.round(acc.costoTotal / acc.cantidad);
    const costoNuevo = h.stock > 0 ? Math.round((h.stock * h.costo + acc.costoTotal) / resultante) : costoLote;
    stmts.push(
      c.env.DB.prepare(`UPDATE herramientas SET stock = ?, costo = ? WHERE negocio_id = ? AND id = ?`)
        .bind(resultante, costoNuevo, neg, hid),
      c.env.DB.prepare(
        `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, compra_id, motivo, costo_unitario)
         VALUES (?, ?, ?, 'compra', ?, ?, ?, ?, ?)`
      ).bind(neg, hid, fecha, acc.cantidad, resultante, compraId, `Compra #${numero} — ${proveedor.nombre}`, costoLote)
    );
  }

  stmts.push(
    auditar(c.env, neg, c.get("usuario").usuario, "registrar_compra", "compra", compraId,
      `Compra #${numero} a ${proveedor.nombre} por ${(total / 100).toFixed(2)}`)
  );

  await c.env.DB.batch(stmts);
  return c.json({ id: compraId, numero, total });
});

/** Anular: devuelve el stock que había entrado. El costo promedio no se
 *  recalcula hacia atrás — se deja el actual, igual que en las ventas. */
compras.post("/:id/anular", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const compra = await c.env.DB.prepare(`SELECT * FROM compras WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Compra>();
  if (!compra) throw new HttpError(404, "Compra no encontrada.");
  if (compra.estado === "anulada") throw new HttpError(400, "La compra ya está anulada.");

  const items = await c.env.DB
    .prepare(`SELECT herramienta_id, SUM(cantidad) AS cantidad FROM compra_items
              WHERE negocio_id = ? AND compra_id = ? GROUP BY herramienta_id`)
    .bind(neg, id)
    .all<{ herramienta_id: string; cantidad: number }>();

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE compras SET estado = 'anulada' WHERE negocio_id = ? AND id = ?`).bind(neg, id),
  ];

  for (const it of items.results ?? []) {
    const h = await c.env.DB.prepare(`SELECT stock FROM herramientas WHERE negocio_id = ? AND id = ?`)
      .bind(neg, it.herramienta_id)
      .first<{ stock: number }>();
    if (!h) continue;
    const resultante = h.stock - it.cantidad;
    stmts.push(
      c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE negocio_id = ? AND id = ?`)
        .bind(resultante, neg, it.herramienta_id),
      c.env.DB.prepare(
        `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, compra_id, motivo)
         VALUES (?, ?, ?, 'anulacion_compra', ?, ?, ?, ?)`
      ).bind(neg, it.herramienta_id, hoy(), -it.cantidad, resultante, id, `Anulación de la compra #${compra.numero}`)
    );
  }

  stmts.push(auditar(c.env, neg, c.get("usuario").usuario, "anular_compra", "compra", id, `Compra #${compra.numero}`));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/**
 * Borrar una compra. Sólo si está anulada.
 *
 * Anular ya devolvió el stock; borrar sólo la saca de la lista. Pedir que
 * esté anulada primero garantiza que el stock quedó como corresponde antes de
 * que el registro desaparezca — si se pudiera borrar directo, el stock que
 * entró con esa compra quedaría inflado para siempre y sin rastro de por qué.
 */
compras.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const co = await c.env.DB.prepare(`SELECT numero, estado FROM compras WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ numero: number; estado: string }>();
  if (!co) throw new HttpError(404, "Compra no encontrada.");
  if (co.estado !== "anulada") {
    throw new HttpError(400, "Para borrar una compra primero hay que anularla, así el stock vuelve a como estaba.");
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM movimientos_stock WHERE negocio_id = ? AND compra_id = ?`).bind(neg, id),
    c.env.DB.prepare(`DELETE FROM compra_items WHERE negocio_id = ? AND compra_id = ?`).bind(neg, id),
    c.env.DB.prepare(`DELETE FROM compras WHERE negocio_id = ? AND id = ?`).bind(neg, id),
    auditar(c.env, neg, c.get("usuario").usuario, "borrar_compra", "compra", id, `Compra #${co.numero}`),
  ]);
  return c.json({ ok: true });
});
