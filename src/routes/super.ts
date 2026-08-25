/**
 * Rutas del proveedor del sistema (super admin): dar de alta un negocio nuevo
 * con su primer usuario, ver cómo viene cada cliente, suspenderlo y entrar a
 * su instalación para dar soporte.
 *
 * Es el ÚNICO archivo que consulta a propósito sin filtrar por negocio_id.
 * Todo acá adentro pasa por requireSuper.
 */
import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { HttpError, texto, enumerado } from "../validate";
import { hashPassword, crearSesion, requireSuper } from "../auth";
import { codigoDeNegocio } from "./auth";
import { MODULOS, type Modulo } from "../config";

export const superAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();
superAdmin.use("*", requireSuper);

const ESTADOS = ["prueba", "activo", "suspendido", "baja"] as const;

/**
 * Qué le sirve a cada tipo de negocio. Es sólo el punto de partida: el dueño
 * después prende y apaga lo que quiera desde Ajustes.
 */
interface Preset {
  etiqueta: string;
  modulos: Modulo[];
  singular: string;
  plural: string;
}

export const RUBROS: Record<string, Preset> = {
  fabrica: {
    etiqueta: "Fábrica / taller",
    modulos: ["produccion", "cuenta_corriente", "presupuestos", "precio_mayorista", "venta_rapida"],
    singular: "Herramienta",
    plural: "Herramientas",
  },
  ferreteria: {
    etiqueta: "Ferretería",
    modulos: ["compras", "cuenta_corriente", "precio_mayorista", "presupuestos", "codigo_barras"],
    singular: "Artículo",
    plural: "Artículos",
  },
  kiosko: {
    etiqueta: "Kiosko / almacén",
    modulos: ["compras", "venta_rapida", "codigo_barras", "caja_turno"],
    singular: "Producto",
    plural: "Productos",
  },
  otro: {
    etiqueta: "Otro",
    modulos: ["compras", "cuenta_corriente"],
    singular: "Producto",
    plural: "Productos",
  },
};

/** Los rubros disponibles, para armar el selector del alta. */
superAdmin.get("/rubros", (c) =>
  c.json({
    rubros: Object.entries(RUBROS).map(([id, p]) => ({
      id,
      etiqueta: p.etiqueta,
      modulos: p.modulos,
    })),
    modulos: MODULOS,
  })
);

/** Listado de clientes del sistema, con un pulso de cada uno. */
superAdmin.get("/negocios", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT n.*,
              (SELECT COUNT(*) FROM usuarios     WHERE negocio_id = n.id) AS usuarios,
              (SELECT COUNT(*) FROM clientes     WHERE negocio_id = n.id) AS clientes,
              (SELECT COUNT(*) FROM herramientas WHERE negocio_id = n.id) AS productos,
              (SELECT COUNT(*) FROM ventas       WHERE negocio_id = n.id AND estado != 'anulada') AS ventas,
              (SELECT MAX(fecha) FROM ventas     WHERE negocio_id = n.id) AS ultima_venta
       FROM negocios n
       ORDER BY CASE n.estado WHEN 'activo' THEN 0 WHEN 'prueba' THEN 1 WHEN 'suspendido' THEN 2 ELSE 3 END,
                n.nombre`
    )
    .all();
  return c.json({ negocios: rows.results ?? [] });
});

/** Detalle de un negocio, con sus usuarios (sin hashes). */
superAdmin.get("/negocios/:id", async (c) => {
  const id = c.req.param("id");
  const negocio = await c.env.DB.prepare(`SELECT * FROM negocios WHERE id = ?`).bind(id).first();
  if (!negocio) throw new HttpError(404, "Ese negocio no existe.");
  const usuarios = await c.env.DB
    .prepare(`SELECT id, usuario, rol, creado_en FROM usuarios WHERE negocio_id = ? ORDER BY id`)
    .bind(id)
    .all();
  return c.json({ negocio, usuarios: usuarios.results ?? [] });
});

/**
 * Alta de un cliente nuevo. En una sola operación queda su negocio creado,
 * configurado según el rubro y con el usuario del dueño listo para entrar.
 */
superAdmin.post("/negocios", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const nombre = texto(b.nombre, "nombre del negocio", { max: 80 })!;
  const rubro = enumerado(b.rubro ?? "otro", "rubro", Object.keys(RUBROS));
  const estado = enumerado(b.estado ?? "prueba", "estado", ESTADOS);
  const usuario = texto(b.usuario, "usuario del dueño", { max: 60 })!;
  const password = texto(b.password, "contraseña", { max: 200 })!;
  if (password.length < 6) throw new HttpError(400, "La contraseña tiene que tener al menos 6 caracteres.");

  // El código va en la URL y en el login: tiene que ser único y estable.
  const pedido = texto(b.codigo, "código", { requerido: false, max: 40 });
  let codigo = codigoDeNegocio(pedido ?? nombre);
  const chocado = await c.env.DB.prepare(`SELECT id FROM negocios WHERE codigo = ?`).bind(codigo).first();
  if (chocado) {
    if (pedido) throw new HttpError(409, `Ya hay un negocio con el código "${codigo}". Elegí otro.`);
    codigo = `${codigo}-${crypto.randomUUID().slice(0, 4)}`;
  }

  const preset = RUBROS[rubro];
  const id = crypto.randomUUID();
  const hash = await hashPassword(password);

  // Todo junto: si algo falla no queda un negocio a medio crear.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO negocios (id, nombre, codigo, contacto, telefono, email, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, nombre, codigo,
      texto(b.contacto, "contacto", { requerido: false, max: 80 }),
      texto(b.telefono, "teléfono", { requerido: false, max: 40 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      estado,
      texto(b.notas, "notas", { requerido: false, max: 500 })
    ),
    c.env.DB.prepare(`INSERT INTO config (negocio_id, clave, valor) VALUES (?, 'negocio_nombre', ?)`)
      .bind(id, nombre),
    c.env.DB.prepare(`INSERT INTO config (negocio_id, clave, valor) VALUES (?, 'negocio_rubro', ?)`)
      .bind(id, preset.etiqueta),
    c.env.DB.prepare(`INSERT INTO config (negocio_id, clave, valor) VALUES (?, 'producto_singular', ?)`)
      .bind(id, preset.singular),
    c.env.DB.prepare(`INSERT INTO config (negocio_id, clave, valor) VALUES (?, 'producto_plural', ?)`)
      .bind(id, preset.plural),
    c.env.DB.prepare(`INSERT INTO config (negocio_id, clave, valor) VALUES (?, 'modulos', ?)`)
      .bind(id, JSON.stringify(preset.modulos)),
    c.env.DB.prepare(`INSERT INTO usuarios (negocio_id, usuario, password_hash, rol) VALUES (?, ?, ?, 'dueño')`)
      .bind(id, usuario, hash),
  ]);

  return c.json({ id, codigo, nombre, usuario, rubro });
});

/** Editar datos de contacto, estado o notas. No toca los datos del negocio. */
superAdmin.put("/negocios/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const actual = await c.env.DB.prepare(`SELECT * FROM negocios WHERE id = ?`).bind(id).first<any>();
  if (!actual) throw new HttpError(404, "Ese negocio no existe.");

  await c.env.DB.prepare(
    `UPDATE negocios SET nombre=?, contacto=?, telefono=?, email=?, estado=?, notas=? WHERE id=?`
  )
    .bind(
      texto(b.nombre, "nombre", { max: 80 }) ?? actual.nombre,
      texto(b.contacto, "contacto", { requerido: false, max: 80 }),
      texto(b.telefono, "teléfono", { requerido: false, max: 40 }),
      texto(b.email, "email", { requerido: false, max: 120 }),
      enumerado(b.estado ?? actual.estado, "estado", ESTADOS),
      texto(b.notas, "notas", { requerido: false, max: 500 }),
      id
    )
    .run();
  return c.json({ ok: true });
});

/**
 * Blanquear la contraseña de un usuario del cliente. Es lo que se hace cuando
 * llaman diciendo "no puedo entrar" — no se puede leer la contraseña vieja.
 */
superAdmin.post("/negocios/:id/clave", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const usuario = texto(b.usuario, "usuario", { max: 60 })!;
  const nueva = texto(b.password, "contraseña", { max: 200 })!;
  if (nueva.length < 6) throw new HttpError(400, "La contraseña tiene que tener al menos 6 caracteres.");

  const u = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE negocio_id = ? AND usuario = ?`)
    .bind(id, usuario)
    .first<{ id: number }>();
  if (!u) throw new HttpError(404, "Ese usuario no existe en este negocio.");

  await c.env.DB.prepare(`UPDATE usuarios SET password_hash = ? WHERE id = ?`)
    .bind(await hashPassword(nueva), u.id)
    .run();
  return c.json({ ok: true });
});

/**
 * Entrar a la instalación de un cliente para dar soporte. Reemite la sesión
 * con ese negocio; el rol sigue siendo "super", así que se ve todo.
 * Queda registrado en la auditoría del cliente: si entro a mirar sus datos,
 * el dueño tiene que poder verlo.
 */
superAdmin.post("/negocios/:id/entrar", async (c) => {
  const id = c.req.param("id");
  const negocio = await c.env.DB.prepare(`SELECT id, nombre, codigo FROM negocios WHERE id = ?`)
    .bind(id)
    .first<{ id: string; nombre: string; codigo: string }>();
  if (!negocio) throw new HttpError(404, "Ese negocio no existe.");

  const u = c.get("usuario");
  await c.env.DB.prepare(
    `INSERT INTO auditoria (negocio_id, usuario, accion, entidad, entidad_id, detalle)
     VALUES (?, ?, 'soporte_entra', 'negocio', ?, ?)`
  )
    .bind(id, u.usuario, id, "Acceso de soporte del proveedor del sistema")
    .run();

  await crearSesion(c, u.uid, u.usuario, "super", id);
  return c.json({ ok: true, negocio });
});

/** Volver a la vista de proveedor (salir del negocio del cliente). */
superAdmin.post("/salir", async (c) => {
  const u = c.get("usuario");
  await crearSesion(c, u.uid, u.usuario, "super", null);
  return c.json({ ok: true });
});
