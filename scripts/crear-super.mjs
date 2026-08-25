#!/usr/bin/env node
/**
 * Crea (o blanquea) el usuario del proveedor del sistema: el super admin.
 * Es el único usuario sin negocio — por eso no se puede crear desde la app,
 * que siempre trabaja dentro de un negocio.
 *
 *   node scripts/crear-super.mjs <usuario> <contraseña>            → local
 *   node scripts/crear-super.mjs <usuario> <contraseña> --remoto   → producción
 *
 * Imprime el SQL y lo aplica con wrangler. La contraseña nunca se guarda en
 * texto plano: va el hash PBKDF2, el mismo formato que usa el Worker.
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const ITERS = 100_000;

const b64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERS, 32, "sha256");
  return `pbkdf2$${ITERS}$${b64url(salt)}$${b64url(hash)}`;
}

const [usuario, password, ...resto] = process.argv.slice(2);
const remoto = resto.includes("--remoto");

if (!usuario || !password) {
  console.error("Uso: node scripts/crear-super.mjs <usuario> <contraseña> [--remoto]");
  process.exit(1);
}
if (password.length < 6) {
  console.error("La contraseña tiene que tener al menos 6 caracteres.");
  process.exit(1);
}

const hash = hashPassword(password);
// negocio_id NULL = super admin. UPSERT para poder blanquear la clave después.
const sql = `
DELETE FROM usuarios WHERE negocio_id IS NULL AND usuario = '${usuario.replace(/'/g, "''")}';
INSERT INTO usuarios (negocio_id, usuario, password_hash, rol)
VALUES (NULL, '${usuario.replace(/'/g, "''")}', '${hash}', 'super');
`.trim();

const args = [
  "wrangler", "d1", "execute", "control-stock",
  remoto ? "--remote" : "--local",
  "--command", sql,
];

console.log(`Creando super admin "${usuario}" en ${remoto ? "PRODUCCIÓN" : "local"}…`);
execFileSync("npx", args, { stdio: "inherit" });
console.log(`\n✓ Listo. Entrá dejando el campo "negocio" vacío, con usuario "${usuario}".`);
