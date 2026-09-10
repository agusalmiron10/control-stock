import { Hono } from "hono";
import type { Env, Variables, Presupuesto, PresupuestoItem, PresupuestoInsumo, Herramienta, Insumo } from "../types";
import { HttpError, texto, entero, cantidad, fechaISO, enumerado, uuid, normalizarBusqueda } from "../validate";
import { requireModulo } from "../config";
import { negocioDe } from "../types";
import { proximoIdPresupuesto } from "../secuencias";

export const presupuestos = new Hono<{ Bindings: Env; Variables: Variables }>();
presupuestos.use("*", requireModulo("presupuestos"));

const ESTADOS = ["pendiente", "aceptado", "rechazado", "vencido"] as const;
const MEDIOS = ["efectivo", "mercado_pago", "tarjeta", "transferencia", "cheque", "otro"] as const;
// ~450KB en base64 — de sobra para una foto o boceto ya comprimido del lado
// del navegador (mismo criterio que la foto de perfil, ver src/routes/auth.ts).
const CROQUIS_MAX_CHARS = 600_000;

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Foto/boceto opcional del trabajo. null si no vino nada. */
function croquisOpt(v: unknown): string | null {
  const t = texto(v, "croquis", { requerido: false, max: CROQUIS_MAX_CHARS });
  if (!t) return null;
  if (!t.startsWith("data:image/")) throw new HttpError(400, "El croquis tiene que subirse como imagen (JPEG o PNG).");
  return t;
}
/** Formato SQLite datetime('now'): "YYYY-MM-DD HH:MM:SS" (UTC). */
function ahoraSQL(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

presupuestos.get("/", async (c) => {
  const estado = c.req.query("estado");
  const buscar = c.req.query("buscar")?.trim();
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");

  const cond: string[] = [];
  const args: unknown[] = [];
  if (estado) { cond.push("p.estado = ?"); args.push(estado); }
  // Busca por nombre de cliente o por número de presupuesto: son las dos
  // formas en que alguien busca uno que ya hizo.
  if (desde) { cond.push("p.fecha >= ?"); args.push(fechaISO(desde, "desde")); }
  if (hasta) { cond.push("p.fecha <= ?"); args.push(fechaISO(hasta, "hasta")); }

  cond.unshift("p.negocio_id = ?");
  args.unshift(negocioDe(c));
  const where = `WHERE ${cond.join(" AND ")}`;

  const rows = await c.env.DB.prepare(
    `SELECT p.*, cl.nombre AS cliente_nombre FROM presupuestos p
     JOIN clientes cl ON cl.id = p.cliente_id
     ${where} ORDER BY p.fecha DESC, p.numero DESC`
  )
    .bind(...args)
    .all<Presupuesto & { cliente_nombre: string }>();

  let lista = rows.results ?? [];
  // Por nombre de cliente (sin acentos) o por número exacto: son las dos
  // formas en que alguien busca un presupuesto que ya hizo.
  if (buscar) {
    const q = normalizarBusqueda(buscar);
    lista = lista.filter(
      (p) => normalizarBusqueda(p.cliente_nombre).includes(q) || String(p.numero) === buscar
    );
  }
  return c.json({ presupuestos: lista });
});

presupuestos.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const p = await c.env.DB.prepare(
    `SELECT p.*, cl.nombre AS cliente_nombre, cl.telefono AS cliente_telefono, v.numero AS venta_numero,
            u.usuario AS atendido_por_nombre, u.foto AS atendido_por_foto
     FROM presupuestos p
     JOIN clientes cl ON cl.id = p.cliente_id
     LEFT JOIN ventas v ON v.id = p.venta_id
     LEFT JOIN usuarios u ON u.id = p.atendido_por AND u.negocio_id = p.negocio_id
     WHERE p.negocio_id = ? AND p.id = ?`
  )
    .bind(negocioDe(c), id)
    .first<Presupuesto & { cliente_nombre: string; cliente_telefono: string | null; venta_numero: number | null; atendido_por_nombre: string | null; atendido_por_foto: string | null }>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");

  const items = await c.env.DB
    .prepare(`SELECT * FROM presupuesto_items WHERE negocio_id = ? AND presupuesto_id = ? ORDER BY id`)
    .bind(negocioDe(c), id)
    .all<PresupuestoItem>();

  const materiales = await c.env.DB
    .prepare(`SELECT * FROM presupuesto_insumos WHERE negocio_id = ? AND presupuesto_id = ? ORDER BY id`)
    .bind(negocioDe(c), id)
    .all<PresupuestoInsumo>();

  return c.json({ presupuesto: p, items: items.results ?? [], insumos: materiales.results ?? [] });
});

interface ItemEntrada {
  herramienta_id: string;
  cantidad: number;
  precio_unitario: number;
}

presupuestos.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const clienteId = uuid(b.cliente_id, "cliente");
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const validoHasta = b.valido_hasta ? fechaISO(b.valido_hasta, "válido hasta") : null;
  const nota = texto(b.nota, "nota", { requerido: false, max: 1000 });
  const croquis = croquisOpt(b.croquis);

  const neg = negocioDe(c);
  const cliente = await c.env.DB.prepare(`SELECT id FROM clientes WHERE negocio_id = ? AND id = ?`)
    .bind(neg, clienteId)
    .first();
  if (!cliente) throw new HttpError(404, "El cliente no existe.");

  const itemsIn = Array.isArray(b.items) ? (b.items as any[]) : [];
  const insumosIn = Array.isArray(b.insumos) ? (b.insumos as any[]) : [];
  // Un presupuesto "a medida" puede no tener ningún renglón de catálogo —
  // sólo materiales de taller y un precio final puesto a mano. Por eso ya
  // no se exige al menos un ítem: se exige al menos ALGO (renglón, insumo,
  // o un precio manual), si no el presupuesto queda vacío.
  if (itemsIn.length === 0 && insumosIn.length === 0 && b.precio_manual == null) {
    throw new HttpError(400, "El presupuesto tiene que tener al menos un renglón, un material, o un precio.");
  }

  const items: ItemEntrada[] = itemsIn.map((it, i) => ({
    herramienta_id: uuid(it.herramienta_id, `herramienta del renglón ${i + 1}`),
    cantidad: entero(it.cantidad, `cantidad del renglón ${i + 1}`, { min: 1 }),
    precio_unitario: entero(it.precio_unitario, `precio del renglón ${i + 1}`, { min: 0 }),
  }));

  const ids = [...new Set(items.map((i) => i.herramienta_id))];
  const placeholders = ids.map(() => "?").join(",");
  const hRows = ids.length
    ? await c.env.DB
        .prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id IN (${placeholders})`)
        .bind(neg, ...ids)
        .all<Herramienta>()
    : { results: [] as Herramienta[] };
  const hMap = new Map((hRows.results ?? []).map((h) => [h.id, h]));
  for (const it of items) {
    if (!hMap.has(it.herramienta_id)) throw new HttpError(404, `La herramienta #${it.herramienta_id} no existe.`);
  }

  interface InsumoEntrada { insumo_id: string; cantidad_requerida: number }
  const bomIn: InsumoEntrada[] = insumosIn.map((it, i) => ({
    insumo_id: uuid(it.insumo_id, `insumo del material ${i + 1}`),
    cantidad_requerida: cantidad(it.cantidad_requerida, `cantidad del material ${i + 1}`, { fraccionada: true, min: 0.001 }),
  }));
  const insumoIds = [...new Set(bomIn.map((i) => i.insumo_id))];
  const iPlaceholders = insumoIds.map(() => "?").join(",");
  const iRows = insumoIds.length
    ? await c.env.DB
        .prepare(`SELECT * FROM insumos WHERE negocio_id = ? AND id IN (${iPlaceholders})`)
        .bind(neg, ...insumoIds)
        .all<Insumo>()
    : { results: [] as Insumo[] };
  const iMap = new Map((iRows.results ?? []).map((i) => [i.id, i]));
  for (const it of bomIn) {
    if (!iMap.has(it.insumo_id)) throw new HttpError(404, `El insumo #${it.insumo_id} no existe.`);
  }

  // Con renglones de catálogo, el total sale de sumarlos (como siempre). Sin
  // renglones (presupuesto a medida), el total lo pone quien lo carga.
  let subtotal: number;
  let descuento = 0;
  if (items.length > 0) {
    subtotal = items.reduce((acc, it) => acc + it.cantidad * it.precio_unitario, 0);
    if (b.descuento && b.descuento.tipo) {
      const tipo = enumerado(b.descuento.tipo, "tipo de descuento", ["monto", "porcentaje"]);
      const valor = Number(b.descuento.valor);
      if (!Number.isFinite(valor) || valor < 0) throw new HttpError(400, "El descuento no es válido.");
      descuento = tipo === "monto" ? Math.round(valor) : Math.round((subtotal * valor) / 100);
    }
    if (descuento > subtotal) descuento = subtotal;
  } else {
    subtotal = entero(b.precio_manual, "precio final", { min: 0 });
  }
  const total = subtotal - descuento;

  // id es AUTOINCREMENT global (ver src/secuencias.ts); numero es la
  // secuencia visible al cliente, y esa sí es por negocio.
  const presupuestoId = await proximoIdPresupuesto(c.env);
  const numRow = await c.env.DB
    .prepare(`SELECT COALESCE(MAX(numero), 0) AS mnum FROM presupuestos WHERE negocio_id = ?`)
    .bind(neg)
    .first<{ mnum: number }>();
  const numero = (numRow?.mnum ?? 0) + 1;

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO presupuestos (id, negocio_id, numero, cliente_id, fecha, subtotal, descuento, total, estado, valido_hasta, nota, atendido_por, croquis)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?)`
    ).bind(presupuestoId, neg, numero, clienteId, fecha, subtotal, descuento, total, validoHasta, nota, c.get("usuario").uid, croquis)
  );
  for (const it of items) {
    const h = hMap.get(it.herramienta_id)!;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO presupuesto_items (negocio_id, presupuesto_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(neg, presupuestoId, it.herramienta_id, h.nombre, it.cantidad, it.precio_unitario, it.cantidad * it.precio_unitario)
    );
  }
  // Sólo se registra la lista de materiales acá — el stock de insumos recién
  // se descuenta al aprobar (ver /:id/insumos/aprobar), no al crear.
  for (const it of bomIn) {
    const ins = iMap.get(it.insumo_id)!;
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO presupuesto_insumos (negocio_id, presupuesto_id, insumo_id, nombre_insumo, cantidad_requerida, costo_unitario)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(neg, presupuestoId, it.insumo_id, ins.nombre, it.cantidad_requerida, ins.costo_unitario)
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

  const neg = negocioDe(c);
  const p = await c.env.DB.prepare(`SELECT * FROM presupuestos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Presupuesto>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");
  if (p.venta_id) throw new HttpError(400, "Este presupuesto ya se convirtió en venta.");

  await c.env.DB.prepare(`UPDATE presupuestos SET estado = ? WHERE negocio_id = ? AND id = ?`)
    .bind(estado, neg, id)
    .run();
  return c.json({ ok: true });
});

/**
 * Convertir un presupuesto en venta real: crea la venta + items + descuenta
 * stock + movimientos + pago inicial opcional, todo en el mismo batch atómico
 * que usa una venta normal. Marca el presupuesto como aceptado.
 * Siempre se hace desde escritorio: la venta resultante nace confirmada.
 */
presupuestos.post("/:id/convertir", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const p = await c.env.DB.prepare(`SELECT * FROM presupuestos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Presupuesto>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");
  if (p.venta_id) throw new HttpError(400, "Este presupuesto ya se convirtió en venta.");
  if (p.estado === "rechazado") throw new HttpError(400, "Este presupuesto está rechazado.");

  const itemsRows = await c.env.DB
    .prepare(`SELECT * FROM presupuesto_items WHERE negocio_id = ? AND presupuesto_id = ?`)
    .bind(neg, id)
    .all<PresupuestoItem>();
  const items = itemsRows.results ?? [];
  if (items.length === 0) throw new HttpError(400, "El presupuesto no tiene renglones.");

  const permitirNegativo = !!b.permitir_stock_negativo;
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const ids = [...new Set(items.map((i) => i.herramienta_id))];
  const placeholders = ids.map(() => "?").join(",");
  const hRows = await c.env.DB
    .prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id IN (${placeholders})`)
    .bind(neg, ...ids)
    .all<Herramienta>();
  const hMap = new Map((hRows.results ?? []).map((h) => [h.id, h]));

  const pedidoPorH = new Map<string, number>();
  for (const it of items) pedidoPorH.set(it.herramienta_id, (pedidoPorH.get(it.herramienta_id) ?? 0) + it.cantidad);

  const faltantes: string[] = [];
  for (const [hid, cant] of pedidoPorH) {
    const h = hMap.get(hid);
    if (h && h.stock < cant) faltantes.push(`${h.nombre} (hay ${h.stock}, pedís ${cant})`);
  }
  if (faltantes.length > 0 && !permitirNegativo) {
    throw new HttpError(
      409,
      `No alcanza el stock de: ${faltantes.join("; ")}. Confirmá para vender igual (quedará en negativo).`
    );
  }
  const necesitaRevision = faltantes.length > 0;
  const motivoRevision = necesitaRevision ? `Stock insuficiente: ${faltantes.join("; ")}` : null;

  const ventaId = crypto.randomUUID();
  const maxRow = await c.env.DB
    .prepare(`SELECT COALESCE(MAX(numero), 0) AS mnum FROM ventas WHERE negocio_id = ?`)
    .bind(neg)
    .first<{ mnum: number }>();
  const numero = (maxRow?.mnum ?? 0) + 1;
  const ahora = ahoraSQL();

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO ventas (id, negocio_id, numero, cliente_id, fecha, subtotal, descuento, total, nota, estado, origen, necesita_revision, motivo_revision, creado_en, sincronizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmada', 'escritorio', ?, ?, ?, ?)`
    ).bind(ventaId, neg, numero, p.cliente_id, fecha, p.subtotal, p.descuento, p.total, `Presupuesto #${p.numero}`, necesitaRevision ? 1 : 0, motivoRevision, ahora, ahora)
  );
  for (const it of items) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO venta_items (negocio_id, venta_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(neg, ventaId, it.herramienta_id, it.nombre_herramienta, it.cantidad, it.precio_unitario, it.subtotal)
    );
  }
  for (const [hid, cant] of pedidoPorH) {
    const h = hMap.get(hid)!;
    const resultante = h.stock - cant;
    stmts.push(c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE negocio_id = ? AND id = ?`)
      .bind(resultante, neg, hid));
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, motivo)
         VALUES (?, ?, ?, 'venta', ?, ?, ?, NULL)`
      ).bind(neg, hid, fecha, -cant, resultante, ventaId)
    );
  }
  if (b.pago_inicial && Number(b.pago_inicial.monto) > 0) {
    const monto = entero(b.pago_inicial.monto, "pago inicial", { min: 1 });
    const medio = enumerado(b.pago_inicial.medio ?? "efectivo", "medio de pago", MEDIOS);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO pagos (id, negocio_id, cliente_id, venta_id, fecha, monto, medio, nota)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), neg, p.cliente_id, ventaId, fecha, monto, medio, "Pago al convertir presupuesto")
    );
  }
  stmts.push(
    c.env.DB.prepare(`UPDATE presupuestos SET estado = 'aceptado', venta_id = ? WHERE negocio_id = ? AND id = ?`)
      .bind(ventaId, neg, id)
  );

  await c.env.DB.batch(stmts);
  return c.json({ venta_id: ventaId, numero });
});

/**
 * Junta cantidad_requerida por insumo (por si el mismo material aparece en
 * más de un renglón del BOM) y trae el stock actual de cada uno.
 */
async function materialesDe(env: Env, neg: string, presupuestoId: number) {
  const rows = await env.DB
    .prepare(`SELECT * FROM presupuesto_insumos WHERE negocio_id = ? AND presupuesto_id = ?`)
    .bind(neg, presupuestoId)
    .all<PresupuestoInsumo>();
  const materiales = rows.results ?? [];

  const pedidoPorInsumo = new Map<string, number>();
  for (const m of materiales) {
    pedidoPorInsumo.set(m.insumo_id, (pedidoPorInsumo.get(m.insumo_id) ?? 0) + m.cantidad_requerida);
  }

  const ids = [...pedidoPorInsumo.keys()];
  if (ids.length === 0) return { pedidoPorInsumo, iMap: new Map<string, Insumo>() };
  const placeholders = ids.map(() => "?").join(",");
  const iRows = await env.DB
    .prepare(`SELECT * FROM insumos WHERE negocio_id = ? AND id IN (${placeholders})`)
    .bind(neg, ...ids)
    .all<Insumo>();
  const iMap = new Map((iRows.results ?? []).map((i) => [i.id, i]));
  return { pedidoPorInsumo, iMap };
}

/**
 * Aprobar el presupuesto a medida: valida que haya stock de CADA material
 * del BOM y, si alcanza, lo descuenta todo junto (mismo criterio que
 * convertir a venta con el catálogo). Si falta alguno, no descuenta nada y
 * dice exactamente cuál — así el que factura sabe qué comprar antes de
 * volver a intentar.
 */
presupuestos.post("/:id/insumos/aprobar", async (c) => {
  const id = Number(c.req.param("id"));
  const neg = negocioDe(c);
  const p = await c.env.DB.prepare(`SELECT * FROM presupuestos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Presupuesto>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");
  if (p.insumos_descontados_en) throw new HttpError(400, "Ya se descontó el stock de materiales de este presupuesto.");

  const { pedidoPorInsumo, iMap } = await materialesDe(c.env, neg, id);
  if (pedidoPorInsumo.size === 0) {
    // Si no hay nada que descontar, marcarlo como "descontado" sólo lograría
    // que después no se pueda borrar. Mejor decir que no hay materiales.
    throw new HttpError(400, "Este presupuesto no tiene materiales cargados.");
  }

  const faltantes: string[] = [];
  for (const [insumoId, cant] of pedidoPorInsumo) {
    const ins = iMap.get(insumoId);
    if (!ins || ins.stock_actual < cant) {
      const disponible = ins?.stock_actual ?? 0;
      const nombre = ins?.nombre ?? insumoId;
      faltantes.push(`${nombre} (hay ${disponible} ${ins?.unidad_medida ?? ""}, hacen falta ${cant})`.trim());
    }
  }
  if (faltantes.length > 0) {
    throw new HttpError(400, `No alcanza el stock de: ${faltantes.join("; ")}.`);
  }

  const stmts: D1PreparedStatement[] = [];
  for (const [insumoId, cant] of pedidoPorInsumo) {
    stmts.push(
      c.env.DB.prepare(`UPDATE insumos SET stock_actual = stock_actual - ? WHERE negocio_id = ? AND id = ?`)
        .bind(cant, neg, insumoId)
    );
  }
  stmts.push(
    c.env.DB.prepare(`UPDATE presupuestos SET estado = 'aceptado', insumos_descontados_en = ? WHERE negocio_id = ? AND id = ?`)
      .bind(ahoraSQL(), neg, id)
  );
  if (stmts.length > 0) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/**
 * Cancelar (rollback): devuelve al stock de insumos exactamente lo que se
 * había descontado al aprobar. Sólo tiene sentido si ya se había descontado.
 */
presupuestos.post("/:id/insumos/cancelar", async (c) => {
  const id = Number(c.req.param("id"));
  const neg = negocioDe(c);
  const p = await c.env.DB.prepare(`SELECT * FROM presupuestos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Presupuesto>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");
  if (!p.insumos_descontados_en) throw new HttpError(400, "Este presupuesto no tiene stock de materiales descontado para revertir.");

  const { pedidoPorInsumo } = await materialesDe(c.env, neg, id);

  const stmts: D1PreparedStatement[] = [];
  for (const [insumoId, cant] of pedidoPorInsumo) {
    stmts.push(
      c.env.DB.prepare(`UPDATE insumos SET stock_actual = stock_actual + ? WHERE negocio_id = ? AND id = ?`)
        .bind(cant, neg, insumoId)
    );
  }
  stmts.push(
    c.env.DB.prepare(`UPDATE presupuestos SET estado = 'rechazado', insumos_descontados_en = NULL WHERE negocio_id = ? AND id = ?`)
      .bind(neg, id)
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/** Eliminar presupuesto (solo si no fue convertido a venta ni tiene materiales descontados). */
presupuestos.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const neg = negocioDe(c);
  const p = await c.env.DB.prepare(`SELECT * FROM presupuestos WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Presupuesto>();
  if (!p) throw new HttpError(404, "Presupuesto no encontrado.");
  if (p.venta_id) throw new HttpError(400, "No se puede eliminar un presupuesto que ya se convirtió en venta.");
  if (p.insumos_descontados_en) {
    throw new HttpError(400, "Este presupuesto tiene materiales descontados — cancelalo primero para devolver el stock.");
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM presupuesto_items WHERE negocio_id = ? AND presupuesto_id = ?`).bind(neg, id),
    c.env.DB.prepare(`DELETE FROM presupuesto_insumos WHERE negocio_id = ? AND presupuesto_id = ?`).bind(neg, id),
    c.env.DB.prepare(`DELETE FROM presupuestos WHERE negocio_id = ? AND id = ?`).bind(neg, id),
  ]);
  return c.json({ ok: true });
});
