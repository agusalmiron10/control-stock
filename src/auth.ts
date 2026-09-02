/**
 * Autenticación: hash de contraseñas (PBKDF2 vía WebCrypto), cookie de sesión
 * firmada (HMAC-SHA256) y middleware que exige sesión válida.
 * Sin dependencias externas: todo con WebCrypto, disponible en Workers.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { esDuenoOSoporte, type Env, type Variables, type Rol } from "./types";

const PBKDF2_ITERS = 100_000;
const COOKIE = "sesion";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 días

const enc = new TextEncoder();

/** Cast para conciliar Uint8Array con BufferSource (choque de libs DOM/Workers en TS 5.7). */
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

// ── Base64url ───────────────────────────────────────────────
function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Comparación en tiempo constante. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── Hash de contraseña ──────────────────────────────────────
async function derive(password: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", bs(enc.encode(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations: iters },
    key,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${b64urlEncode(salt)}$${b64urlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iters = parseInt(parts[1], 10);
  const salt = b64urlDecode(parts[2]);
  const expected = b64urlDecode(parts[3]);
  const actual = await derive(password, salt, iters);
  return timingSafeEqual(actual, expected);
}

// ── Firma de la sesión (HMAC) ───────────────────────────────
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bs(enc.encode(secret)), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

interface SessionPayload {
  uid: number;
  usuario: string;
  rol: Rol;
  /** Negocio de esta sesión. null = super admin que todavía no entró a ninguno. */
  neg: string | null;
  /** Sesión de soporte, cuando el proveedor entró a un negocio ajeno. */
  ses?: string;
  /**
   * Sólo lectura. Va en el token —firmado con HMAC— y no en la base, para que
   * cada request lo sepa sin una consulta extra y el navegador no lo pueda
   * cambiar.
   */
  ro?: boolean;
  exp: number; // epoch segundos
}

async function signToken(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bs(enc.encode(body))));
  return `${body}.${b64urlEncode(sig)}`;
}

async function verifyToken(token: string, secret: string): Promise<SessionPayload | null> {
  // Todo el cuerpo va en el try: una cookie con basura (base64 inválido en la
  // firma o en el payload) tiene que dar sesión nula, no una excepción que
  // termine en 500. Un token falso es un caso normal, no un error del server.
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const body = token.slice(0, dot);
    const sig = b64urlDecode(token.slice(dot + 1));
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify("HMAC", key, bs(sig), bs(enc.encode(body)));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Cookies ─────────────────────────────────────────────────
function esHttps(c: { req: { url: string } }): boolean {
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function crearSesion(
  c: any, uid: number, usuario: string, rol: Rol, negocioId: string | null,
  soporte?: { sesion: string; soloLectura: boolean }
): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const token = await signToken(
    { uid, usuario, rol, neg: negocioId, exp, ses: soporte?.sesion, ro: soporte?.soloLectura },
    c.env.SESSION_SECRET
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: esHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export function cerrarSesion(c: any): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Lee la sesión si existe y es válida; si no, devuelve null. No corta la request. */
export async function leerSesionOpcional(
  c: any
): Promise<{
  uid: number; usuario: string; rol: Rol; negocioId: string | null;
  sesionSoporte: string | null; soloLectura: boolean;
} | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const p = await verifyToken(token, c.env.SESSION_SECRET);
  return p
    ? { uid: p.uid, usuario: p.usuario, rol: p.rol, negocioId: p.neg ?? null,
        sesionSoporte: p.ses ?? null, soloLectura: p.ro === true }
    : null;
}

/** Middleware: exige sesión válida en todas las rutas de datos. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: "No autenticado. Iniciá sesión." }, 401);
  const payload = await verifyToken(token, c.env.SESSION_SECRET);
  if (!payload) return c.json({ error: "Sesión vencida. Volvé a iniciar sesión." }, 401);
  c.set("usuario", {
    uid: payload.uid,
    usuario: payload.usuario,
    rol: payload.rol ?? "dueño",
    negocioId: payload.neg ?? null,
    sesionSoporte: payload.ses ?? null,
    soloLectura: payload.ro === true,
  });
  await next();
};

/**
 * Middleware: si la visita de soporte es de sólo lectura, no deja escribir.
 *
 * Va UNA sola vez, sobre todas las rutas de datos, y no en cada una: así una
 * ruta nueva no puede olvidarse de respetarlo. Se corta por método HTTP porque
 * es lo único que no depende de que cada endpoint se acuerde de nada.
 *
 * Es una barrera del servidor, no de la pantalla: aunque alguien arme el pedido
 * a mano, no pasa.
 */
export const bloquearSiSoloLectura: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const u = c.get("usuario");
  if (u.soloLectura && c.req.method !== "GET" && c.req.method !== "HEAD") {
    return c.json(
      { error: "Estás mirando esta cuenta en modo sólo lectura. Para cambiar algo, activá el modo edición.", soloLectura: true },
      403
    );
  }
  await next();
};

/**
 * Middleware: además de sesión, exige estar dentro de un negocio. Lo usan
 * todas las rutas de datos — sin negocio no hay nada que mostrar. Un super
 * admin tiene que "entrar" a un negocio primero.
 */
export const requireNegocio: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (!c.get("usuario").negocioId) {
    return c.json({ error: "Elegí un negocio para entrar." }, 409);
  }
  await next();
};

/** Middleware: sólo el proveedor del sistema. */
export const requireSuper: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (c.get("usuario").rol !== "super") {
    return c.json({ error: "No tenés permiso para esto." }, 403);
  }
  await next();
};

/** Middleware: exige rol "dueño". Usar después de requireAuth. */
export const requireDueno: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (!esDuenoOSoporte(c.get("usuario").rol)) {
    return c.json({ error: "Esta información es solo para el dueño de la cuenta." }, 403);
  }
  await next();
};

// ── Rate limiting del login, persistente en D1 ──────────────
//
// Antes vivía en un Map() en memoria del isolate: Cloudflare recicla
// isolates constantemente y corre varios en paralelo, así que el contador se
// reiniciaba solo — el límite estaba en el código pero no bloqueaba de
// verdad a nadie. Ahora vive en la tabla intentos_login (migración 0020).
//
// Se cuenta por IP Y por usuario a la vez, y hace falta pasar los dos: si
// sólo se contara por IP, alguien detrás de la misma IP que muchos clientes
// (una oficina, un proxy) quedaría bloqueado por otro. Si sólo se contara
// por usuario, un atacante podría probar contraseñas contra una cuenta
// rotando de IP sin que nada lo frene.
const MAX_INTENTOS = 8;
const VENTANA_MS = 5 * 60 * 1000;

async function intentoContra(env: Env, clave: string): Promise<boolean> {
  const fila = await env.DB
    .prepare(`SELECT intentos, ultimo_en FROM intentos_login WHERE clave = ?`)
    .bind(clave)
    .first<{ intentos: number; ultimo_en: string }>();

  const ahora = Date.now();
  // El timestamp de SQLite no lleva zona: se interpreta como UTC a mano.
  const ultimo = fila ? new Date(fila.ultimo_en.replace(" ", "T") + "Z").getTime() : 0;
  const dentroDeLaVentana = fila && ahora - ultimo < VENTANA_MS;

  const nuevos = dentroDeLaVentana ? fila!.intentos + 1 : 1;
  await env.DB
    .prepare(
      `INSERT INTO intentos_login (clave, intentos, ultimo_en) VALUES (?, ?, datetime('now'))
       ON CONFLICT(clave) DO UPDATE SET intentos = excluded.intentos, ultimo_en = excluded.ultimo_en`
    )
    .bind(clave, nuevos)
    .run();

  return nuevos <= MAX_INTENTOS;
}

export async function loginPermitido(env: Env, ip: string, usuario: string): Promise<boolean> {
  // Ambas cuentan siempre —no hay cortocircuito—, para que un intento
  // fallido por IP no deje de sumarle al contador del usuario ni viceversa.
  const okIp = await intentoContra(env, `ip:${ip}`);
  const okUsuario = await intentoContra(env, `u:${usuario.toLowerCase()}`);
  return okIp && okUsuario;
}

export async function resetIntentos(env: Env, ip: string, usuario: string): Promise<void> {
  await env.DB
    .prepare(`DELETE FROM intentos_login WHERE clave IN (?, ?)`)
    .bind(`ip:${ip}`, `u:${usuario.toLowerCase()}`)
    .run();
}
