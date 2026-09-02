/**
 * Remitos: el papel que acompaña a la mercadería cuando sale.
 *
 * Nace siempre de una venta y NO toca el stock (ya se descontó al vender —
 * ver migrations/0017_remitos.sql). Lo que sí hace es controlar que no se
 * entregue más de lo vendido, sumando lo ya remitado en entregas anteriores.
 */
import { Hono } from "hono";
import type { Env, Variables, Venta, VentaItem, Remito } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado, uuid, normalizarBusqueda } from "../validate";
import { negocioDe } from "../types";
import { requireModulo } from "../config";
import { auditarDe } from "../auditoria";

export const remitos = new Hono<{ Bindings: Env; Variables: Variables }>();
remitos.use("*", requireModulo("remitos"));

const ESTADOS = ["pendiente", "entregado", "anulado"] as const;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Cuánto de cada producto de una venta ya se remitó (sin contar los anulados
 * ni, si se pasa, un remito puntual — para poder recalcular al editar).
 */
async function yaRemitado(
  env: Env,
  neg: string,
  ventaId: string,
  excepto?: string
): Promise<Map<string, number>> {
  const filas = await env.DB
    .prepare(
      `SELECT ri.herramienta_id, SUM(ri.cantidad) AS cant
       FROM remito_items ri
       JOIN remitos r ON r.id = ri.remito_id AND r.negocio_id = ri.negocio_id
       WHERE ri.negocio_id = ? AND r.venta_id = ? AND r.estado != 'anulado'
         AND (? IS NULL OR r.id != ?)
       GROUP BY ri.herramienta_id`
    )
    .bind(neg, ventaId, excepto ?? null, excepto ?? null)
    .all<{ herramienta_id: string; cant: number }>();
  return new Map((filas.results ?? []).map((f) => [f.herramienta_id, f.cant]));
}

// ── Listado ────────────────────────────────────────────────

remitos.get("/", async (c) => {
  const neg = negocioDe(c);
  const estado = c.req.query("estado");
  const buscar = c.req.query("buscar")?.trim();
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");

  const cond = ["r.negocio_id = ?"];
  const args: unknown[] = [neg];
  if (estado) { cond.push("r.estado = ?"); args.push(enumerado(estado, "estado", ESTADOS)); }
  if (desde) { cond.push("r.fecha >= ?"); args.push(fechaISO(desde, "desde")); }
  if (hasta) { cond.push("r.fecha <= ?"); args.push(fechaISO(hasta, "hasta")); }

  const rows = await c.env.DB.prepare(
    `SELECT r.*, cl.nombre AS cliente_nombre, v.numero AS venta_numero,
            (SELECT COUNT(*) FROM remito_items ri WHERE ri.negocio_id = r.negocio_id AND ri.remito_id = r.id) AS renglones,
            (SELECT COALESCE(SUM(ri.cantidad), 0) FROM remito_items ri WHERE ri.negocio_id = r.negocio_id AND ri.remito_id = r.id) AS bultos
     FROM remitos r
     JOIN clientes cl ON cl.id = r.cliente_id AND cl.negocio_id = r.negocio_id
     JOIN ventas v    ON v.id = r.venta_id    AND v.negocio_id = r.negocio_id
     WHERE ${cond.join(" AND ")}
     ORDER BY r.fecha DESC, r.numero DESC`
  )
    .bind(...args)
    .all<Remito & { cliente_nombre: string; venta_numero: number; renglones: number; bultos: number }>();

  let lista = rows.results ?? [];
  // Por nombre de cliente (sin acentos) o por número de remito.
  if (buscar) {
    const q = normalizarBusqueda(buscar);
    lista = lista.filter(
      (r) => normalizarBusqueda(r.cliente_nombre).includes(q) || String(r.numero) === buscar
    );
  }
  return c.json({ remitos: lista });
});

/**
 * Qué queda por entregar de una venta. Es lo que necesita la pantalla para
 * proponer un remito nuevo sin que nadie tenga que hacer la resta a mano.
 */
remitos.get("/pendiente-de/:ventaId", async (c) => {
  const neg = negocioDe(c);
  const ventaId = c.req.param("ventaId");

  const venta = await c.env.DB.prepare(
    `SELECT v.*, cl.nombre AS cliente_nombre, cl.direccion AS cliente_direccion, cl.localidad AS cliente_localidad
     FROM ventas v JOIN clientes cl ON cl.id = v.cliente_id AND cl.negocio_id = v.negocio_id
     WHERE v.negocio_id = ? AND v.id = ?`
  )
    .bind(neg, ventaId)
    .first<any>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  if (venta.estado === "anulada") throw new HttpError(400, "La venta está anulada.");

  const items = await c.env.DB
    .prepare(`SELECT * FROM venta_items WHERE negocio_id = ? AND venta_id = ? ORDER BY id`)
    .bind(neg, ventaId)
    .all<VentaItem>();
  const remitado = await yaRemitado(c.env, neg, ventaId);

  const lineas = (items.results ?? []).map((it) => {
    const entregado = remitado.get(it.herramienta_id) ?? 0;
    return {
      herramienta_id: it.herramienta_id,
      nombre_herramienta: it.nombre_herramienta,
      vendido: it.cantidad,
      entregado,
      pendiente: Math.max(0, it.cantidad - entregado),
    };
  });

  return c.json({
    venta: {
      id: venta.id, numero: venta.numero, fecha: venta.fecha, total: venta.total,
      cliente_id: venta.cliente_id, cliente_nombre: venta.cliente_nombre,
      domicilio: [venta.cliente_direccion, venta.cliente_localidad].filter(Boolean).join(", ") || null,
    },
    lineas,
    todo_entregado: lineas.every((l) => l.pendiente === 0),
  });
});

remitos.get("/:id", async (c) => {
  const neg = negocioDe(c);
  const r = await c.env.DB.prepare(
    `SELECT r.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
            v.numero AS venta_numero, v.fecha AS venta_fecha
     FROM remitos r
     JOIN clientes cl ON cl.id = r.cliente_id AND cl.negocio_id = r.negocio_id
     JOIN ventas v    ON v.id = r.venta_id    AND v.negocio_id = r.negocio_id
     WHERE r.negocio_id = ? AND r.id = ?`
  )
    .bind(neg, c.req.param("id"))
    .first<any>();
  if (!r) throw new HttpError(404, "Remito no encontrado.");

  const items = await c.env.DB
    .prepare(`SELECT * FROM remito_items WHERE negocio_id = ? AND remito_id = ? ORDER BY rowid`)
    .bind(neg, r.id)
    .all();

  return c.json({ remito: r, items: items.results ?? [] });
});

// ── Alta ───────────────────────────────────────────────────

remitos.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const ventaId = uuid(b.venta_id, "venta");

  const venta = await c.env.DB.prepare(`SELECT * FROM ventas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, ventaId)
    .first<Venta>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  if (venta.estado === "anulada") throw new HttpError(400, "No se puede remitar una venta anulada.");
  if (venta.estado === "borrador") throw new HttpError(400, "La venta todavía no está confirmada.");

  const itemsIn = Array.isArray(b.items) ? (b.items as any[]) : [];
  const pedidos = itemsIn
    .map((it, i) => ({
      herramienta_id: uuid(it.herramienta_id, `producto del renglón ${i + 1}`),
      cantidad: entero(it.cantidad, `cantidad del renglón ${i + 1}`, { min: 0 }),
    }))
    .filter((it) => it.cantidad > 0);
  if (pedidos.length === 0) throw new HttpError(400, "El remito tiene que llevar al menos un producto.");

  // Control central: no se puede entregar más de lo vendido, contando lo que
  // ya salió en remitos anteriores.
  const vItems = await c.env.DB
    .prepare(`SELECT * FROM venta_items WHERE negocio_id = ? AND venta_id = ?`)
    .bind(neg, ventaId)
    .all<VentaItem>();
  const vendido = new Map<string, VentaItem>();
  for (const it of vItems.results ?? []) {
    const previo = vendido.get(it.herramienta_id);
    if (previo) previo.cantidad += it.cantidad;
    else vendido.set(it.herramienta_id, { ...it });
  }
  const remitado = await yaRemitado(c.env, neg, ventaId);

  for (const p of pedidos) {
    const v = vendido.get(p.herramienta_id);
    if (!v) throw new HttpError(400, "Hay un producto que no pertenece a esta venta.");
    const disponible = v.cantidad - (remitado.get(p.herramienta_id) ?? 0);
    if (p.cantidad > disponible) {
      throw new HttpError(
        400,
        `De "${v.nombre_herramienta}" quedan ${disponible} por entregar y estás poniendo ${p.cantidad}.`
      );
    }
  }

  const ultimo = await c.env.DB.prepare(`SELECT COALESCE(MAX(numero), 0) AS n FROM remitos WHERE negocio_id = ?`)
    .bind(neg)
    .first<{ n: number }>();
  const numero = (ultimo?.n ?? 0) + 1;
  const remitoId = crypto.randomUUID();
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO remitos (id, negocio_id, numero, venta_id, cliente_id, fecha, transporte, domicilio, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      remitoId, neg, numero, ventaId, venta.cliente_id, fecha,
      texto(b.transporte, "transporte", { requerido: false, max: 120 }),
      texto(b.domicilio, "domicilio", { requerido: false, max: 200 }),
      texto(b.nota, "nota", { requerido: false, max: 1000 })
    ),
  ];
  for (const p of pedidos) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO remito_items (id, negocio_id, remito_id, herramienta_id, nombre_herramienta, cantidad)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), neg, remitoId, p.herramienta_id,
             vendido.get(p.herramienta_id)!.nombre_herramienta, p.cantidad)
    );
  }
  stmts.push(
    auditarDe(c, "crear_remito", "remito", remitoId,
      `Remito #${numero} · Venta #${venta.numero}`)
  );

  await c.env.DB.batch(stmts);
  return c.json({ id: remitoId, numero });
});

/** Marcar entregado (con quién firmó) o volver a pendiente. */
remitos.post("/:id/estado", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const estado = enumerado(b.estado, "estado", ESTADOS);

  const r = await c.env.DB.prepare(`SELECT numero, estado FROM remitos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ numero: number; estado: string }>();
  if (!r) throw new HttpError(404, "Remito no encontrado.");
  if (r.estado === "anulado") throw new HttpError(400, "El remito está anulado.");

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE remitos SET estado = ?, recibido_por = ?,
         entregado_en = CASE WHEN ? = 'entregado' THEN datetime('now') ELSE NULL END
       WHERE negocio_id = ? AND id = ?`
    ).bind(estado, texto(b.recibido_por, "recibido por", { requerido: false, max: 120 }), estado, neg, id),
    auditarDe(c, "estado_remito", "remito", id, `Remito #${r.numero} → ${estado}`),
  ]);
  return c.json({ ok: true });
});

/** Anular: libera las cantidades para poder remitarlas de nuevo. */
remitos.post("/:id/anular", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const r = await c.env.DB.prepare(`SELECT numero, estado FROM remitos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ numero: number; estado: string }>();
  if (!r) throw new HttpError(404, "Remito no encontrado.");
  if (r.estado === "anulado") throw new HttpError(400, "El remito ya está anulado.");

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE remitos SET estado = 'anulado' WHERE negocio_id = ? AND id = ?`).bind(neg, id),
    auditarDe(c, "anular_remito", "remito", id, `Remito #${r.numero}`, { anterior: { estado: r.estado }, nuevo: { estado: "anulado" } }),
  ]);
  return c.json({ ok: true });
});

/**
 * Borrar un remito. Sólo si está anulado.
 *
 * Anular ya libera las cantidades para volver a remitarlas, así que borrar es
 * puramente para limpiar: sacar de la lista un remito que se cargó mal o de
 * prueba. Exigir que esté anulado primero evita que alguien haga desaparecer
 * de un clic la constancia de una entrega que sí ocurrió.
 */
remitos.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const r = await c.env.DB.prepare(`SELECT numero, estado FROM remitos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ numero: number; estado: string }>();
  if (!r) throw new HttpError(404, "Remito no encontrado.");
  if (r.estado !== "anulado") {
    throw new HttpError(400, "Para borrar un remito primero hay que anularlo. Así queda claro que la entrega no va.");
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM remito_items WHERE negocio_id = ? AND remito_id = ?`).bind(neg, id),
    c.env.DB.prepare(`DELETE FROM remitos WHERE negocio_id = ? AND id = ?`).bind(neg, id),
    auditarDe(c, "borrar_remito", "remito", id, `Remito #${r.numero}`),
  ]);
  return c.json({ ok: true });
});
