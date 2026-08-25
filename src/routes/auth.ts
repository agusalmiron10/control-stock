import { Hono } from "hono";
import { esDuenoOSoporte, negocioDe, type Env, type Variables, type Rol } from "../types";
import {
  hashPassword,
  verifyPassword,
  crearSesion,
  cerrarSesion,
  requireAuth,
  leerSesionOpcional,
  loginPermitido,
  resetIntentos,
} from "../auth";
import { HttpError, texto, enumerado } from "../validate";

export const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Convierte "Ferretería El Tornillo" en "ferreteria-el-tornillo". */
export function codigoDeNegocio(nombre: string): string {
  const base = nombre
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return base || `negocio-${crypto.randomUUID().slice(0, 8)}`;
}

function ipDe(c: any): string {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
}

/** Estado: si hace falta crear el primer usuario y si hay sesión activa. */
auth.get("/status", async (c) => {
  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM usuarios`).first<{ n: number }>();
  const needsSetup = (row?.n ?? 0) === 0;
  const sesion = await leerSesionOpcional(c);
  let negocio: { id: string; nombre: string; codigo: string } | null = null;
  if (sesion?.negocioId) {
    negocio = await c.env.DB
      .prepare(`SELECT id, nombre, codigo FROM negocios WHERE id = ?`)
      .bind(sesion.negocioId)
      .first<{ id: string; nombre: string; codigo: string }>();
  }

  // Una sesión de alguien que no es el proveedor y no tiene negocio no sirve
  // para nada: es una cookie firmada antes del multi-negocio, o de un negocio
  // que se borró. La damos por vencida en vez de dejar la app tirando 409.
  if (sesion && sesion.rol !== "super" && !negocio) {
    cerrarSesion(c);
    return c.json({ needsSetup, authenticated: false, usuario: null, rol: null, negocio: null });
  }

  return c.json({
    needsSetup,
    authenticated: !!sesion,
    usuario: sesion?.usuario ?? null,
    rol: sesion?.rol ?? null,
    negocio,
  });
});

/** Setup inicial: crea el primer usuario (siempre dueño). Sólo funciona si no hay ninguno. */
auth.post("/setup", async (c) => {
  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM usuarios`).first<{ n: number }>();
  if ((row?.n ?? 0) > 0) throw new HttpError(409, "Ya existe un usuario. Iniciá sesión.");

  const body = await c.req.json().catch(() => ({}));
  const usuario = texto(body.usuario, "usuario", { max: 60 })!;
  const password = texto(body.password, "contraseña", { max: 200 })!;
  if (password.length < 6) throw new HttpError(400, "La contraseña tiene que tener al menos 6 caracteres.");

  const hash = await hashPassword(password);
  // El primer usuario también estrena su negocio.
  const negocioId = crypto.randomUUID();
  const nombreNegocio = texto(body.negocio, "negocio", { requerido: false, max: 80 }) ?? "Mi negocio";
  const codigo = codigoDeNegocio(nombreNegocio);

  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO negocios (id, nombre, codigo, estado) VALUES (?, ?, ?, 'activo')`)
      .bind(negocioId, nombreNegocio, codigo),
    c.env.DB.prepare(`INSERT INTO config (negocio_id, clave, valor) VALUES (?, 'negocio_nombre', ?)`)
      .bind(negocioId, nombreNegocio),
    c.env.DB.prepare(`INSERT INTO usuarios (negocio_id, usuario, password_hash, rol) VALUES (?, ?, ?, 'dueño')`)
      .bind(negocioId, usuario, hash),
  ]);

  const creado = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE negocio_id = ? AND usuario = ?`)
    .bind(negocioId, usuario)
    .first<{ id: number }>();

  await crearSesion(c, creado?.id ?? 0, usuario, "dueño", negocioId);
  return c.json({ ok: true, usuario, rol: "dueño", codigo });
});

/** Login. */
auth.post("/login", async (c) => {
  const ip = ipDe(c);
  if (!loginPermitido(ip)) {
    throw new HttpError(429, "Demasiados intentos. Esperá unos minutos y probá de nuevo.");
  }

  const body = await c.req.json().catch(() => ({}));
  const usuario = texto(body.usuario, "usuario", { max: 60 })!;
  const password = texto(body.password, "contraseña", { max: 200 })!;
  const codigo = texto(body.negocio, "negocio", { requerido: false, max: 40 })?.toLowerCase() ?? "";

  // Sin código de negocio sólo puede entrar un super admin (no tiene negocio).
  const user = codigo
    ? await c.env.DB
        .prepare(
          `SELECT u.id, u.usuario, u.password_hash, u.rol, u.negocio_id, n.estado
           FROM usuarios u JOIN negocios n ON n.id = u.negocio_id
           WHERE n.codigo = ? AND u.usuario = ?`
        )
        .bind(codigo, usuario)
        .first<{ id: number; usuario: string; password_hash: string; rol: Rol; negocio_id: string; estado: string }>()
    : await c.env.DB
        .prepare(
          `SELECT id, usuario, password_hash, rol, negocio_id, 'activo' AS estado
           FROM usuarios WHERE negocio_id IS NULL AND usuario = ?`
        )
        .bind(usuario)
        .first<{ id: number; usuario: string; password_hash: string; rol: Rol; negocio_id: string | null; estado: string }>();

  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  // Mismo mensaje para usuario, contraseña y negocio equivocados: así no se
  // puede averiguar qué negocios existen probando códigos.
  if (!ok || !user) throw new HttpError(401, "Usuario, contraseña o negocio incorrectos.");
  if (user.estado === "suspendido" || user.estado === "baja") {
    throw new HttpError(403, "Esta cuenta está suspendida. Comunicate con soporte.");
  }

  resetIntentos(ip);
  await crearSesion(c, user.id, user.usuario, user.rol, user.negocio_id ?? null);
  return c.json({ ok: true, usuario: user.usuario, rol: user.rol });
});

auth.post("/logout", (c) => {
  cerrarSesion(c);
  return c.json({ ok: true });
});

/** Cambiar la propia contraseña (requiere sesión). */
auth.post("/password", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const actual = texto(body.actual, "contraseña actual", { max: 200 })!;
  const nueva = texto(body.nueva, "contraseña nueva", { max: 200 })!;
  if (nueva.length < 6) throw new HttpError(400, "La contraseña nueva tiene que tener al menos 6 caracteres.");

  const uid = c.get("usuario").uid;
  const user = await c.env.DB.prepare(`SELECT password_hash FROM usuarios WHERE id = ?`)
    .bind(uid)
    .first<{ password_hash: string }>();
  if (!user || !(await verifyPassword(actual, user.password_hash))) {
    throw new HttpError(400, "La contraseña actual no es correcta.");
  }
  const hash = await hashPassword(nueva);
  await c.env.DB.prepare(`UPDATE usuarios SET password_hash = ? WHERE id = ?`).bind(hash, uid).run();
  return c.json({ ok: true });
});

/** Agregar otro usuario, con rol (requiere sesión de dueño). */
auth.post("/usuarios", requireAuth, async (c) => {
  if (!esDuenoOSoporte(c.get("usuario").rol)) {
    throw new HttpError(403, "Solo el dueño puede agregar usuarios.");
  }
  const body = await c.req.json().catch(() => ({}));
  const usuario = texto(body.usuario, "usuario", { max: 60 })!;
  const password = texto(body.password, "contraseña", { max: 200 })!;
  const rol = enumerado(body.rol ?? "empleado", "rol", ["dueño", "empleado"]);
  if (password.length < 6) throw new HttpError(400, "La contraseña tiene que tener al menos 6 caracteres.");

  const neg = negocioDe(c);
  const existe = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE negocio_id = ? AND usuario = ?`)
    .bind(neg, usuario)
    .first();
  if (existe) throw new HttpError(409, "Ya existe un usuario con ese nombre.");

  const hash = await hashPassword(password);
  await c.env.DB.prepare(`INSERT INTO usuarios (negocio_id, usuario, password_hash, rol) VALUES (?, ?, ?, ?)`)
    .bind(neg, usuario, hash, rol)
    .run();
  return c.json({ ok: true });
});

/** Listar usuarios (sin hash), solo dueño. */
auth.get("/usuarios", requireAuth, async (c) => {
  if (!esDuenoOSoporte(c.get("usuario").rol)) {
    throw new HttpError(403, "Solo el dueño puede ver los usuarios.");
  }
  const rows = await c.env.DB
    .prepare(`SELECT id, usuario, rol, creado_en FROM usuarios
              WHERE negocio_id = ? AND rol NOT IN ('soporte','super') ORDER BY id`)
    .bind(negocioDe(c))
    .all();
  return c.json({ usuarios: rows.results ?? [] });
});
