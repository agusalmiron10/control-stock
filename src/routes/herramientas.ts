import { Hono } from "hono";
import type { Env, Variables, Herramienta, MovimientoStock, PrecioHistorial } from "../types";
import { HttpError, texto, entero, fechaISO, enumerado, boolOpt } from "../validate";

export const herramientas = new Hono<{ Bindings: Env; Variables: Variables }>();

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

herramientas.get("/", async (c) => {
  const buscar = c.req.query("buscar")?.trim().toLowerCase() ?? "";
  const incluirArchivadas = boolOpt(c.req.query("incluirArchivadas"));
  const rows = await c.env.DB.prepare(
    `SELECT * FROM herramientas WHERE (? = 1 OR activo = 1) ORDER BY nombre COLLATE NOCASE`
  )
    .bind(incluirArchivadas ? 1 : 0)
    .all<Herramienta>();
  let lista = rows.results ?? [];
  if (buscar) {
    lista = lista.filter(
      (h) => h.nombre.toLowerCase().includes(buscar) || h.codigo.toLowerCase().includes(buscar)
    );
  }
  return c.json({ herramientas: lista });
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

  const dup = await c.env.DB.prepare(`SELECT id FROM herramientas WHERE codigo = ?`).bind(codigo).first();
  if (dup) throw new HttpError(409, `Ya existe una herramienta con el código "${codigo}".`);

  const fecha = hoy();
  const res = await c.env.DB.prepare(
    `INSERT INTO herramientas (codigo, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(codigo, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo, texto(b.notas, "notas", { requerido: false }))
    .run();
  const id = Number(res.meta.last_row_id);

  // Movimiento de alta con el stock inicial (si hay).
  if (stock !== 0) {
    await c.env.DB.prepare(
      `INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo)
       VALUES (?, ?, 'alta', ?, ?, 'Stock inicial')`
    )
      .bind(id, fecha, stock, stock)
      .run();
  }
  return c.json({ id });
});

herramientas.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const h = await c.env.DB.prepare(`SELECT * FROM herramientas WHERE id = ?`).bind(id).first<Herramienta>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");

  const codigo = texto(b.codigo, "código", { max: 40 })!;
  const dup = await c.env.DB.prepare(`SELECT id FROM herramientas WHERE codigo = ? AND id != ?`)
    .bind(codigo, id)
    .first();
  if (dup) throw new HttpError(409, `Ya existe otra herramienta con el código "${codigo}".`);

  // OJO: los precios NO se cambian acá (tienen su propio endpoint con historial).
  await c.env.DB.prepare(
    `UPDATE herramientas SET codigo=?, nombre=?, rubro=?, costo=?, stock_minimo=?, notas=? WHERE id=?`
  )
    .bind(
      codigo,
      texto(b.nombre, "nombre", { max: 120 }),
      texto(b.rubro, "rubro", { requerido: false, max: 60 }),
      entero(b.costo ?? h.costo, "costo", { min: 0 }),
      entero(b.stock_minimo ?? h.stock_minimo, "stock mínimo", { min: 0 }),
      texto(b.notas, "notas", { requerido: false }),
      id
    )
    .run();
  return c.json({ ok: true });
});

herramientas.post("/:id/archivar", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const activo = boolOpt(b.activar) ? 1 : 0;
  await c.env.DB.prepare(`UPDATE herramientas SET activo = ? WHERE id = ?`).bind(activo, id).run();
  return c.json({ ok: true });
});

/** Producción: fabriqué X unidades, el stock sube. */
herramientas.post("/:id/produccion", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const cantidad = entero(b.cantidad, "cantidad", { min: 1 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const h = await c.env.DB.prepare(`SELECT stock FROM herramientas WHERE id = ?`).bind(id).first<{ stock: number }>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");
  const resultante = h.stock + cantidad;

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE id = ?`).bind(resultante, id),
    c.env.DB.prepare(
      `INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo)
       VALUES (?, ?, 'produccion', ?, ?, ?)`
    ).bind(id, fecha, cantidad, resultante, texto(b.motivo, "motivo", { requerido: false })),
  ]);
  return c.json({ ok: true, stock: resultante });
});

/** Ajuste: corrige stock por rotura/pérdida/conteo. Motivo obligatorio. */
herramientas.post("/:id/ajuste", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const motivo = texto(b.motivo, "motivo", { max: 300 })!; // obligatorio
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();

  const h = await c.env.DB.prepare(`SELECT stock FROM herramientas WHERE id = ?`).bind(id).first<{ stock: number }>();
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
    c.env.DB.prepare(`UPDATE herramientas SET stock = ? WHERE id = ?`).bind(resultante, id),
    c.env.DB.prepare(
      `INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo)
       VALUES (?, ?, 'ajuste', ?, ?, ?)`
    ).bind(id, fecha, cantidad, resultante, motivo),
  ]);
  return c.json({ ok: true, stock: resultante });
});

/** Cambio de precio (minorista y/o mayorista): guarda historial. Las ventas pasadas no se tocan. */
herramientas.post("/:id/precio", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : hoy();
  const motivo = texto(b.motivo, "motivo", { requerido: false });

  const h = await c.env.DB
    .prepare(`SELECT precio, precio_mayor FROM herramientas WHERE id = ?`)
    .bind(id)
    .first<{ precio: number; precio_mayor: number }>();
  if (!h) throw new HttpError(404, "Herramienta no encontrada.");

  const stmts: D1PreparedStatement[] = [];
  let cambio = false;

  if (b.precio_nuevo != null) {
    const nuevo = entero(b.precio_nuevo, "precio minorista nuevo", { min: 0 });
    if (nuevo !== h.precio) {
      cambio = true;
      stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio = ? WHERE id = ?`).bind(nuevo, id));
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO precios_historial (herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
           VALUES (?, ?, ?, ?, 'minorista', ?)`
        ).bind(id, fecha, h.precio, nuevo, motivo)
      );
    }
  }
  if (b.precio_mayor_nuevo != null) {
    const nuevo = entero(b.precio_mayor_nuevo, "precio mayorista nuevo", { min: 0 });
    if (nuevo !== h.precio_mayor) {
      cambio = true;
      stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio_mayor = ? WHERE id = ?`).bind(nuevo, id));
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO precios_historial (herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
           VALUES (?, ?, ?, ?, 'mayorista', ?)`
        ).bind(id, fecha, h.precio_mayor, nuevo, motivo)
      );
    }
  }

  if (!cambio) throw new HttpError(400, "No hay cambios de precio para guardar.");
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

  const where = rubro ? `WHERE activo = 1 AND rubro = ?` : `WHERE activo = 1`;
  const rows = await c.env.DB.prepare(`SELECT id, precio, precio_mayor FROM herramientas ${where}`)
    .bind(...(rubro ? [rubro] : []))
    .all<{ id: number; precio: number; precio_mayor: number }>();

  const stmts: D1PreparedStatement[] = [];
  let cambiadas = 0;
  for (const h of rows.results ?? []) {
    let toco = false;
    if (tipo !== "mayorista") {
      const np = nuevoPrecio(h.precio);
      if (np !== h.precio) {
        toco = true;
        stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio = ? WHERE id = ?`).bind(np, h.id));
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO precios_historial (herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
             VALUES (?, ?, ?, ?, 'minorista', ?)`
          ).bind(h.id, fecha, h.precio, np, motivo)
        );
      }
    }
    if (tipo !== "minorista") {
      const nm = nuevoPrecio(h.precio_mayor);
      if (nm !== h.precio_mayor) {
        toco = true;
        stmts.push(c.env.DB.prepare(`UPDATE herramientas SET precio_mayor = ? WHERE id = ?`).bind(nm, h.id));
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO precios_historial (herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
             VALUES (?, ?, ?, ?, 'mayorista', ?)`
          ).bind(h.id, fecha, h.precio_mayor, nm, motivo)
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
herramientas.get("/rubros", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT rubro FROM herramientas WHERE rubro IS NOT NULL AND rubro != '' ORDER BY rubro`
  ).all<{ rubro: string }>();
  return c.json({ rubros: (rows.results ?? []).map((r) => r.rubro) });
});

herramientas.get("/:id/movimientos", async (c) => {
  const id = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT * FROM movimientos_stock WHERE herramienta_id = ? ORDER BY fecha DESC, id DESC`
  )
    .bind(id)
    .all<MovimientoStock>();
  return c.json({ movimientos: rows.results ?? [] });
});

herramientas.get("/:id/precios", async (c) => {
  const id = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT * FROM precios_historial WHERE herramienta_id = ? ORDER BY fecha DESC, id DESC`
  )
    .bind(id)
    .all<PrecioHistorial>();
  return c.json({ historial: rows.results ?? [] });
});
