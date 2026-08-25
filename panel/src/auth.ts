/**
 * Autenticación del panel. Mismo mecanismo que la app de cada negocio
 * (PBKDF2 + cookie firmada con HMAC, todo con WebCrypto, sin dependencias),
 * pero con su propia tabla de usuarios y su propio secreto.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, Variables } from "./tipos";

const PBKDF2_ITERS = 100_000;
const COOKIE = "panel_sesion";
const SESSION_TTL_S = 60 * 60 * 12; // 12 horas: es un panel de administración

const enc = new TextEncoder();
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

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

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

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
  const salt = b64urlDecode(parts[2]);
  const expected = b64urlDecode(parts[3]);
  const actual = await derive(password, salt, parseInt(parts[1], 10));
  return timingSafeEqual(actual, expected);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bs(enc.encode(secret)), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

interface Sesion {
  uid: number;
  usuario: string;
  exp: number;
}

async function firmar(payload: Sesion, secret: string): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, bs(enc.encode(body))));
  return `${body}.${b64urlEncode(sig)}`;
}

async function verificar(token: string, secret: string): Promise<Sesion | null> {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, bs(b64urlDecode(token.slice(dot + 1))), bs(enc.encode(body)));
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as Sesion;
    if (typeof p.exp !== "number" || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

function esHttps(c: { req: { url: string } }): boolean {
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function crearSesion(c: any, uid: number, usuario: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const token = await firmar({ uid, usuario, exp }, c.env.SESSION_SECRET);
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

export async function leerSesion(c: any): Promise<{ uid: number; usuario: string } | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const p = await verificar(token, c.env.SESSION_SECRET);
  return p ? { uid: p.uid, usuario: p.usuario } : null;
}

/** Middleware: sin sesión válida, al login. Es un panel HTML, así que redirige. */
export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  const s = await leerSesion(c);
  if (!s) return c.redirect("/login");
  c.set("admin", s);
  await next();
};

// ── Rate limiting básico del login (memoria del isolate) ────
const intentos = new Map<string, { n: number; hasta: number }>();

export function permitirIntento(ip: string): boolean {
  const ahora = Date.now();
  const e = intentos.get(ip);
  if (!e || ahora > e.hasta) {
    intentos.set(ip, { n: 1, hasta: ahora + 15 * 60 * 1000 });
    return true;
  }
  e.n++;
  return e.n <= 10;
}
