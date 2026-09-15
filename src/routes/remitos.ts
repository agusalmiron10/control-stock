/**
 * Remitos: el papel que acompaña a la mercadería cuando sale.
 *
 * Nace siempre de una venta y, para una venta NORMAL, no toca el stock (ya se
 * descontó al vender — ver migrations/0017_remitos.sql). Lo que sí hace
 * siempre es controlar que no se entregue más de lo vendido, sumando lo ya
 * remitado en entregas anteriores.
 *
 * Excepción — venta de ACOPIO (venta.es_acopio, ver src/acopio.ts): ahí el
 * stock físico no bajó al vender, así que el remito de retiro es el momento
 * en que la mercadería realmente sale del depósito. En ese caso SÍ descuenta
 * stock físico al crearse, y lo devuelve si se anula.
 */
import { Hono } from "hono";
import type { Env, Variables, Venta, VentaItem, Herramienta, Remito } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado, uuid, normalizarBusqueda } from "../validate";
import { negocioDe } from "../types";
import { requireModulo, configDe } from "../config";
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
    `SELECT r.*, cl.nombre AS cliente_nombre, v.numero AS venta_numero, v.es_acopio AS venta_es_acopio,
            (SELECT COUNT(*) FROM remito_items ri WHERE ri.negocio_id = r.negocio_id AND ri.remito_id = r.id) AS renglones,
            (SELECT COALESCE(SUM(ri.cantidad), 0) FROM remito_items ri WHERE ri.negocio_id = r.negocio_id AND ri.remito_id = r.id) AS bultos
     FROM remitos r
     JOIN clientes cl ON cl.id = r.cliente_id AND cl.negocio_id = r.negocio_id
     JOIN ventas v    ON v.id = r.venta_id    AND v.negocio_id = r.negocio_id
     WHERE ${cond.join(" AND ")}
     ORDER BY r.fecha DESC, r.numero DESC`
  )
    .bind(...args)
    .all<Remito & { cliente_nombre: string; venta_numero: number; venta_es_acopio: number; renglones: number; bultos: number }>();

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
 * Saldo de acopio de un cliente: qué compró (en ventas de acopio), qué se
 * llevó ya (remitos entregados o pendientes, cuenta igual — lo que importa
 * es que no esté anulado) y qué le falta retirar, por producto y por venta.
 *
 * Es la "cuenta corriente de artículos": la cuenta corriente de PLATA (fiado)
 * ya la resuelve cuenta.ts — acá lo que se debe no es dinero, es mercadería.
 */
remitos.get("/acopio/:clienteId", async (c) => {
  const neg = negocioDe(c);
  const clienteId = c.req.param("clienteId");
  const cfg = await configDe(c);
  if (!cfg.modulos.acopio) throw new HttpError(404, "Esta función no está activa en este negocio.");

  const cliente = await c.env.DB.prepare(`SELECT id, nombre FROM clientes WHERE negocio_id = ? AND id = ?`)
    .bind(neg, clienteId)
    .first<{ id: string; nombre: string }>();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado.");

  // Una fila por (venta, producto): así se puede mostrar desglosado por
  // venta y, sumando en el cliente, el total pendiente de ese producto.
  const filas = await c.env.DB
    .prepare(
      `SELECT v.id AS venta_id, v.numero AS venta_numero, v.fecha AS venta_fecha,
              vi.herramienta_id, vi.nombre_herramienta, SUM(vi.cantidad) AS comprado,
              COALESCE((
                SELECT SUM(ri.cantidad) FROM remito_items ri
                JOIN remitos r ON r.id = ri.remito_id AND r.negocio_id = ri.negocio_id
                WHERE r.negocio_id = vi.negocio_id AND r.venta_id = vi.venta_id
                  AND r.estado != 'anulado' AND ri.herramienta_id = vi.herramienta_id
              ), 0) AS entregado
         FROM venta_items vi
         JOIN ventas v ON v.id = vi.venta_id AND v.negocio_id = vi.negocio_id
        WHERE vi.negocio_id = ? AND v.cliente_id = ? AND v.es_acopio = 1 AND v.estado != 'anulada'
        GROUP BY vi.venta_id, vi.herramienta_id
        ORDER BY v.fecha DESC, v.numero DESC`
    )
    .bind(neg, clienteId)
    .all<{
      venta_id: string; venta_numero: number; venta_fecha: string;
      herramienta_id: string; nombre_herramienta: string; comprado: number; entregado: number;
    }>();

  const lineas = (filas.results ?? []).map((f) => ({
    ...f,
    pendiente: Math.max(0, f.comprado - f.entregado),
  }));

  // Total por producto, cruzando todas las ventas de acopio de este cliente
  // — lo que la pantalla de "saldo pendiente" muestra en primer lugar.
  const porProducto = new Map<string, { herramienta_id: string; nombre_herramienta: string; comprado: number; entregado: number; pendiente: number }>();
  for (const l of lineas) {
    const acc = porProducto.get(l.herramienta_id) ?? {
      herramienta_id: l.herramienta_id, nombre_herramienta: l.nombre_herramienta,
      comprado: 0, entregado: 0, pendiente: 0,
    };
    acc.comprado += l.comprado;
    acc.entregado += l.entregado;
    acc.pendiente += l.pendiente;
    porProducto.set(l.herramienta_id, acc);
  }

  return c.json({
    cliente,
    resumen: [...porProducto.values()].sort((a, b) => b.pendiente - a.pendiente),
    por_venta: lineas,
    tiene_pendiente: lineas.some((l) => l.pendiente > 0),
  });
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

  // En acopio, además de "cuánto falta", el vendedor necesita ver si el
  // físico alcanza para entregar eso: a diferencia de una venta normal, acá
  // nadie garantizó todavía que esa mercadería siga en el depósito.
  let stockFisico = new Map<string, number>();
  if (venta.es_acopio) {
    const ids = [...new Set((items.results ?? []).map((it) => it.herramienta_id))];
    if (ids.length > 0) {
      const hRows = await c.env.DB
        .prepare(`SELECT id, stock FROM herramientas WHERE negocio_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
        .bind(neg, ...ids)
        .all<{ id: string; stock: number }>();
      stockFisico = new Map((hRows.results ?? []).map((h) => [h.id, h.stock]));
    }
  }

  const lineas = (items.results ?? []).map((it) => {
    const entregado = remitado.get(it.herramienta_id) ?? 0;
    const pendiente = Math.max(0, it.cantidad - entregado);
    return {
      herramienta_id: it.herramienta_id,
      nombre_herramienta: it.nombre_herramienta,
      vendido: it.cantidad,
      entregado,
      pendiente,
      stock_fisico: venta.es_acopio ? (stockFisico.get(it.herramienta_id) ?? 0) : null,
    };
  });

  return c.json({
    venta: {
      id: venta.id, numero: venta.numero, fecha: venta.fecha, total: venta.total,
      cliente_id: venta.cliente_id, cliente_nombre: venta.cliente_nombre,
      domicilio: [venta.cliente_direccion, venta.cliente_localidad].filter(Boolean).join(", ") || null,
      es_acopio: !!venta.es_acopio,
    },
    lineas,
    todo_entregado: lineas.every((l) => l.pendiente === 0),
  });
});

remitos.get("/:id", async (c) => {
  const neg = negocioDe(c);
  const r = await c.env.DB.prepare(
    `SELECT r.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono,
            v.numero AS venta_numero, v.fecha AS venta_fecha, v.es_acopio AS venta_es_acopio,
            u.usuario AS atendido_por_nombre, u.foto AS atendido_por_foto
     FROM remitos r
     JOIN clientes cl ON cl.id = r.cliente_id AND cl.negocio_id = r.negocio_id
     JOIN ventas v    ON v.id = r.venta_id    AND v.negocio_id = r.negocio_id
     LEFT JOIN usuarios u ON u.id = r.atendido_por AND u.negocio_id = r.negocio_id
     WHERE r.negocio_id = ? AND r.id = ?`
  )
    .bind(neg, c.req.param("id"))
    .first<any>();
  if (!r) throw new HttpError(404, "Remito no encontrado.");

  // remito_items no guarda precio (a propósito: el remito nació para viajar
  // sin plata). El precio unitario sale de la venta que le dio origen — el
  // remito siempre corresponde a una sola venta, así que alcanza con juntar
  // por producto. El subtotal se recalcula con la cantidad DEL REMITO, no la
  // de la venta: puede ser una entrega parcial.
  const items = await c.env.DB
    .prepare(
      `SELECT ri.*, vi.precio_unitario
       FROM remito_items ri
       LEFT JOIN venta_items vi
         ON vi.negocio_id = ri.negocio_id AND vi.venta_id = ? AND vi.herramienta_id = ri.herramienta_id
       WHERE ri.negocio_id = ? AND ri.remito_id = ?
       ORDER BY ri.rowid`
    )
    .bind(r.venta_id, neg, r.id)
    .all<any>();
  const itemsConPrecio = (items.results ?? []).map((it) => ({
    ...it,
    precio_unitario: it.precio_unitario ?? 0,
    subtotal: it.cantidad * (it.precio_unitario ?? 0),
  }));

  return c.json({ remito: r, items: itemsConPrecio });
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

  // Acopio: acá es donde la mercadería sale de verdad del depósito, así que
  // hace falta el producto en sí — a diferencia de un remito normal, donde el
  // físico ya se había descontado al vender. Se trae el stock actual de una
  // sola vez para validar y, más abajo, para el UPDATE.
  let hEnStock = new Map<string, Herramienta>();
  if (venta.es_acopio) {
    const idsAcopio = pedidos.map((p) => p.herramienta_id);
    const hRows = await c.env.DB
      .prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id IN (${idsAcopio.map(() => "?").join(",")})`)
      .bind(neg, ...idsAcopio)
      .all<Herramienta>();
    hEnStock = new Map((hRows.results ?? []).map((h) => [h.id, h]));

    const faltantes: string[] = [];
    for (const p of pedidos) {
      const h = hEnStock.get(p.herramienta_id);
      if (!h || h.stock < p.cantidad) {
        faltantes.push(`${vendido.get(p.herramienta_id)!.nombre_herramienta} (hay ${h?.stock ?? 0} en depósito, querés retirar ${p.cantidad})`);
      }
    }
    if (faltantes.length > 0) {
      throw new HttpError(409, `No hay suficiente stock físico para retirar: ${faltantes.join("; ")}. Revisá el depósito o ajustá el stock antes de entregar.`);
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
      `INSERT INTO remitos (id, negocio_id, numero, venta_id, cliente_id, fecha, transporte, domicilio, nota, atendido_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      remitoId, neg, numero, ventaId, venta.cliente_id, fecha,
      texto(b.transporte, "transporte", { requerido: false, max: 120 }),
      texto(b.domicilio, "domicilio", { requerido: false, max: 200 }),
      texto(b.nota, "nota", { requerido: false, max: 1000 }),
      c.get("usuario").uid
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

  // Acopio: este remito ES el retiro. El físico baja ahora, con su propio
  // movimiento de stock trazado hasta este remito (para poder revertirlo
  // exacto si se anula — ver el endpoint de anular más abajo).
  if (venta.es_acopio) {
    for (const p of pedidos) {
      const h = hEnStock.get(p.herramienta_id)!;
      const resultante = h.stock - p.cantidad;
      stmts.push(
        c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE negocio_id = ? AND id = ?`)
          .bind(resultante, neg, p.herramienta_id)
      );
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, remito_id, motivo)
           VALUES (?, ?, ?, 'retiro_acopio', ?, ?, ?, ?, ?)`
        ).bind(neg, p.herramienta_id, fecha, -p.cantidad, resultante, ventaId, remitoId, `Retiro de acopio · Remito #${numero}`)
      );
    }
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

/**
 * Anular: libera las cantidades para poder remitarlas de nuevo.
 *
 * Si era un remito de acopio (retiro real de stock físico), además devuelve
 * ese físico al depósito — es la contraparte exacta de lo que se descontó al
 * crearlo. En un remito normal el físico nunca se tocó, así que no hay nada
 * que devolver (igual que hasta ahora).
 */
remitos.post("/:id/anular", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const r = await c.env.DB.prepare(
    `SELECT r.numero, r.estado, r.venta_id, v.es_acopio
       FROM remitos r JOIN ventas v ON v.id = r.venta_id AND v.negocio_id = r.negocio_id
      WHERE r.negocio_id = ? AND r.id = ?`
  )
    .bind(neg, id)
    .first<{ numero: number; estado: string; venta_id: string; es_acopio: number }>();
  if (!r) throw new HttpError(404, "Remito no encontrado.");
  if (r.estado === "anulado") throw new HttpError(400, "El remito ya está anulado.");

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`UPDATE remitos SET estado = 'anulado' WHERE negocio_id = ? AND id = ?`).bind(neg, id),
  ];

  if (r.es_acopio) {
    const fecha = hoy();
    const items = await c.env.DB
      .prepare(`SELECT herramienta_id, cantidad FROM remito_items WHERE negocio_id = ? AND remito_id = ?`)
      .bind(neg, id)
      .all<{ herramienta_id: string; cantidad: number }>();
    for (const it of items.results ?? []) {
      const h = await c.env.DB.prepare(`SELECT stock FROM herramientas WHERE negocio_id = ? AND id = ?`)
        .bind(neg, it.herramienta_id)
        .first<{ stock: number }>();
      const resultante = (h?.stock ?? 0) + it.cantidad;
      stmts.push(
        c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE negocio_id = ? AND id = ?`)
          .bind(resultante, neg, it.herramienta_id)
      );
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, remito_id, motivo)
           VALUES (?, ?, ?, 'anulacion', ?, ?, ?, ?, ?)`
        ).bind(neg, it.herramienta_id, fecha, it.cantidad, resultante, r.venta_id, id, `Anulación de retiro · Remito #${r.numero}`)
      );
    }
  }

  stmts.push(
    auditarDe(c, "anular_remito", "remito", id, `Remito #${r.numero}`, { anterior: { estado: r.estado }, nuevo: { estado: "anulado" } })
  );
  await c.env.DB.batch(stmts);
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
