import { Hono } from "hono";
import type { Env, Variables, Herramienta, MovimientoStock, PrecioHistorial } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado, boolOpt, uuidOpt, normalizarBusqueda } from "../validate";
import { auditarDe } from "../auditoria";
import { requireModulo, configDe } from "../config";
import { negocioDe } from "../types";
import { parsearAlicuota, ALICUOTAS_VALIDAS } from "../facturacion/calculo";

/**
 * Alícuota de IVA por producto, para el alta/edición manual (no la
 * importación masiva, que es más permisiva — ver parsearAlicuota). Acá
 * viene de un <select> del front, así que si no es uno de los valores que
 * ARCA reconoce es un bug, no un typo del usuario: se tira error en vez de
 * guardarlo en silencio como "usar el default".
 */
function alicuotaManual(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = entero(v, "% IVA", { min: 0, max: 2700 });
  if (!ALICUOTAS_VALIDAS.includes(n)) {
    throw new HttpError(400, `"${n / 100}%" no es una alícuota de IVA válida. Usá 0, 2.5, 5, 10.5, 21 o 27.`);
  }
  return n;
}

/**
 * Campos extra del producto (marca, medida, modelo…). Qué campos existen lo
 * decide la capacidad `campos_extra_producto` del rubro, así que acá no se
 * valida contra una lista fija: se guarda lo que venga, saneado.
 *
 * Van en una sola columna JSON y no en una columna por campo justamente para
 * que sumar un rubro con campos nuevos no necesite otra migración.
 */
function datosExtra(valor: unknown): string | null {
  if (valor == null || typeof valor !== "object" || Array.isArray(valor)) return null;
  const limpio: Record<string, string> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length > 40) continue;
    const t = v == null ? "" : String(v).trim().slice(0, 120);
    if (t) limpio[k] = t;
  }
  return Object.keys(limpio).length > 0 ? JSON.stringify(limpio) : null;
}

/**
 * Qué combinación es esta variante: {"talle":"M","color":"negro"}. Las claves
 * las decide la capacidad tipos_variante del rubro, así que igual que con los
 * campos extra acá no se valida contra una lista fija.
 */
function datosVariante(valor: unknown): Record<string, string> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const limpio: Record<string, string> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    const t = v == null ? "" : String(v).trim().slice(0, 60);
    if (k && k.length <= 40 && t) limpio[k.trim()] = t;
  }
  return limpio;
}

export const herramientas = new Hono<{ Bindings: Env; Variables: Variables }>();

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Un empleado no ve el costo (ni por lo tanto el margen). El dueño ve todo. */
function paraRol<T extends { costo: number }>(h: T, rol: string): T {
  if (rol === "dueño") return h;
  return { ...h, costo: 0 };
}

herramientas.get("/", async (c) => {
  const buscar = c.req.query("buscar")?.trim().toLowerCase() ?? "";
  const incluirArchivadas = boolOpt(c.req.query("incluirArchivadas"));
  const rows = await c.env.DB.prepare(
    `SELECT * FROM herramientas WHERE negocio_id = ? AND (? = 1 OR activo = 1) ORDER BY nombre COLLATE NOCASE`
  )
    .bind(negocioDe(c), incluirArchivadas ? 1 : 0)
    .all<Herramienta>();
  let lista = rows.results ?? [];
  if (buscar) {
    const q = normalizarBusqueda(buscar);
    lista = lista.filter(
      (h) => normalizarBusqueda(h.nombre).includes(q) || normalizarBusqueda(h.codigo).includes(q)
    );
  }
  const rol = c.get("usuario").rol;
  const salida: any[] = lista.map((h) => paraRol(h, rol));

  // Los tramos de precio viajan con la lista SÓLO si el negocio los usa: así
  // la pantalla de venta puede aplicarlos sin pedir uno por producto, y el
  // que no tiene la capacidad no carga peso de más.
  const cfg = await configDe(c);
  if (cfg.capacidades.precios_por_escala) {
    const tramos = await c.env.DB
      .prepare(
        `SELECT herramienta_id, desde_cantidad, precio FROM precios_escala
          WHERE negocio_id = ? ORDER BY herramienta_id, desde_cantidad`
      )
      .bind(negocioDe(c))
      .all<{ herramienta_id: string; desde_cantidad: number; precio: number }>();
    const porProducto = new Map<string, { desde_cantidad: number; precio: number }[]>();
    for (const t of tramos.results ?? []) {
      const arr = porProducto.get(t.herramienta_id) ?? [];
      arr.push({ desde_cantidad: t.desde_cantidad, precio: t.precio });
      porProducto.set(t.herramienta_id, arr);
    }
    for (const h of salida) h.escalas = porProducto.get(h.id) ?? [];
  }

  return c.json({ herramientas: salida });
});

herramientas.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const codigo = texto(b.codigo, "código", { max: 40 })!;
  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const precio = entero(b.precio ?? 0, "precio", { min: 0 });
  const precio_mayor = entero(b.precio_mayor ?? 0, "precio mayorista", { min: 0 });
  const rubro = texto(b.rubro, "rubro", { requerido: false, max: 60 });
  const costo = entero(b.costo ?? 0, "costo", { min: 0 });
  const stock = entero(b.stock ?? 0, "stock");
  const stock_minimo = entero(b.stock_minimo ?? 0, "stock mínimo", { min: 0 });
  const iva_porcentaje = alicuotaManual(b.iva_porcentaje);

  const neg = negocioDe(c);
  const dup = await c.env.DB.prepare(`SELECT id FROM herramientas WHERE negocio_id = ? AND codigo = ?`)
    .bind(neg, codigo)
    .first();
  if (dup) throw new HttpError(409, `Ya existe una herramienta con el código "${codigo}".`);

  // El padre tiene que ser de ESTE negocio. Sin este control se podría
  // colgar un producto de uno de otro negocio: no filtraría datos (todas
  // las consultas filtran igual), pero dejaría una referencia inválida
  // cruzando la frontera que separa a un cliente de otro.
  const padreId = uuidOpt(b.padre_id, "producto padre");
  if (padreId) {
    const padre = await c.env.DB
      .prepare(`SELECT id FROM herramientas WHERE negocio_id = ? AND id = ?`)
      .bind(neg, padreId)
      .first();
    if (!padre) throw new HttpError(404, "El producto padre no existe.");
  }

  const id = crypto.randomUUID();
  const fecha = hoy();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO herramientas (id, negocio_id, codigo, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo, notas, datos_extra, vence_el, requiere_serie, padre_id, variante_json, iva_porcentaje)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, neg, codigo, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo, texto(b.notas, "notas", { requerido: false }), datosExtra(b.datos_extra), b.vence_el ? fechaISO(b.vence_el, "vencimiento") : null, boolOpt(b.requiere_serie) ? 1 : 0, padreId, b.variante ? JSON.stringify(datosVariante(b.variante)) : null, iva_porcentaje),
  ];

  // Movimiento de alta con el stock inicial (si hay).
  if (stock !== 0) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo)
         VALUES (?, ?, ?, 'alta', ?, ?, 'Stock inicial')`
      ).bind(neg, id, fecha, stock, stock)
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ id });
});

// ── Mostrador ágil ─────────────────────────────────────────
//
// El ferretero no puede irse de la pantalla de venta para cargar un producto:
// tiene al cliente esperando en el mostrador. Estos dos endpoints existen para
// eso — buscar por lo que dice el lector, y crear en el acto lo que no está.

/**
 * Busca un producto por lo que llegó del lector de código de barras.
 *
 * Busca por EAN y por código interno, porque muchos usan el código de barras
 * como código y muchos otros no cargan el EAN nunca. Se consulta al servidor y
 * no a la lista ya cargada en el navegador para que ande igual con 20.000
 * productos, donde el front no los tiene todos en memoria.
 */
herramientas.get("/por-codigo/:codigo", async (c) => {
  const cod = texto(c.req.param("codigo"), "código", { max: 40 })!;
  const h = await c.env.DB.prepare(
    // El EAN gana si un producto lo tiene y otro usa ese mismo texto como código interno.
    `SELECT * FROM herramientas
     WHERE negocio_id = ?1 AND activo = 1
       AND (codigo_barras = ?2 OR codigo = ?2 COLLATE NOCASE)
     ORDER BY (codigo_barras = ?2) DESC LIMIT 1`
  )
    .bind(negocioDe(c), cod)
    .first<Herramienta>();

  if (!h) return c.json({ encontrada: false, codigo: cod }, 404);
  return c.json({ encontrada: true, herramienta: paraRol(h, c.get("usuario").rol) });
});

/**
 * Alta express desde la caja: nombre, precio y cantidad. Nada más.
 *
 * Todo lo demás (rubro, costo, mínimo, mayorista) se completa después con
 * calma desde la ficha. Pedirlo acá sería la forma más rápida de que el
 * ferretero decida que el sistema le hace perder tiempo y vuelva al cuaderno.
 *
 * El código interno se inventa solo si no vino: es obligatorio en la tabla,
 * pero nadie lo va a pensar con un cliente enfrente.
 */
herramientas.post("/express", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);

  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const precio = entero(b.precio ?? 0, "precio", { min: 0 });
  const stock = entero(b.stock ?? 0, "cantidad", { min: 0 });
  const codigoBarras = texto(b.codigo_barras, "código de barras", { requerido: false, max: 40 });
  const rubro = texto(b.rubro, "rubro", { requerido: false, max: 60 });

  // Si el EAN ya está cargado, esto no es un producto nuevo: es el mismo de
  // antes. Devolverlo en vez de crear un duplicado invisible.
  if (codigoBarras) {
    const ya = await c.env.DB.prepare(
      `SELECT * FROM herramientas WHERE negocio_id = ? AND codigo_barras = ?`
    )
      .bind(neg, codigoBarras)
      .first<Herramienta>();
    if (ya) {
      throw new HttpError(409, `Ese código de barras ya es de "${ya.nombre}".`);
    }
  }

  const codigo = texto(b.codigo, "código", { requerido: false, max: 40 })
    ?? (await codigoLibre(c.env, neg, codigoBarras));

  const dup = await c.env.DB.prepare(`SELECT id FROM herramientas WHERE negocio_id = ? AND codigo = ?`)
    .bind(neg, codigo)
    .first();
  if (dup) throw new HttpError(409, `Ya existe un producto con el código "${codigo}".`);

  const id = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO herramientas (id, negocio_id, codigo, codigo_barras, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 0)`
    ).bind(id, neg, codigo, codigoBarras, nombre, precio, rubro, stock),
  ];
  if (stock !== 0) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo)
         VALUES (?, ?, ?, 'alta', ?, ?, 'Alta rápida en el mostrador')`
      ).bind(neg, id, hoy(), stock, stock)
    );
  }
  stmts.push(
    auditarDe(c, "alta_express", "herramienta", id, `${nombre} (stock ${stock})`)
  );
  await c.env.DB.batch(stmts);

  // El catálogo aprende de lo que se elige: lo más usado sube en las
  // sugerencias del próximo alta.
  if (b.catalogo_id) {
    await c.env.DB
      .prepare(`UPDATE catalogo_maestro SET veces_usado = veces_usado + 1 WHERE id = ?`)
      .bind(entero(b.catalogo_id, "artículo del catálogo", { min: 1 }))
      .run();
  }

  const creada = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Herramienta>();
  return c.json({ herramienta: creada });
});

/**
 * Un código interno que no choque con los que ya hay. Usa el EAN si vino
 * (queda prolijo y es único de por sí); si no, numera correlativo.
 */
async function codigoLibre(env: Env, neg: string, ean: string | null): Promise<string> {
  if (ean) return ean;
  const r = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM herramientas WHERE negocio_id = ?`)
    .bind(neg)
    .first<{ n: number }>();
  let n = (r?.n ?? 0) + 1;
  // El contador puede chocar si antes se borró algo: se corre hasta encontrar uno libre.
  for (let i = 0; i < 200; i++) {
    const cod = `P${String(n).padStart(4, "0")}`;
    const ocupado = await env.DB
      .prepare(`SELECT id FROM herramientas WHERE negocio_id = ? AND codigo = ?`)
      .bind(neg, cod)
      .first();
    if (!ocupado) return cod;
    n++;
  }
  return `P${Date.now()}`;
}

herramientas.put("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const h = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Herramienta>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");

  const codigo = texto(b.codigo, "código", { max: 40 })!;
  const dup = await c.env.DB.prepare(`SELECT id FROM herramientas WHERE negocio_id = ? AND codigo = ? AND id != ?`)
    .bind(neg, codigo, id)
    .first();
  if (dup) throw new HttpError(409, `Ya existe otra herramienta con el código "${codigo}".`);

  // OJO: los precios NO se cambian acá (tienen su propio endpoint con historial).
  await c.env.DB.prepare(
    `UPDATE herramientas SET codigo=?, codigo_barras=?, nombre=?, rubro=?, costo=?, stock_minimo=?, notas=?, datos_extra=?, vence_el=?, requiere_serie=?, iva_porcentaje=?
     WHERE negocio_id=? AND id=?`
  )
    .bind(
      codigo,
      texto(b.codigo_barras, "código de barras", { requerido: false, max: 40 }),
      texto(b.nombre, "nombre", { max: 120 }),
      texto(b.rubro, "rubro", { requerido: false, max: 60 }),
      entero(b.costo ?? h.costo, "costo", { min: 0 }),
      entero(b.stock_minimo ?? h.stock_minimo, "stock mínimo", { min: 0 }),
      texto(b.notas, "notas", { requerido: false }),
      datosExtra(b.datos_extra),
      b.vence_el ? fechaISO(b.vence_el, "vencimiento") : null,
      boolOpt(b.requiere_serie) ? 1 : 0,
      alicuotaManual(b.iva_porcentaje),
      neg,
      id
    )
    .run();
  return c.json({ ok: true });
});

herramientas.post("/:id/archivar", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const activo = boolOpt(b.activar) ? 1 : 0;
  const neg = negocioDe(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE herramientas SET activo = ? WHERE negocio_id = ? AND id = ?`).bind(activo, neg, id),
    auditarDe(c, activo ? "reactivar_herramienta" : "archivar_herramienta", "herramienta", id),
  ]);
  return c.json({ ok: true });
});

/**
 * Producción: fabriqué X unidades, el stock sube.
 * Si viene costo_lote (costo total del lote fabricado, en centavos), se
 * recalcula el costo de la herramienta como PROMEDIO PONDERADO entre el
 * stock que ya tenía (a su costo actual) y el lote nuevo:
 *   costo_nuevo = (stock_actual*costo_actual + cantidad*costo_unit_lote) / (stock_actual + cantidad)
 * Si el stock actual es 0 o negativo, el costo nuevo es directamente el del lote.
 */
herramientas.post("/:id/produccion", requireModulo("produccion"), async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const cantidad = entero(b.cantidad, "cantidad", { min: 1 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const neg = negocioDe(c);
  const h = await c.env.DB.prepare(`SELECT stock, costo FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ stock: number; costo: number }>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");
  const resultante = h.stock + cantidad;

  let costoNuevo = h.costo;
  let costoUnitLote: number | null = null;
  if (b.costo_lote != null) {
    const costoLote = entero(b.costo_lote, "costo del lote", { min: 0 });
    costoUnitLote = Math.round(costoLote / cantidad);
    costoNuevo =
      h.stock > 0
        ? Math.round((h.stock * h.costo + cantidad * costoUnitLote) / resultante)
        : costoUnitLote;
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE herramientas SET stock = ?, costo = ? WHERE negocio_id = ? AND id = ?`)
      .bind(resultante, costoNuevo, neg, id),
    c.env.DB.prepare(
      `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo, costo_unitario)
       VALUES (?, ?, ?, 'produccion', ?, ?, ?, ?)`
    ).bind(neg, id, fecha, cantidad, resultante, texto(b.motivo, "motivo", { requerido: false }), costoUnitLote),
  ]);
  return c.json({ ok: true, stock: resultante, costo: costoNuevo });
});

/** Ajuste: corrige stock por rotura/pérdida/conteo. Motivo obligatorio. */
herramientas.post("/:id/ajuste", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const motivo = texto(b.motivo, "motivo", { requerido: false, max: 300 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const neg = negocioDe(c);
  const h = await c.env.DB.prepare(`SELECT stock FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ stock: number }>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");

  // Dos modos: "delta" (cantidad +/-) o "nuevo" (stock final deseado).
  let cantidad: number;
  if (b.nuevo != null) {
    const nuevo = entero(b.nuevo, "stock nuevo");
    cantidad = nuevo - h.stock;
  } else {
    cantidad = entero(b.cantidad, "cantidad");
  }
  if (cantidad === 0) throw new HttpError(400, "El ajuste no cambia el stock. Revisá el valor.");
  const resultante = h.stock + cantidad;

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE negocio_id = ? AND id = ?`)
      .bind(resultante, neg, id),
    c.env.DB.prepare(
      `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo)
       VALUES (?, ?, ?, 'ajuste', ?, ?, ?)`
    ).bind(neg, id, fecha, cantidad, resultante, motivo),
    auditarDe(c, "ajustar_stock", "herramienta", id,
      `${cantidad > 0 ? "+" : ""}${cantidad} → ${resultante}. ${motivo}`,
      { anterior: { stock: h.stock }, nuevo: { stock: resultante } }),
  ]);
  return c.json({ ok: true, stock: resultante });
});

/** Cambio de precio (minorista y/o mayorista): guarda historial. Las ventas pasadas no se tocan. */
herramientas.post("/:id/precio", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const motivo = texto(b.motivo, "motivo", { requerido: false });

  const neg = negocioDe(c);
  const h = await c.env.DB
    .prepare(`SELECT precio, precio_mayor FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ precio: number; precio_mayor: number }>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");

  const stmts: D1PreparedStatement[] = [];
  let cambio = false;
  // Lo que había y lo que queda, para que la auditoría sirva de prueba y no
  // sólo de aviso de que alguien tocó el precio.
  const antes = { precio: h.precio, precio_mayor: h.precio_mayor };
  const despues = { precio: h.precio, precio_mayor: h.precio_mayor };

  if (b.precio_nuevo != null) {
    const nuevo = entero(b.precio_nuevo, "precio minorista nuevo", { min: 0 });
    if (nuevo !== h.precio) {
      cambio = true;
      despues.precio = nuevo;
      stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio = ? WHERE negocio_id = ? AND id = ?`)
        .bind(nuevo, neg, id));
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO precios_historial (negocio_id, herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
           VALUES (?, ?, ?, ?, ?, 'minorista', ?)`
        ).bind(neg, id, fecha, h.precio, nuevo, motivo)
      );
    }
  }
  if (b.precio_mayor_nuevo != null) {
    const nuevo = entero(b.precio_mayor_nuevo, "precio mayorista nuevo", { min: 0 });
    if (nuevo !== h.precio_mayor) {
      cambio = true;
      despues.precio_mayor = nuevo;
      stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio_mayor = ? WHERE negocio_id = ? AND id = ?`)
        .bind(nuevo, neg, id));
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO precios_historial (negocio_id, herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
           VALUES (?, ?, ?, ?, ?, 'mayorista', ?)`
        ).bind(neg, id, fecha, h.precio_mayor, nuevo, motivo)
      );
    }
  }

  if (!cambio) throw new HttpError(400, "No hay cambios de precio para guardar.");
  stmts.push(auditarDe(c, "cambiar_precio", "herramienta", id, motivo, { anterior: antes, nuevo: despues }));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/**
 * Ajuste masivo de precios por porcentaje.
 * body: { porcentaje, tipo?: 'ambos'|'minorista'|'mayorista', rubro?, redondeo?, motivo? }
 * redondeo en centavos (ej. 10000 = redondear al $100 más cercano; 0/undefined = sin redondeo).
 */
herramientas.post("/ajuste-masivo", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const porcentaje = Number(b.porcentaje);
  if (!Number.isFinite(porcentaje) || porcentaje === 0) {
    throw new HttpError(400, "Ingresá un porcentaje distinto de cero (ej. 12 para +12%, -5 para -5%).");
  }
  const tipo = enumerado(b.tipo ?? "ambos", "tipo de precio", ["ambos", "minorista", "mayorista"]);
  const rubro = b.rubro ? texto(b.rubro, "rubro", { max: 60 }) : null;
  const redondeo = b.redondeo != null ? entero(b.redondeo, "redondeo", { min: 0 }) : 0;
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const motivo = texto(b.motivo, "motivo", { requerido: false }) ?? `Ajuste masivo ${porcentaje > 0 ? "+" : ""}${porcentaje}%`;

  const factor = 1 + porcentaje / 100;
  const nuevoPrecio = (viejo: number): number => {
    if (viejo <= 0) return viejo; // no toca los que están en 0
    let n = Math.round(viejo * factor);
    if (redondeo > 0) n = Math.round(n / redondeo) * redondeo;
    return Math.max(0, n);
  };

  const neg = negocioDe(c);
  const where = rubro
    ? `WHERE negocio_id = ? AND activo = 1 AND rubro = ?`
    : `WHERE negocio_id = ? AND activo = 1`;
  const rows = await c.env.DB.prepare(`SELECT id, precio, precio_mayor FROM herramientas ${where}`)
    .bind(...(rubro ? [neg, rubro] : [neg]))
    .all<{ id: string; precio: number; precio_mayor: number }>();

  const stmts: D1PreparedStatement[] = [];
  let cambiadas = 0;
  for (const h of rows.results ?? []) {
    let toco = false;
    if (tipo !== "mayorista") {
      const np = nuevoPrecio(h.precio);
      if (np !== h.precio) {
        toco = true;
        stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio = ? WHERE negocio_id = ? AND id = ?`)
          .bind(np, neg, h.id));
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO precios_historial (negocio_id, herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
             VALUES (?, ?, ?, ?, ?, 'minorista', ?)`
          ).bind(neg, h.id, fecha, h.precio, np, motivo)
        );
      }
    }
    if (tipo !== "minorista") {
      const nm = nuevoPrecio(h.precio_mayor);
      if (nm !== h.precio_mayor) {
        toco = true;
        stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio_mayor = ? WHERE negocio_id = ? AND id = ?`)
          .bind(nm, neg, h.id));
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO precios_historial (negocio_id, herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
             VALUES (?, ?, ?, ?, ?, 'mayorista', ?)`
          ).bind(neg, h.id, fecha, h.precio_mayor, nm, motivo)
        );
      }
    }
    if (toco) cambiadas++;
  }

  if (stmts.length === 0) {
    throw new HttpError(400, "No hubo precios para ajustar (¿están todos en 0 o no coincide el rubro?).");
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, herramientas_afectadas: cambiadas });
});

/** Rubros distintos (para filtros y ajuste masivo). */
// ── Importación masiva ──────────────────────────────────────
//
// Dar de alta un negocio con 500 productos a mano es una tarde de tipeo, y es
// lo que frena cada cliente nuevo. Acá entra la lista completa de una.
//
// El archivo se parsea en el navegador (ver Herramientas.tsx): acá llegan
// filas ya separadas en columnas. Se hace en dos pasos —previsualizar y
// confirmar— para que nadie le pise los precios a 500 productos sin ver antes
// qué va a pasar.

interface FilaImportada {
  codigo: string;
  nombre: string;
  precio?: number;
  precio_mayor?: number;
  rubro?: string;
  costo?: number;
  stock?: number;
  stock_minimo?: number;
  /** Alícuota de IVA de ESTE producto, en centésimas de punto (2100 = 21%). Ausente = usa el default del negocio. */
  iva_porcentaje?: number;
}

interface FilaRevisada {
  linea: number;
  codigo: string;
  nombre: string;
  accion: "crear" | "actualizar" | "error";
  motivo?: string;
  datos?: FilaImportada;
}

/** Acepta "1234,50", "1234.50", "$ 1.234,50" y devuelve centavos. */
function aCentavos(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  let t = String(valor).trim().replace(/[^0-9.,-]/g, "");
  if (t === "") return null;
  // Si tiene los dos separadores, el último es el decimal.
  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const decimal = ultimaComa > ultimoPunto ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    t = t.split(miles).join("").replace(decimal, ".");
  } else if (ultimaComa >= 0) {
    // Una sola coma: decimal si deja 1 o 2 dígitos ("1234,5"), si no es de miles.
    t = t.length - ultimaComa - 1 <= 2 ? t.replace(",", ".") : t.split(",").join("");
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function aEntero(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = Number(String(valor).trim().replace(/[^0-9-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Revisa las filas contra lo que ya existe, sin escribir nada. */
async function revisarFilas(env: Env, neg: string, filas: any[]): Promise<FilaRevisada[]> {
  const existentes = await env.DB
    .prepare(`SELECT codigo FROM herramientas WHERE negocio_id = ?`)
    .bind(neg)
    .all<{ codigo: string }>();
  // Mapea en minúsculas -> código real, para poder mostrar con cuál coincide.
  const yaHay = new Map((existentes.results ?? []).map((h) => [h.codigo.toLowerCase(), h.codigo]));

  const vistos = new Set<string>();
  return filas.map((f, i): FilaRevisada => {
    const linea = i + 1;
    const codigo = String(f?.codigo ?? "").trim();
    const nombre = String(f?.nombre ?? "").trim();

    if (!codigo && !nombre) return { linea, codigo, nombre, accion: "error", motivo: "Fila vacía." };
    if (!codigo) return { linea, codigo, nombre, accion: "error", motivo: "Le falta el código." };
    if (!nombre) return { linea, codigo, nombre, accion: "error", motivo: "Le falta el nombre." };
    if (codigo.length > 60) return { linea, codigo, nombre, accion: "error", motivo: "El código es demasiado largo." };

    const clave = codigo.toLowerCase();
    if (vistos.has(clave)) {
      return { linea, codigo, nombre, accion: "error", motivo: "El código está repetido dentro del archivo." };
    }
    vistos.add(clave);

    const datos: FilaImportada = {
      codigo,
      nombre: nombre.slice(0, 120),
      precio: aCentavos(f?.precio) ?? undefined,
      precio_mayor: aCentavos(f?.precio_mayor) ?? undefined,
      costo: aCentavos(f?.costo) ?? undefined,
      stock: aEntero(f?.stock) ?? undefined,
      stock_minimo: aEntero(f?.stock_minimo) ?? undefined,
      rubro: f?.rubro ? String(f.rubro).trim().slice(0, 60) : undefined,
      // Permisivo a propósito (ver parsearAlicuota): "21%", "10,5", "Exento"
      // todo entra; lo que no se entiende queda sin alícuota propia — nunca
      // frena la fila por esto.
      iva_porcentaje: parsearAlicuota(f?.iva_porcentaje) ?? undefined,
    };

    const existente = yaHay.get(clave);
    return {
      linea, codigo, nombre, datos,
      accion: existente ? "actualizar" : "crear",
      // Si el código del archivo viene con otra capitalización, se avisa:
      // "hacha" va a actualizar el producto cargado como "HACHA".
      motivo: existente && existente !== codigo ? `Coincide con el código existente "${existente}".` : undefined,
    };
  });
}

/** Paso 1: mostrar qué va a pasar. No escribe nada. */
herramientas.post("/importar/previsualizar", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const filas = Array.isArray(b.filas) ? b.filas : [];
  if (filas.length === 0) throw new HttpError(400, "No llegó ninguna fila para importar.");
  if (filas.length > 5000) throw new HttpError(400, "Son demasiadas filas de una. Partí el archivo en tandas de 5000.");

  const revisadas = await revisarFilas(c.env, negocioDe(c), filas);
  return c.json({
    filas: revisadas,
    resumen: {
      crear: revisadas.filter((r) => r.accion === "crear").length,
      actualizar: revisadas.filter((r) => r.accion === "actualizar").length,
      error: revisadas.filter((r) => r.accion === "error").length,
    },
  });
});

/**
 * Paso 2: escribir. Las filas con error se saltean (ya se avisaron en la
 * previsualización); las demás se crean o se actualizan según el código.
 *
 * Al actualizar sólo se pisan las columnas que vienen en el archivo: si la
 * planilla no trae stock, el stock que ya tenía queda como está. Si no fuera
 * así, importar una lista de precios te borraría todo el stock.
 */
herramientas.post("/importar", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const filas = Array.isArray(b.filas) ? b.filas : [];
  if (filas.length === 0) throw new HttpError(400, "No llegó ninguna fila para importar.");
  if (filas.length > 5000) throw new HttpError(400, "Son demasiadas filas de una. Partí el archivo en tandas de 5000.");

  const neg = negocioDe(c);
  const revisadas = await revisarFilas(c.env, neg, filas);
  const fecha = hoy();
  const stmts: D1PreparedStatement[] = [];
  let creados = 0;
  let actualizados = 0;

  for (const r of revisadas) {
    if (r.accion === "error" || !r.datos) continue;
    const d = r.datos;

    if (r.accion === "crear") {
      const id = crypto.randomUUID();
      const stock = d.stock ?? 0;
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO herramientas (id, negocio_id, codigo, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo, iva_porcentaje)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, neg, d.codigo, d.nombre, d.precio ?? 0, d.precio_mayor ?? 0, d.rubro ?? null,
               d.costo ?? 0, stock, d.stock_minimo ?? 0, d.iva_porcentaje ?? null)
      );
      if (stock !== 0) {
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO movimientos_stock (negocio_id, herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo)
             VALUES (?, ?, ?, 'alta', ?, ?, 'Stock inicial (importación)')`
          ).bind(neg, id, fecha, stock, stock)
        );
      }
      creados++;
    } else {
      // COALESCE: lo que no viene en el archivo se deja como estaba.
      stmts.push(
        c.env.DB.prepare(
          `UPDATE herramientas SET
             nombre = ?,
             precio = COALESCE(?, precio),
             precio_mayor = COALESCE(?, precio_mayor),
             rubro = COALESCE(?, rubro),
             costo = COALESCE(?, costo),
             stock_minimo = COALESCE(?, stock_minimo),
             iva_porcentaje = COALESCE(?, iva_porcentaje)
           WHERE negocio_id = ? AND codigo = ? COLLATE NOCASE`
        ).bind(d.nombre, d.precio ?? null, d.precio_mayor ?? null, d.rubro ?? null,
               d.costo ?? null, d.stock_minimo ?? null, d.iva_porcentaje ?? null, neg, d.codigo)
      );
      actualizados++;
    }
  }

  if (stmts.length === 0) throw new HttpError(400, "Ninguna fila del archivo se pudo importar. Revisá los errores.");

  stmts.push(
    auditarDe(c, "importar_productos", "herramienta", null,
      `${creados} creados, ${actualizados} actualizados`)
  );
  await ejecutarPorLotes(c.env.DB, stmts);

  return c.json({ ok: true, creados, actualizados, omitidos: revisadas.filter((r) => r.accion === "error").length });
});

/**
 * Ejecuta muchos statements en tandas de a LOTE, en vez de un solo
 * `db.batch()` gigante. Con un archivo grande (5000 filas ≈ hasta 10.000
 * statements, contando el alta de stock inicial) un único batch corre el
 * riesgo de pegar contra el límite de tamaño/tiempo de D1 y tirar todo el
 * import abajo sin haber guardado nada. Cada tanda sigue siendo atómica
 * (db.batch() es una transacción), pero entre tandas no lo es: si el Worker
 * se corta a mitad de un import gigante, las tandas ya corridas quedan
 * guardadas. Es la misma garantía que ya daba `revisarFilas` con el código
 * repetido: correr el import de nuevo sólo actualiza lo ya creado, no lo
 * duplica.
 */
async function ejecutarPorLotes(db: D1Database, stmts: D1PreparedStatement[], lote = 200): Promise<void> {
  for (let i = 0; i < stmts.length; i += lote) {
    await db.batch(stmts.slice(i, i + lote));
  }
}

herramientas.get("/rubros", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT rubro FROM herramientas
     WHERE negocio_id = ? AND rubro IS NOT NULL AND rubro != '' ORDER BY rubro`
  ).bind(negocioDe(c)).all<{ rubro: string }>();
  return c.json({ rubros: (rows.results ?? []).map((r) => r.rubro) });
});

/** Ficha completa de un producto: datos, ventas, compradores, movimientos, historial de precios. */
herramientas.get("/:id/ficha", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const h = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Herramienta>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");

  const agg = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(vi.cantidad),0) AS unidades, COALESCE(SUM(vi.subtotal),0) AS total
     FROM venta_items vi JOIN ventas v ON v.id = vi.venta_id
     WHERE vi.negocio_id = ? AND vi.herramienta_id = ? AND v.estado IN ('sincronizada','confirmada')`
  ).bind(neg, id).first<{ unidades: number; total: number }>();

  const compradores = await c.env.DB.prepare(
    `SELECT cl.id AS cliente_id, cl.nombre, SUM(vi.cantidad) AS unidades, SUM(vi.subtotal) AS total
     FROM venta_items vi
     JOIN ventas v ON v.id = vi.venta_id
     JOIN clientes cl ON cl.id = v.cliente_id
     WHERE vi.negocio_id = ? AND vi.herramienta_id = ? AND v.estado IN ('sincronizada','confirmada')
     GROUP BY cl.id ORDER BY unidades DESC`
  ).bind(neg, id).all<{ cliente_id: string; nombre: string; unidades: number; total: number }>();

  const movimientos = await c.env.DB.prepare(
    `SELECT m.*, v.numero AS venta_numero FROM movimientos_stock m
     LEFT JOIN ventas v ON v.id = m.venta_id
     WHERE m.negocio_id = ? AND m.herramienta_id = ? ORDER BY m.fecha DESC, m.id DESC LIMIT 50`
  ).bind(neg, id).all<MovimientoStock & { venta_numero: number | null }>();

  const precios = await c.env.DB.prepare(
    `SELECT * FROM precios_historial WHERE negocio_id = ? AND herramienta_id = ? ORDER BY fecha DESC, id DESC`
  ).bind(neg, id).all<PrecioHistorial>();

  const rol = c.get("usuario").rol;
  const esDueno = rol === "dueño";
  return c.json({
    herramienta: paraRol(h, rol),
    unidades_vendidas: agg?.unidades ?? 0,
    total_vendido: agg?.total ?? 0,
    ganancia_estimada: esDueno ? (agg?.total ?? 0) - (agg?.unidades ?? 0) * h.costo : null,
    valor_stock_costo: esDueno ? h.stock * h.costo : null,
    compradores: compradores.results ?? [],
    movimientos: movimientos.results ?? [],
    historial_precios: precios.results ?? [],
  });
});

herramientas.get("/:id/movimientos", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB.prepare(
    `SELECT m.*, v.numero AS venta_numero FROM movimientos_stock m
     LEFT JOIN ventas v ON v.id = m.venta_id
     WHERE m.negocio_id = ? AND m.herramienta_id = ? ORDER BY m.fecha DESC, m.id DESC`
  )
    .bind(negocioDe(c), id)
    .all<MovimientoStock & { venta_numero: number | null }>();
  return c.json({ movimientos: rows.results ?? [] });
});

herramientas.get("/:id/precios", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB.prepare(
    `SELECT * FROM precios_historial WHERE negocio_id = ? AND herramienta_id = ? ORDER BY fecha DESC, id DESC`
  )
    .bind(negocioDe(c), id)
    .all<PrecioHistorial>();
  return c.json({ historial: rows.results ?? [] });
});

// ── Precio por cantidad (escalas) ────────────────────────────
/**
 * Los tramos de precio de un producto: "de 10 en adelante, $85".
 *
 * Detrás de requireModulo no: la capacidad no es un módulo vendido, es cómo
 * se comporta el rubro. Si el negocio no la tiene prendida simplemente no
 * hay tramos cargados y la lista vuelve vacía.
 */
herramientas.get("/:id/escalas", async (c) => {
  const filas = await c.env.DB
    .prepare(
      `SELECT id, desde_cantidad, precio FROM precios_escala
        WHERE negocio_id = ? AND herramienta_id = ? ORDER BY desde_cantidad`
    )
    .bind(negocioDe(c), c.req.param("id"))
    .all();
  return c.json({ escalas: filas.results ?? [] });
});

/**
 * Reemplaza TODOS los tramos de un producto de una vez.
 *
 * Se pisa la lista entera en lugar de ir tramo por tramo porque es como se
 * edita en pantalla (una tablita) y porque así no puede quedar un estado
 * intermedio raro si se corta a la mitad.
 */
herramientas.put("/:id/escalas", async (c) => {
  const neg = negocioDe(c);
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));

  const h = await c.env.DB.prepare(`SELECT id FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id).first();
  if (!h) throw new HttpError(404, "Producto no encontrado.");

  const crudas = Array.isArray(b.escalas) ? (b.escalas as any[]) : [];
  const tramos = crudas
    .map((e, i) => ({
      desde: entero(e.desde_cantidad, `cantidad del tramo ${i + 1}`, { min: 1 }),
      precio: entero(e.precio, `precio del tramo ${i + 1}`, { min: 0 }),
    }))
    .filter((e) => e.desde > 0);

  // Dos tramos que arrancan en la misma cantidad harían ambiguo el precio.
  const vistos = new Set<number>();
  for (const t of tramos) {
    if (vistos.has(t.desde)) throw new HttpError(400, `Hay dos tramos que arrancan en ${t.desde}. Dejá uno solo.`);
    vistos.add(t.desde);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM precios_escala WHERE negocio_id = ? AND herramienta_id = ?`).bind(neg, id),
    ...tramos.map((t) =>
      c.env.DB.prepare(
        `INSERT INTO precios_escala (id, negocio_id, herramienta_id, desde_cantidad, precio) VALUES (?, ?, ?, ?, ?)`
      ).bind(crypto.randomUUID(), neg, id, t.desde, t.precio)
    ),
    auditarDe(c, "cambiar_escalas", "herramienta", id, `${tramos.length} tramo(s)`),
  ]);
  return c.json({ ok: true });
});

// ── Variantes ────────────────────────────────────────────────
/**
 * Genera las variantes de un producto (talle, color…).
 *
 * Cada variante es un PRODUCTO hijo, con su propio código y su propio stock.
 * Eso es lo que hace que todo lo demás siga funcionando sin cambios: vender,
 * descontar stock, remitar y facturar ya saben trabajar con productos.
 *
 * El padre queda como agrupación: se le pone el stock en 0 porque lo que se
 * vende son los hijos. Si el padre ya tenía stock, no se toca ni se reparte —
 * eso sería adivinar; queda a la vista para que el dueño lo acomode.
 */
herramientas.post("/:id/variantes", async (c) => {
  const neg = negocioDe(c);
  const padreId = c.req.param("id");

  const padre = await c.env.DB
    .prepare(`SELECT * FROM herramientas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, padreId)
    .first<Herramienta & { padre_id: string | null }>();
  if (!padre) throw new HttpError(404, "Producto no encontrado.");
  if (padre.padre_id) throw new HttpError(400, "Ese producto ya es una variante de otro.");

  const b = await c.req.json().catch(() => ({}));
  const pedidas = Array.isArray(b.combinaciones) ? (b.combinaciones as any[]) : [];
  if (pedidas.length === 0) throw new HttpError(400, "No mandaste ninguna combinación.");
  if (pedidas.length > 200) throw new HttpError(400, "Son demasiadas variantes de una vez (máximo 200).");

  // Las que ya existen no se vuelven a crear: este endpoint se usa también
  // para AGREGAR un talle nuevo a un producto que ya tenía variantes.
  const yaEstan = await c.env.DB
    .prepare(`SELECT codigo, variante_json FROM herramientas WHERE negocio_id = ? AND padre_id = ?`)
    .bind(neg, padreId)
    .all<{ codigo: string; variante_json: string | null }>();
  const firmas = new Set(
    (yaEstan.results ?? []).map((v) => JSON.stringify(datosVariante(JSON.parse(v.variante_json ?? "{}"))))
  );

  // Los códigos ocupados, para no volver a numerar desde -01 al agregar un
  // talle nuevo a un producto que ya tiene variantes: ese código ya existe y
  // el choque contra el índice único terminaba en un 500.
  const ocupados = new Set((yaEstan.results ?? []).map((v) => v.codigo));

  const stmts: D1PreparedStatement[] = [];
  const creadas: string[] = [];
  let i = 0;
  for (const cruda of pedidas) {
    const combo = datosVariante(cruda);
    if (Object.keys(combo).length === 0) continue;
    const firma = JSON.stringify(combo);
    if (firmas.has(firma)) continue;
    firmas.add(firma);

    const sufijo = Object.values(combo).join(" · ");
    // El código tiene que ser único dentro del negocio; se numera para no
    // depender de que el sufijo no choque con nada. Se saltean los que ya
    // están tomados (por variantes anteriores o por un código puesto a mano).
    let codigo = "";
    do {
      codigo = `${padre.codigo}-${String(++i).padStart(2, "0")}`;
    } while (ocupados.has(codigo));
    ocupados.add(codigo);
    const id = crypto.randomUUID();
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO herramientas
           (id, negocio_id, codigo, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo, padre_id, variante_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).bind(id, neg, codigo, `${padre.nombre} · ${sufijo}`, padre.precio, padre.precio_mayor,
             padre.rubro, padre.costo, padre.stock_minimo, padreId, firma)
    );
    creadas.push(`${sufijo} (${codigo})`);
  }

  if (stmts.length === 0) throw new HttpError(409, "Esas variantes ya existen.");

  // El padre pasa a ser sólo la agrupación: lo que se vende son los hijos.
  stmts.push(
    c.env.DB.prepare(`UPDATE herramientas SET stock = 0 WHERE negocio_id = ? AND id = ?`).bind(neg, padreId)
  );
  stmts.push(auditarDe(c, "crear_variantes", "herramienta", padreId, creadas.join(", ")));

  await c.env.DB.batch(stmts);
  return c.json({ ok: true, creadas: creadas.length, stock_padre_anterior: padre.stock });
});
