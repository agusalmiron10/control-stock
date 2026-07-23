import { Hono } from "hono";
import type { Env, Variables, Cliente, Venta, Pago } from "../types";
import { HttpError, texto, boolOpt } from "../validate";
import { estadoDeCuenta, estadoDeCuentaTodos } from "../cuenta";

export const clientes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Listado con saldo calculado. Filtros: buscar, localidad, soloDeben. */
clientes.get("/", async (c) => {
  const buscar = c.req.query("buscar")?.trim().toLowerCase() ?? "";
  const localidad = c.req.query("localidad")?.trim() ?? "";
  const soloDeben = boolOpt(c.req.query("soloDeben"));
  const incluirArchivados = boolOpt(c.req.query("incluirArchivados"));

  const rows = await c.env.DB.prepare(
    `SELECT * FROM clientes WHERE (? = 1 OR activo = 1) ORDER BY nombre COLLATE NOCASE`
  )
    .bind(incluirArchivados ? 1 : 0)
    .all<Cliente>();

  const cuentas = await estadoDeCuentaTodos(c.env);

  let lista = (rows.results ?? []).map((cl) => {
    const cta = cuentas.get(cl.id);
    return {
      ...cl,
      saldo: cta?.saldoCliente ?? 0,
      total_comprado: cta?.totalVentas ?? 0,
      total_pagado: cta?.totalPagado ?? 0,
    };
  });

  if (buscar) lista = lista.filter((cl) => cl.nombre.toLowerCase().includes(buscar));
  if (localidad) lista = lista.filter((cl) => (cl.localidad ?? "") === localidad);
  if (soloDeben) lista = lista.filter((cl) => cl.saldo > 0);

  return c.json({ clientes: lista });
});

/** Localidades distintas (para el filtro). */
clientes.get("/localidades", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT localidad FROM clientes WHERE localidad IS NOT NULL AND localidad != '' ORDER BY localidad`
  ).all<{ localidad: string }>();
  return c.json({ localidades: (rows.results ?? []).map((r) => r.localidad) });
});

clientes.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const res = await c.env.DB.prepare(
    `INSERT INTO clientes (nombre, localidad, direccion, telefono, email, notas)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      nombre,
      texto(b.localidad, "localidad", { requerido: false }),
      texto(b.direccion, "dirección", { requerido: false }),
      texto(b.telefono, "teléfono", { requerido: false, max: 60 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      texto(b.notas, "notas", { requerido: false, max: 1000 })
    )
    .run();
  return c.json({ id: Number(res.meta.last_row_id) });
});

/** Ficha completa. */
clientes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const cliente = await c.env.DB.prepare(`SELECT * FROM clientes WHERE id = ?`).bind(id).first<Cliente>();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado.");

  const cta = await estadoDeCuenta(c.env, id);

  const ventasRows = await c.env.DB.prepare(
    `SELECT * FROM ventas WHERE cliente_id = ? ORDER BY fecha DESC, numero DESC`
  )
    .bind(id)
    .all<Venta>();

  const ventas = (ventasRows.results ?? []).map((v) => {
    const r = cta.porVenta.get(v.id);
    return {
      ...v,
      pagado: v.anulada ? 0 : r?.pagado ?? 0,
      saldo: v.anulada ? 0 : r?.saldo ?? v.total,
      estado: v.anulada ? "anulada" : r?.estado ?? "impaga",
    };
  });

  const pagosRows = await c.env.DB.prepare(
    `SELECT p.*, v.numero AS venta_numero FROM pagos p
     LEFT JOIN ventas v ON v.id = p.venta_id
     WHERE p.cliente_id = ? ORDER BY p.fecha DESC, p.id DESC`
  )
    .bind(id)
    .all<Pago & { venta_numero: number | null }>();

  return c.json({
    cliente,
    saldo: cta.saldoCliente,
    saldo_a_favor: cta.saldoAFavor,
    total_comprado: cta.totalVentas,
    total_pagado: cta.totalPagado,
    ventas,
    pagos: pagosRows.results ?? [],
  });
});

clientes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const existe = await c.env.DB.prepare(`SELECT id FROM clientes WHERE id = ?`).bind(id).first();
  if (!existe) throw new HttpError(404, "Cliente no encontrado.");
  await c.env.DB.prepare(
    `UPDATE clientes SET nombre=?, localidad=?, direccion=?, telefono=?, email=?, notas=? WHERE id=?`
  )
    .bind(
      texto(b.nombre, "nombre", { max: 120 }),
      texto(b.localidad, "localidad", { requerido: false }),
      texto(b.direccion, "dirección", { requerido: false }),
      texto(b.telefono, "teléfono", { requerido: false, max: 60 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      texto(b.notas, "notas", { requerido: false, max: 1000 }),
      id
    )
    .run();
  return c.json({ ok: true });
});

/** Archivar / reactivar (borrado lógico). */
clientes.post("/:id/archivar", async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json().catch(() => ({}));
  const activo = boolOpt(b.activar) ? 1 : 0;
  await c.env.DB.prepare(`UPDATE clientes SET activo = ? WHERE id = ?`).bind(activo, id).run();
  return c.json({ ok: true });
});
