import { Hono } from "hono";
import type { Env, Variables, Cliente, Venta, Pago } from "../types";
import { HttpError, texto, boolOpt, uuidOpt, decimalOpt, enumerado , normalizarBusqueda } from "../validate";
import { estadoDeCuenta, estadoDeCuentaTodos } from "../cuenta";
import { auditarDe } from "../auditoria";
import { negocioDe } from "../types";

export const clientes = new Hono<{ Bindings: Env; Variables: Variables }>();

const DOC_TIPOS = ["CUIT", "DNI"] as const;
const CONDICIONES_IVA = ["responsable_inscripto", "monotributo", "exento"] as const;

/** Campos fiscales del cliente: opcionales, sólo hacen falta para Factura A. */
function camposFiscales(b: any) {
  return {
    doc_tipo: b.doc_tipo ? enumerado(b.doc_tipo, "tipo de documento", DOC_TIPOS) : null,
    doc_numero: texto(b.doc_numero, "número de documento", { requerido: false, max: 20 }),
    condicion_iva: b.condicion_iva ? enumerado(b.condicion_iva, "condición de IVA", CONDICIONES_IVA) : null,
  };
}

/** Listado con saldo calculado. Filtros: buscar, localidad, soloDeben. */
clientes.get("/", async (c) => {
  // Sin acentos: nadie los escribe al buscar ("gomez" tiene que encontrar a "Gómez").
  const buscar = normalizarBusqueda(c.req.query("buscar") ?? "");
  const localidad = c.req.query("localidad")?.trim() ?? "";
  const soloDeben = boolOpt(c.req.query("soloDeben"));
  const incluirArchivados = boolOpt(c.req.query("incluirArchivados"));

  const neg = negocioDe(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM clientes WHERE negocio_id = ? AND (? = 1 OR activo = 1) ORDER BY nombre COLLATE NOCASE`
  )
    .bind(neg, incluirArchivados ? 1 : 0)
    .all<Cliente>();

  const cuentas = await estadoDeCuentaTodos(c.env, neg);

  let lista = (rows.results ?? []).map((cl) => {
    const cta = cuentas.get(cl.id);
    return {
      ...cl,
      saldo: cta?.saldoCliente ?? 0,
      total_comprado: cta?.totalVentas ?? 0,
      total_pagado: cta?.totalPagado ?? 0,
    };
  });

  if (buscar) lista = lista.filter((cl) => normalizarBusqueda(cl.nombre).includes(buscar));
  if (localidad) lista = lista.filter((cl) => (cl.localidad ?? "") === localidad);
  if (soloDeben) lista = lista.filter((cl) => cl.saldo > 0);

  return c.json({ clientes: lista });
});

/** Localidades distintas (para el filtro). */
clientes.get("/localidades", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT localidad FROM clientes
     WHERE negocio_id = ? AND localidad IS NOT NULL AND localidad != '' ORDER BY localidad`
  ).bind(negocioDe(c)).all<{ localidad: string }>();
  return c.json({ localidades: (rows.results ?? []).map((r) => r.localidad) });
});

/**
 * El cliente "Consumidor Final" del negocio, para las ventas de mostrador.
 * Se crea solo la primera vez que alguien lo pide — así ningún negocio tiene
 * que acordarse de crearlo a mano antes de vender.
 */
clientes.get("/mostrador", async (c) => {
  const neg = negocioDe(c);
  const existente = await c.env.DB
    .prepare(`SELECT id, nombre FROM clientes WHERE negocio_id = ? AND es_consumidor_final = 1`)
    .bind(neg)
    .first<{ id: string; nombre: string }>();
  if (existente) return c.json(existente);

  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO clientes (id, negocio_id, nombre, notas, es_consumidor_final)
       VALUES (?, ?, 'Consumidor Final', 'Cliente para las ventas de mostrador. No se puede borrar.', 1)`
    )
    .bind(id, neg)
    .run();
  return c.json({ id, nombre: "Consumidor Final" });
});

/**
 * Alta de cliente. Acepta id + idempotency_key opcionales (los manda el
 * celular cuando lo crea offline desde "cliente nuevo"). Si la clave ya fue
 * procesada, devuelve el mismo resultado sin insertar de nuevo.
 */
clientes.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const idempotencyKey = uuidOpt(b.idempotency_key, "idempotency_key");

  if (idempotencyKey) {
    const previa = await c.env.DB
      .prepare(`SELECT resultado FROM operaciones WHERE negocio_id = ? AND idempotency_key = ?`)
      .bind(negocioDe(c), idempotencyKey)
      .first<{ resultado: string }>();
    if (previa) return c.json(JSON.parse(previa.resultado));
  }

  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const id = uuidOpt(b.id, "id") ?? crypto.randomUUID();

  const neg = negocioDe(c);
  const fiscal = camposFiscales(b);
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO clientes (id, negocio_id, nombre, localidad, direccion, telefono, email, notas, latitud, longitud, doc_tipo, doc_numero, condicion_iva)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      neg,
      nombre,
      texto(b.localidad, "localidad", { requerido: false }),
      texto(b.direccion, "dirección", { requerido: false }),
      texto(b.telefono, "teléfono", { requerido: false, max: 60 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      texto(b.notas, "notas", { requerido: false, max: 1000 }),
      decimalOpt(b.latitud, "latitud"),
      decimalOpt(b.longitud, "longitud"),
      fiscal.doc_tipo,
      fiscal.doc_numero,
      fiscal.condicion_iva
    ),
  ];

  const resultado = { id };
  if (idempotencyKey) {
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO operaciones (negocio_id, idempotency_key, tipo, entidad_id, resultado)
         VALUES (?, ?, 'cliente', ?, ?)`
      ).bind(neg, idempotencyKey, id, JSON.stringify(resultado))
    );
  }

  await c.env.DB.batch(stmts);
  return c.json(resultado);
});

/** Ficha completa. */
clientes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const neg = negocioDe(c);
  const cliente = await c.env.DB.prepare(`SELECT * FROM clientes WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<Cliente>();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado.");

  const cta = await estadoDeCuenta(c.env, neg, id);

  const ventasRows = await c.env.DB.prepare(
    `SELECT * FROM ventas WHERE negocio_id = ? AND cliente_id = ? ORDER BY fecha DESC, numero DESC`
  )
    .bind(neg, id)
    .all<Venta>();

  const ventas = (ventasRows.results ?? []).map((v) => {
    const r = cta.porVenta.get(v.id);
    const activa = v.estado === "sincronizada" || v.estado === "confirmada";
    return {
      ...v,
      pagado: activa ? r?.pagado ?? 0 : 0,
      saldo: activa ? r?.saldo ?? v.total : 0,
      estado_pago: activa ? r?.estado ?? "impaga" : null,
    };
  });

  const pagosRows = await c.env.DB.prepare(
    `SELECT p.*, v.numero AS venta_numero FROM pagos p
     LEFT JOIN ventas v ON v.id = p.venta_id
     WHERE p.negocio_id = ? AND p.cliente_id = ? ORDER BY p.fecha DESC, p.id DESC`
  )
    .bind(neg, id)
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
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const existe = await c.env.DB.prepare(`SELECT id, es_consumidor_final FROM clientes WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ id: string; es_consumidor_final: number }>();
  if (!existe) throw new HttpError(404, "Cliente no encontrado.");
  if (existe.es_consumidor_final) {
    throw new HttpError(400, "El Consumidor Final es el cliente de las ventas de mostrador: no se puede editar.");
  }
  const fiscal = camposFiscales(b);
  await c.env.DB.prepare(
    `UPDATE clientes SET nombre=?, localidad=?, direccion=?, telefono=?, email=?, notas=?, latitud=?, longitud=?,
       doc_tipo=?, doc_numero=?, condicion_iva=?
     WHERE negocio_id=? AND id=?`
  )
    .bind(
      texto(b.nombre, "nombre", { max: 120 }),
      texto(b.localidad, "localidad", { requerido: false }),
      texto(b.direccion, "dirección", { requerido: false }),
      texto(b.telefono, "teléfono", { requerido: false, max: 60 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      texto(b.notas, "notas", { requerido: false, max: 1000 }),
      decimalOpt(b.latitud, "latitud"),
      decimalOpt(b.longitud, "longitud"),
      fiscal.doc_tipo,
      fiscal.doc_numero,
      fiscal.condicion_iva,
      neg,
      id
    )
    .run();
  return c.json({ ok: true });
});

/** Archivar / reactivar (borrado lógico). */
clientes.post("/:id/archivar", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const activo = boolOpt(b.activar) ? 1 : 0;
  const neg = negocioDe(c);
  const cli = await c.env.DB.prepare(`SELECT es_consumidor_final FROM clientes WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ es_consumidor_final: number }>();
  if (cli?.es_consumidor_final && !activo) {
    throw new HttpError(400, "El Consumidor Final no se puede archivar: es el cliente de las ventas de mostrador.");
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE clientes SET activo = ? WHERE negocio_id = ? AND id = ?`).bind(activo, neg, id),
    auditarDe(c, activo ? "reactivar_cliente" : "archivar_cliente", "cliente", id),
  ]);
  return c.json({ ok: true });
});
