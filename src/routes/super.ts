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
import { HttpError, texto, enumerado, entero, boolOpt, fechaISO } from "../validate";
import { hashPassword, crearSesion, requireSuper } from "../auth";
import { codigoDeNegocio } from "./auth";
import { MODULOS, leerConfig, type Modulo } from "../config";
import { auditar } from "../auditoria";
import { guardarCopias } from "./backup";

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
              (SELECT MAX(fecha) FROM ventas     WHERE negocio_id = n.id) AS ultima_venta,
              -- Días que faltan (o que se pasó, si es negativo) para el vencimiento.
              CAST(julianday(n.paga_hasta) - julianday(date('now')) AS INTEGER) AS dias_para_vencer,
              (SELECT MAX(fecha) FROM suscripcion_pagos WHERE negocio_id = n.id) AS ultimo_pago
       FROM negocios n
       ORDER BY CASE n.estado WHEN 'activo' THEN 0 WHEN 'prueba' THEN 1 WHEN 'suspendido' THEN 2 ELSE 3 END,
                n.nombre`
    )
    .all();
  return c.json({ negocios: rows.results ?? [] });
});

// ── Suscripción: plan, vencimiento y cobros ─────────────────

/** Define o cambia el plan de un negocio. No cobra nada: sólo deja escrito
 *  cuánto paga y cada cuánto. */
superAdmin.put("/negocios/:id/plan", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const negocio = await c.env.DB.prepare(`SELECT id FROM negocios WHERE id = ?`).bind(id).first();
  if (!negocio) throw new HttpError(404, "Ese negocio no existe.");

  await c.env.DB.prepare(
    `UPDATE negocios SET plan = ?, precio_mensual = ?, dias_gracia = ?, sin_corte = ? WHERE id = ?`
  )
    .bind(
      texto(b.plan, "plan", { requerido: false, max: 60 }),
      b.precio_mensual == null ? null : entero(b.precio_mensual, "precio mensual", { min: 0 }),
      entero(b.dias_gracia ?? 7, "días de gracia", { min: 0, max: 90 }),
      boolOpt(b.sin_corte) ? 1 : 0,
      id
    )
    .run();
  return c.json({ ok: true });
});

/**
 * Registra un cobro y empuja la fecha de cobertura.
 *
 * Se cuenta desde la fecha de vencimiento anterior, no desde hoy: si alguien
 * paga tres días tarde, no pierde esos tres días. Pero si estuvo meses sin
 * pagar, se cuenta desde hoy — un pago no te compra los meses que no usaste.
 */
superAdmin.post("/negocios/:id/cobro", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  const negocio = await c.env.DB
    .prepare(`SELECT id, nombre, paga_hasta, precio_mensual FROM negocios WHERE id = ?`)
    .bind(id)
    .first<{ id: string; nombre: string; paga_hasta: string | null; precio_mensual: number | null }>();
  if (!negocio) throw new HttpError(404, "Ese negocio no existe.");

  const monto = entero(b.monto ?? negocio.precio_mensual, "monto", { min: 0 });
  const meses = entero(b.meses ?? 1, "meses", { min: 1, max: 36 });
  const fecha = b.fecha ? fechaISO(b.fecha, "fecha") : new Date().toISOString().slice(0, 10);

  // Desde dónde se cuenta la cobertura nueva.
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = negocio.paga_hasta && negocio.paga_hasta > hoy ? negocio.paga_hasta : hoy;
  const base = new Date(`${desde}T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() + meses);
  const cubreHasta = base.toISOString().slice(0, 10);

  const pagoId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO suscripcion_pagos (id, negocio_id, fecha, monto, medio, cubre_hasta, nota, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(pagoId, id, fecha, monto, texto(b.medio, "medio", { requerido: false, max: 40 }),
           cubreHasta, texto(b.nota, "nota", { requerido: false, max: 500 }), c.get("usuario").usuario),
    // Cobrar reactiva: si estaba suspendido por falta de pago, vuelve solo.
    c.env.DB.prepare(
      `UPDATE negocios SET paga_hasta = ?, estado = CASE WHEN estado = 'suspendido' THEN 'activo' ELSE estado END
       WHERE id = ?`
    ).bind(cubreHasta, id),
  ]);

  return c.json({ ok: true, cubre_hasta: cubreHasta });
});

/** Historial de cobros de un negocio. */
superAdmin.get("/negocios/:id/cobros", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM suscripcion_pagos WHERE negocio_id = ? ORDER BY fecha DESC, creado_en DESC`)
    .bind(c.req.param("id"))
    .all();
  return c.json({ cobros: rows.results ?? [] });
});

/** Detalle de un negocio, con sus usuarios (sin hashes) y sus módulos activos. */
superAdmin.get("/negocios/:id", async (c) => {
  const id = c.req.param("id");
  const negocio = await c.env.DB.prepare(`SELECT * FROM negocios WHERE id = ?`).bind(id).first();
  if (!negocio) throw new HttpError(404, "Ese negocio no existe.");
  const usuarios = await c.env.DB
    .prepare(`SELECT id, usuario, rol, creado_en FROM usuarios WHERE negocio_id = ? ORDER BY id`)
    .bind(id)
    .all();
  const cfg = await leerConfig(c.env, id);
  return c.json({ negocio, usuarios: usuarios.results ?? [], modulos: cfg.modulos });
});

/**
 * Prender o apagar módulos de un negocio. Sólo el proveedor puede hacer
 * esto — un negocio no se autohabilita algo que no le vendieron. Queda
 * registrado en la auditoría de ESE negocio, para que el dueño vea que
 * cambió algo y no piense que es un bug.
 */
superAdmin.put("/negocios/:id/modulos", async (c) => {
  const id = c.req.param("id");
  const existe = await c.env.DB.prepare(`SELECT id FROM negocios WHERE id = ?`).bind(id).first();
  if (!existe) throw new HttpError(404, "Ese negocio no existe.");

  const b = await c.req.json().catch(() => ({}));
  if (!b.modulos || typeof b.modulos !== "object") throw new HttpError(400, "Mandá la lista de módulos.");
  const activos = MODULOS.filter((m: Modulo) => b.modulos[m] === true);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO config (negocio_id, clave, valor, actualizado_en) VALUES (?, 'modulos', ?, datetime('now'))
       ON CONFLICT(negocio_id, clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`
    ).bind(id, JSON.stringify(activos)),
    auditar(c.env, id, c.get("usuario").usuario, "cambiar_modulos", "config", null, `Módulos: ${activos.join(", ") || "ninguno"}`),
  ]);
  return c.json({ ok: true, modulos: activos });
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

// ── Copias diarias ─────────────────────────────────────────
//
// Las guarda el cron en R2, una por negocio y por día (30 días de retención).
// Sólo las ve el proveedor: el cliente no las tiene en su pantalla, y si
// alguna vez necesita una, se la entrega el proveedor desde acá.
//
// No ocupan lugar en la base: R2 es almacenamiento aparte de D1.

/** Todas las copias que hay, agrupadas por negocio. */
superAdmin.get("/copias", async (c) => {
  if (!c.env.BACKUPS) return c.json({ negocios: [], disponible: false });

  const nombres = await c.env.DB.prepare(`SELECT id, nombre FROM negocios`).all<{ id: string; nombre: string }>();
  const porId = new Map((nombres.results ?? []).map((n) => [n.id, n.nombre]));

  // R2 pagina de a 1000: hay que seguir el cursor o faltan copias en la lista.
  const porNegocio = new Map<string, { fecha: string; tamano: number }[]>();
  let cursor: string | undefined;
  do {
    const listado = await c.env.BACKUPS.list({ prefix: "negocios/", cursor });
    for (const obj of listado.objects) {
      const m = /^negocios\/([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/.exec(obj.key);
      if (!m) continue;
      const arr = porNegocio.get(m[1]) ?? [];
      arr.push({ fecha: m[2], tamano: obj.size });
      porNegocio.set(m[1], arr);
    }
    cursor = listado.truncated ? listado.cursor : undefined;
  } while (cursor);

  const negocios = [...porNegocio.entries()]
    .map(([id, copias]) => ({
      id,
      // Un negocio dado de baja deja de estar en la tabla pero sus copias
      // siguen en R2 hasta que vencen: hay que poder verlas igual.
      nombre: porId.get(id) ?? "(negocio dado de baja)",
      copias: copias.sort((a, b) => b.fecha.localeCompare(a.fecha)),
      total: copias.reduce((s, x) => s + x.tamano, 0),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Los backups del esquema anterior (un archivo con TODA la base por día).
  // Ya no se generan, pero los que quedaron siguen siendo recuperables y
  // tienen que verse: son los únicos que cubren las fechas previas al cambio.
  const globales: { fecha: string; tamano: number }[] = [];
  let c2: string | undefined;
  do {
    const l = await c.env.BACKUPS.list({ prefix: "backup-", cursor: c2 });
    for (const obj of l.objects) {
      const m = /^backup-(\d{4}-\d{2}-\d{2})\.json$/.exec(obj.key);
      if (m) globales.push({ fecha: m[1], tamano: obj.size });
    }
    c2 = l.truncated ? l.cursor : undefined;
  } while (c2);
  globales.sort((a, b) => b.fecha.localeCompare(a.fecha));

  return c.json({
    negocios,
    globales,
    disponible: true,
    ocupado:
      negocios.reduce((s, n) => s + n.total, 0) + globales.reduce((s, g) => s + g.tamano, 0),
  });
});

/**
 * Genera las copias de todos los clientes en el momento.
 *
 * El cron las hace una vez por madrugada; esto sirve para el rato en que
 * todavía no corrió, y sobre todo para forzar una copia antes de tocar algo
 * delicado — que es justo cuando uno no quiere esperar hasta mañana.
 */
superAdmin.post("/copias/generar", async (c) => {
  if (!c.env.BACKUPS) throw new HttpError(400, "No hay un bucket de copias configurado.");
  const negocios = await c.env.DB
    .prepare(`SELECT id FROM negocios WHERE estado IN ('prueba','activo')`)
    .all<{ id: string }>();
  const ids = (negocios.results ?? []).map((n) => n.id);
  const r = await guardarCopias(c.env, ids);
  return c.json({ ...r, total: ids.length });
});

/** Baja uno de los backups globales viejos (toda la base en un archivo). */
superAdmin.get("/copias/globales/:fecha", async (c) => {
  const fecha = c.req.param("fecha");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new HttpError(400, "Fecha inválida.");
  if (!c.env.BACKUPS) throw new HttpError(404, "No hay copias configuradas.");
  const obj = await c.env.BACKUPS.get(`backup-${fecha}.json`);
  if (!obj) throw new HttpError(404, "No hay un backup de esa fecha.");
  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="backup-completo-${fecha}.json"`,
    },
  });
});

/** Baja una copia puntual de cualquier negocio. */
superAdmin.get("/copias/:negocioId/:fecha", async (c) => {
  const negocioId = c.req.param("negocioId");
  const fecha = c.req.param("fecha");
  // Los dos arman una ruta de R2: sin validar, un "../" leería otra carpeta.
  if (!/^[0-9a-fA-F-]{16,40}$/.test(negocioId)) throw new HttpError(400, "Negocio inválido.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new HttpError(400, "Fecha inválida.");
  if (!c.env.BACKUPS) throw new HttpError(404, "No hay copias configuradas.");

  const obj = await c.env.BACKUPS.get(`negocios/${negocioId}/${fecha}.json`);
  if (!obj) throw new HttpError(404, "No hay una copia de esa fecha.");

  return new Response(obj.body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="respaldo-${negocioId.slice(0, 8)}-${fecha}.json"`,
    },
  });
});
