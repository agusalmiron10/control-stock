/**
 * Autenticación: hash de contraseñas (PBKDF2 vía WebCrypto), cookie de sesión
 * firmada (HMAC-SHA256) y middleware que exige sesión válida.
 * Sin dependencias externas: todo con WebCrypto, disponible en Workers.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, Variables, Rol } from "./types";

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
  exp: number; // epoch segundos
}

async function signToken(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bs(enc.encode(body))));
  return `${body}.${b64urlEncode(sig)}`;
}

async function verifyToken(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = b64urlDecode(token.slice(dot + 1));
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, bs(sig), bs(enc.encode(body)));
  if (!ok) return null;
  try {
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

export async function crearSesion(c: any, uid: number, usuario: string, rol: Rol): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const token = await signToken({ uid, usuario, rol, exp }, c.env.SESSION_SECRET);
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
export async function leerSesionOpcional(c: any): Promise<{ uid: number; usuario: string; rol: Rol } | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const payload = await verifyToken(token, c.env.SESSION_SECRET);
  return payload ? { uid: payload.uid, usuario: payload.usuario, rol: payload.rol } : null;
}

/** Middleware: exige sesión válida en todas las rutas de datos. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: "No autenticado. Iniciá sesión." }, 401);
  const payload = await verifyToken(token, c.env.SESSION_SECRET);
  if (!payload) return c.json({ error: "Sesión vencida. Volvé a iniciar sesión." }, 401);
  c.set("usuario", { uid: payload.uid, usuario: payload.usuario, rol: payload.rol ?? "dueño" });
  await next();
};

/** Middleware: exige rol "dueño". Usar después de requireAuth. */
export const requireDueno: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (c.get("usuario").rol !== "dueño") {
    return c.json({ error: "Esta información es solo para el dueño de la cuenta." }, 403);
  }
  await next();
};

// ── Rate limiting básico del login (en memoria del isolate) ──
const intentos = new Map<string, { count: number; resetAt: number }>();
const MAX_INTENTOS = 8;
const VENTANA_MS = 5 * 60 * 1000;

export function loginPermitido(ip: string): boolean {
  const ahora = Date.now();
  const reg = intentos.get(ip);
  if (!reg || reg.resetAt < ahora) {
    intentos.set(ip, { count: 1, resetAt: ahora + VENTANA_MS });
    return true;
  }
  reg.count++;
  return reg.count <= MAX_INTENTOS;
}

export function resetIntentos(ip: string): void {
  intentos.delete(ip);
}
