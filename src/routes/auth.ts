import { Hono } from "hono";
import type { Env, Variables, Rol } from "../types";
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

function ipDe(c: any): string {
  return c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
}

/** Estado: si hace falta crear el primer usuario y si hay sesión activa. */
auth.get("/status", async (c) => {
  const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM usuarios`).first<{ n: number }>();
  const needsSetup = (row?.n ?? 0) === 0;
  const sesion = await leerSesionOpcional(c);
  return c.json({
    needsSetup,
    authenticated: !!sesion,
    usuario: sesion?.usuario ?? null,
    rol: sesion?.rol ?? null,
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
  const res = await c.env.DB.prepare(`INSERT INTO usuarios (usuario, password_hash, rol) VALUES (?, ?, 'dueño')`)
    .bind(usuario, hash)
    .run();

  await crearSesion(c, Number(res.meta.last_row_id), usuario, "dueño");
  return c.json({ ok: true, usuario, rol: "dueño" });
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

  const user = await c.env.DB.prepare(`SELECT id, usuario, password_hash, rol FROM usuarios WHERE usuario = ?`)
    .bind(usuario)
    .first<{ id: number; usuario: string; password_hash: string; rol: Rol }>();

  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok || !user) throw new HttpError(401, "Usuario o contraseña incorrectos.");

  resetIntentos(ip);
  await crearSesion(c, user.id, user.usuario, user.rol);
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
  if (c.get("usuario").rol !== "dueño") {
    throw new HttpError(403, "Solo el dueño puede agregar usuarios.");
  }
  const body = await c.req.json().catch(() => ({}));
  const usuario = texto(body.usuario, "usuario", { max: 60 })!;
  const password = texto(body.password, "contraseña", { max: 200 })!;
  const rol = enumerado(body.rol ?? "empleado", "rol", ["dueño", "empleado"]);
  if (password.length < 6) throw new HttpError(400, "La contraseña tiene que tener al menos 6 caracteres.");

  const existe = await c.env.DB.prepare(`SELECT id FROM usuarios WHERE usuario = ?`).bind(usuario).first();
  if (existe) throw new HttpError(409, "Ya existe un usuario con ese nombre.");

  const hash = await hashPassword(password);
  await c.env.DB.prepare(`INSERT INTO usuarios (usuario, password_hash, rol) VALUES (?, ?, ?)`)
    .bind(usuario, hash, rol)
    .run();
  return c.json({ ok: true });
});

/** Listar usuarios (sin hash), solo dueño. */
auth.get("/usuarios", requireAuth, async (c) => {
  if (c.get("usuario").rol !== "dueño") {
    throw new HttpError(403, "Solo el dueño puede ver los usuarios.");
  }
  const rows = await c.env.DB.prepare(`SELECT id, usuario, rol, creado_en FROM usuarios ORDER BY id`).all();
  return c.json({ usuarios: rows.results ?? [] });
});
