/**
 * Cifrado en reposo de la clave privada del certificado ARCA de cada negocio.
 * AES-256-GCM con la clave maestra del secret CERT_ENC_KEY (una sola, para
 * toda la instalación — cada negocio tiene su propio IV, así que dos
 * negocios con la misma clave privada no producen el mismo ciphertext).
 *
 * El certificado público (cert_pem) no se cifra: no es secreto. La clave
 * privada nunca sale de este archivo hacia una respuesta HTTP.
 */
import type { Env } from "../types";

const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

function b64Encode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64Decode(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function claveMaestra(env: Env): Promise<CryptoKey> {
  const raw = b64Decode(env.CERT_ENC_KEY);
  return crypto.subtle.importKey("raw", bs(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export interface ClavePrivadaCifrada {
  ciphertext: string; // base64
  iv: string; // base64
}

export async function cifrarClavePrivada(env: Env, pemClave: string): Promise<ClavePrivadaCifrada> {
  const key = await claveMaestra(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(enc.encode(pemClave)));
  return { ciphertext: b64Encode(new Uint8Array(cipher)), iv: b64Encode(iv) };
}

export async function descifrarClavePrivada(env: Env, cifrado: ClavePrivadaCifrada): Promise<string> {
  const key = await claveMaestra(env);
  const iv = b64Decode(cifrado.iv);
  const ciphertext = b64Decode(cifrado.ciphertext);
  const plano = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bs(iv) }, key, bs(ciphertext));
  return new TextDecoder().decode(plano);
}
