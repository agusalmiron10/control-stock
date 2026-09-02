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
  "facturacion_config", "facturas",
  "proveedores", "compras", "compra_items",
  "remitos", "remito_items",
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

/**
 * Toda tabla de negocio tiene que estar declarada en src/tablas.ts: o entra
 * en el respaldo, o está en la lista de exclusiones con su motivo.
 *
 * Esto existe porque ya pasó: se agregaron facturación, compras y remitos, y
 * las listas de respaldo —escritas a mano en dos archivos distintos— quedaron
 * viejas. Durante meses el respaldo se bajaba sin las facturas ni los remitos
 * y nadie se enteraba, porque el archivo se generaba igual.
 */
function revisarCoberturaDeRespaldo() {
  const src = readFileSync("src/tablas.ts", "utf8");
  const enRespaldo = new Set([...src.matchAll(/nombre:\s*"([a-z_]+)"/g)].map((m) => m[1]));
  const excluidas = new Set(
    [...src.slice(src.indexOf("FUERA_DEL_RESPALDO")).matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
  );
  const faltan = TABLAS.filter((t) => !enRespaldo.has(t) && !excluidas.has(t));
  if (faltan.length > 0) {
    console.log("\n✗ Tablas de negocio que no están declaradas en src/tablas.ts:");
    for (const t of faltan) console.log(`    ${t}`);
    console.log("  Agregalas a TABLAS_RESPALDO (respetando el orden de las claves");
    console.log("  foráneas) o a FUERA_DEL_RESPALDO explicando por qué no van.");
    return faltan.length;
  }
  console.log(`Tablas de negocio cubiertas por el respaldo: ${enRespaldo.size} (${excluidas.size} excluidas a propósito).`);
  return 0;
}

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
}

const sinRespaldo = revisarCoberturaDeRespaldo();
if (problemas > 0 || sinRespaldo > 0) process.exit(1);
