/**
 * Insumos = materiales de taller (cuero, hilo, hebillas…), stock aparte del
 * catálogo de venta (herramientas). Sirven para armar el BOM (lista de
 * materiales) de un presupuesto a medida — ver src/routes/presupuestos.ts,
 * rutas /:id/insumos/aprobar y /:id/insumos/cancelar.
 */
import { Hono } from "hono";
import type { Env, Variables, Insumo } from "../types";
import { HttpError, texto, entero, cantidad, boolOpt, uuidOpt } from "../validate";
import { negocioDe } from "../types";
import { requireModulo } from "../config";
import { auditarDe } from "../auditoria";

export const insumos = new Hono<{ Bindings: Env; Variables: Variables }>();
insumos.use("*", requireModulo("insumos"));

insumos.get("/", async (c) => {
  const neg = negocioDe(c);
  const incluirArchivados = boolOpt(c.req.query("incluirArchivados"));
  const buscar = c.req.query("buscar")?.trim().toLowerCase() ?? "";

  const rows = await c.env.DB.prepare(
    `SELECT * FROM insumos WHERE negocio_id = ? AND (? = 1 OR activo = 1) ORDER BY nombre COLLATE NOCASE`
  )
    .bind(neg, incluirArchivados ? 1 : 0)
    .all<Insumo>();

  let lista = rows.results ?? [];
  if (buscar) lista = lista.filter((i) => i.nombre.toLowerCase().includes(buscar));
  return c.json({ insumos: lista });
});

insumos.post("/", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const id = uuidOpt(b.id, "id") ?? crypto.randomUUID();

  const repetido = await c.env.DB
    .prepare(`SELECT id FROM insumos WHERE negocio_id = ? AND nombre = ? COLLATE NOCASE`)
    .bind(neg, nombre)
    .first();
  if (repetido) throw new HttpError(409, `Ya tenés un insumo que se llama "${nombre}".`);

  const unidadMedida = texto(b.unidad_medida, "unidad de medida", { requerido: false, max: 20 }) ?? "unidad";
  const costoUnitario = entero(b.costo_unitario ?? 0, "costo unitario", { min: 0 });
  const stockActual = cantidad(b.stock_actual ?? 0, "stock actual", { fraccionada: true, min: 0 });

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO insumos (id, negocio_id, nombre, unidad_medida, costo_unitario, stock_actual)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, neg, nombre, unidadMedida, costoUnitario, stockActual),
    auditarDe(c, "crear_insumo", "insumo", id, nombre),
  ]);
  return c.json({ id });
});

insumos.put("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const existe = await c.env.DB.prepare(`SELECT id FROM insumos WHERE negocio_id = ? AND id = ?`).bind(neg, id).first();
  if (!existe) throw new HttpError(404, "Insumo no encontrado.");

  const nombre = texto(b.nombre, "nombre", { max: 120 })!;
  const repetido = await c.env.DB
    .prepare(`SELECT id FROM insumos WHERE negocio_id = ? AND nombre = ? COLLATE NOCASE AND id != ?`)
    .bind(neg, nombre, id)
    .first();
  if (repetido) throw new HttpError(409, `Ya tenés otro insumo que se llama "${nombre}".`);

  const unidadMedida = texto(b.unidad_medida, "unidad de medida", { requerido: false, max: 20 }) ?? "unidad";
  const costoUnitario = entero(b.costo_unitario ?? 0, "costo unitario", { min: 0 });
  const stockActual = cantidad(b.stock_actual ?? 0, "stock actual", { fraccionada: true, min: 0 });

  await c.env.DB.prepare(
    `UPDATE insumos SET nombre=?, unidad_medida=?, costo_unitario=?, stock_actual=? WHERE negocio_id=? AND id=?`
  )
    .bind(nombre, unidadMedida, costoUnitario, stockActual, neg, id)
    .run();
  return c.json({ ok: true });
});

/** Archivar / reactivar. No se borra: los presupuestos viejos lo siguen nombrando (nombre_insumo copiado). */
insumos.post("/:id/archivar", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const activo = boolOpt(b.activar) ? 1 : 0;
  const neg = negocioDe(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE insumos SET activo = ? WHERE negocio_id = ? AND id = ?`).bind(activo, neg, id),
    auditarDe(c, activo ? "reactivar_insumo" : "archivar_insumo", "insumo", id),
  ]);
  return c.json({ ok: true });
});
