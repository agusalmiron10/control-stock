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
import { MODULOS, modulosPermitidos, type Modulo } from "../config";

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
    return c.json({ needsSetup, authenticated: false, usuario: null, rol: null, negocio: null, modulosPermitidos: null });
  }

  // null = sin restricción (ve todo lo que el negocio tenga activo). Sólo
  // tiene sentido para un empleado con una lista explícita cargada.
  const permitidos = sesion?.negocioId ? await modulosPermitidos(c.env, sesion.negocioId, sesion.uid) : null;
  const propia = sesion
    ? await c.env.DB.prepare(`SELECT foto FROM usuarios WHERE id = ?`).bind(sesion.uid).first<{ foto: string | null }>()
    : null;

  return c.json({
    needsSetup,
    authenticated: !!sesion,
    usuario: sesion?.usuario ?? null,
    rol: sesion?.rol ?? null,
    negocio,
    modulosPermitidos: permitidos,
    foto: propia?.foto ?? null,
    // Visita de soporte: la pantalla necesita saber en qué modo está para
    // avisarlo. Igual el que manda es el servidor — la UI sólo lo muestra.
    soporte: sesion?.sesionSoporte
      ? { modo: sesion.soloLectura ? "lectura" : "edicion" }
      : null,
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

interface CandidatoLogin {
  id: number;
  usuario: string;
  password_hash: string;
  rol: Rol;
  negocio_id: string | null;
  negocio_codigo: string | null;
  negocio_nombre: string | null;
  estado: string | null;
}

/**
 * Login. No pide código de negocio: el usuario y la contraseña alcanzan
 * porque un mismo nombre de usuario casi nunca se repite entre negocios
 * distintos. Sólo en ese caso rarísimo (mismo usuario Y misma contraseña en
 * más de un negocio) se le pide elegir cuál — con un selector de nombres,
 * nunca con un código para escribir a mano.
 */
auth.post("/login", async (c) => {
  const ip = ipDe(c);
  const body = await c.req.json().catch(() => ({}));
  const usuario = texto(body.usuario, "usuario", { max: 60 })!;
  const password = texto(body.password, "contraseña", { max: 200 })!;

  if (!(await loginPermitido(c.env, ip, usuario))) {
    throw new HttpError(429, "Demasiados intentos. Esperá unos minutos y probá de nuevo.");
  }
  // Sólo se manda cuando el paso anterior devolvió una lista para elegir.
  const negocioElegido = texto(body.negocio_id, "negocio", { requerido: false, max: 64 });

  const candidatos = await c.env.DB
    .prepare(
      `SELECT u.id, u.usuario, u.password_hash, u.rol, u.negocio_id,
              n.codigo AS negocio_codigo, n.nombre AS negocio_nombre, n.estado
       FROM usuarios u LEFT JOIN negocios n ON n.id = u.negocio_id
       WHERE u.usuario = ?`
    )
    .bind(usuario)
    .all<CandidatoLogin>();

  const validos: CandidatoLogin[] = [];
  for (const cand of candidatos.results ?? []) {
    if (await verifyPassword(password, cand.password_hash)) validos.push(cand);
  }

  // Mismo mensaje para usuario o contraseña equivocados: no se puede
  // averiguar si un nombre de usuario existe probando contraseñas.
  if (validos.length === 0) throw new HttpError(401, "Usuario o contraseña incorrectos.");

  let elegido = validos[0];
  if (validos.length > 1) {
    if (negocioElegido) {
      const match = validos.find((v) => (v.negocio_id ?? "proveedor") === negocioElegido);
      if (!match) throw new HttpError(401, "Usuario o contraseña incorrectos.");
      elegido = match;
    } else {
      // Ambigüedad real: esta persona tiene las mismas credenciales en más
      // de un negocio. Se le ofrece elegir por nombre, no por código.
      return c.json({
        eligeNegocio: true,
        opciones: validos.map((v) => ({
          id: v.negocio_id ?? "proveedor",
          nombre: v.negocio_nombre ?? "Proveedor del sistema",
        })),
      });
    }
  }

  if (elegido.estado === "suspendido" || elegido.estado === "baja") {
    throw new HttpError(403, "Esta cuenta está suspendida. Comunicate con soporte.");
  }

  await resetIntentos(c.env, ip, usuario);
  await crearSesion(c, elegido.id, elegido.usuario, elegido.rol, elegido.negocio_id);
  return c.json({ ok: true, usuario: elegido.usuario, rol: elegido.rol });
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

/** Valida una lista de módulos permitidos: null = sin restringir, [] o con nombres = lista explícita. */
function leerModulosPermitidos(body: any): Modulo[] | null {
  if (body.modulos_permitidos == null) return null;
  if (!Array.isArray(body.modulos_permitidos)) {
    throw new HttpError(400, "\"modulos_permitidos\" tiene que ser una lista.");
  }
  for (const m of body.modulos_permitidos) {
    if (!MODULOS.includes(m)) throw new HttpError(400, `"${m}" no es un módulo válido.`);
  }
  return body.modulos_permitidos;
}

/** Agregar otro usuario, con rol y opcionalmente qué módulos puede usar (requiere sesión de dueño). */
auth.post("/usuarios", requireAuth, async (c) => {
  if (!esDuenoOSoporte(c.get("usuario").rol)) {
    throw new HttpError(403, "Solo el dueño puede agregar usuarios.");
  }
  const body = await c.req.json().catch(() => ({}));
  const usuario = texto(body.usuario, "usuario", { max: 60 })!;
  const password = texto(body.password, "contraseña", { max: 200 })!;
  const rol = enumerado(body.rol ?? "empleado", "rol", ["dueño", "empleado"]);
  if (password.length < 6) throw new HttpError(400, "La contraseña tiene que tener al menos 6 caracteres.");
  // Un dueño ve todo — la restricción por módulo sólo aplica a empleados.
  const permitidos = rol === "empleado" ? leerModulosPermitidos(body) : null;

  const neg = negocioDe(c);
  const existe = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE negocio_id = ? AND usuario = ?`)
    .bind(neg, usuario)
    .first();
  if (existe) throw new HttpError(409, "Ya existe un usuario con ese nombre.");

  const hash = await hashPassword(password);
  await c.env.DB.prepare(`INSERT INTO usuarios (negocio_id, usuario, password_hash, rol, modulos_permitidos) VALUES (?, ?, ?, ?, ?)`)
    .bind(neg, usuario, hash, rol, permitidos ? JSON.stringify(permitidos) : null)
    .run();
  return c.json({ ok: true });
});

/** Listar usuarios (sin hash), solo dueño. */
auth.get("/usuarios", requireAuth, async (c) => {
  if (!esDuenoOSoporte(c.get("usuario").rol)) {
    throw new HttpError(403, "Solo el dueño puede ver los usuarios.");
  }
  const rows = await c.env.DB
    .prepare(`SELECT id, usuario, rol, creado_en, modulos_permitidos, foto FROM usuarios
              WHERE negocio_id = ? AND rol NOT IN ('soporte','super') ORDER BY id`)
    .bind(negocioDe(c))
    .all<{ id: number; usuario: string; rol: Rol; creado_en: string; modulos_permitidos: string | null; foto: string | null }>();

  const usuarios = (rows.results ?? []).map((u) => ({
    id: u.id,
    usuario: u.usuario,
    rol: u.rol,
    creado_en: u.creado_en,
    modulos_permitidos: u.modulos_permitidos ? JSON.parse(u.modulos_permitidos) : null,
    foto: u.foto,
  }));
  return c.json({ usuarios });
});

/**
 * Foto de perfil: autogestionada. Cada quien sube y borra la suya propia —
 * ni el dueño ni el proveedor se la pueden poner a otro. Se guarda como data
 * URL ya recortada y comprimida por el navegador (un JPEG chico), con un
 * tope generoso para no dejar crecer la fila sin límite.
 */
const FOTO_MAX_CHARS = 400_000; // ~300KB reales en base64 — de sobra para un avatar recortado

auth.put("/foto", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const foto = texto(body.foto, "foto", { max: FOTO_MAX_CHARS })!;
  if (!foto.startsWith("data:image/")) {
    throw new HttpError(400, "La foto tiene que subirse como imagen (JPEG o PNG).");
  }
  await c.env.DB.prepare(`UPDATE usuarios SET foto = ? WHERE id = ?`).bind(foto, c.get("usuario").uid).run();
  return c.json({ ok: true });
});

auth.delete("/foto", requireAuth, async (c) => {
  await c.env.DB.prepare(`UPDATE usuarios SET foto = NULL WHERE id = ?`).bind(c.get("usuario").uid).run();
  return c.json({ ok: true });
});

/** Cambiar a qué módulos tiene acceso un empleado (requiere sesión de dueño). */
auth.put("/usuarios/:id/modulos", requireAuth, async (c) => {
  if (!esDuenoOSoporte(c.get("usuario").rol)) {
    throw new HttpError(403, "Solo el dueño puede cambiar permisos.");
  }
  const id = Number(c.req.param("id"));
  const neg = negocioDe(c);
  const target = await c.env.DB.prepare(`SELECT rol FROM usuarios WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ rol: Rol }>();
  if (!target) throw new HttpError(404, "Usuario no encontrado.");
  if (target.rol !== "empleado") {
    throw new HttpError(400, "El dueño siempre tiene acceso a todo — no hay nada que restringir.");
  }

  const body = await c.req.json().catch(() => ({}));
  const permitidos = leerModulosPermitidos(body);
  await c.env.DB.prepare(`UPDATE usuarios SET modulos_permitidos = ? WHERE negocio_id = ? AND id = ?`)
    .bind(permitidos ? JSON.stringify(permitidos) : null, neg, id)
    .run();
  return c.json({ ok: true });
});
