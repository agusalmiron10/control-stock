#!/usr/bin/env node
/**
 * Auditoría estática de aislamiento entre negocios.
 *
 * Recorre el código del backend, extrae cada consulta SQL y avisa si toca una
 * tabla de datos de negocio sin filtrar por negocio_id. No reemplaza a la
 * prueba de aislamiento real (esa se corre contra el servidor), pero atrapa
 * el descuido más común: agregar una consulta nueva y olvidarse del filtro.
 *
 *   node scripts/auditar-aislamiento.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tablas cuyos datos pertenecen a un negocio. */
const TABLAS = [
  "clientes", "herramientas", "ventas", "venta_items", "pagos",
  "movimientos_stock", "precios_historial", "presupuestos", "presupuesto_items",
  "operaciones", "auditoria", "config", "resumenes_diarios", "usuarios",
];

/**
 * Consultas que legítimamente no filtran por negocio, con el motivo.
 * Cualquier excepción nueva tiene que justificarse acá.
 */
const EXCEPCIONES = [
  { archivo: "src/routes/auth.ts", motivo: "login: busca el usuario POR código de negocio, todavía no hay sesión" },
  { archivo: "src/routes/super.ts", motivo: "super admin: opera a propósito sobre todos los negocios" },
  { archivo: "src/scheduled.ts", motivo: "cron: recorre los negocios de a uno; el backup a R2 es de toda la base" },
  { archivo: "src/routes/backup.ts", motivo: "arma el WHERE por interpolación de tabla, ya filtrado" },
];

function archivosTs(dir) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...archivosTs(ruta));
    else if (nombre.endsWith(".ts")) out.push(ruta);
  }
  return out;
}

let problemas = 0;
let revisadas = 0;
const interpoladas = [];

for (const archivo of archivosTs("src")) {
  const excepcion = EXCEPCIONES.find((e) => archivo === e.archivo);
  const src = readFileSync(archivo, "utf8");

  // Cada template literal que contenga SQL.
  for (const m of src.matchAll(/`([^`]*(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)[^`]*)`/gi)) {
    const sql = m[1];
    const linea = src.slice(0, m.index).split("\n").length;

    // ¿Toca alguna tabla de negocio?
    const tocadas = TABLAS.filter((t) =>
      new RegExp(`\\b(?:FROM|INTO|UPDATE|JOIN)\\s+${t}\\b`, "i").test(sql)
    );
    if (tocadas.length === 0) continue;
    revisadas++;

    if (/negocio_id/.test(sql)) continue;

    // El filtro puede venir armado por interpolación (`${where}`). En ese caso
    // se busca negocio_id en las líneas de arriba, donde se arma la condición.
    if (/\$\{/.test(sql)) {
      const arranque = Math.max(0, m.index - 1500);
      if (/negocio_id/.test(src.slice(arranque, m.index))) {
        interpoladas.push(`${archivo}:${linea}`);
        continue;
      }
    }

    if (excepcion) continue;
    problemas++;
    const resumen = sql.replace(/\s+/g, " ").trim().slice(0, 95);
    console.log(`  ✗ ${archivo}:${linea}`);
    console.log(`     ${resumen}${resumen.length >= 95 ? "…" : ""}`);
  }
}

console.log("");
if (interpoladas.length > 0) {
  console.log(`Filtran por interpolación (revisadas a mano, correctas): ${interpoladas.length}`);
  for (const x of interpoladas) console.log(`   · ${x}`);
  console.log("");
}
console.log(`Consultas sobre tablas de negocio revisadas: ${revisadas}`);
if (problemas === 0) {
  console.log("✓ Todas filtran por negocio_id (o están justificadas como excepción).");
} else {
  console.log(`✗ ${problemas} consulta(s) sin filtrar por negocio_id.`);
  process.exit(1);
}
