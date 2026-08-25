#!/usr/bin/env node
/**
 * Genera UUIDs para todas las herramientas que tienen id NULL.
 * Produce un archivo SQL que se ejecuta con wrangler d1 execute.
 */
import { randomUUID } from "crypto";
import { writeFileSync } from "fs";

// 96 herramientas con rowid 1-96
const lines = [];
for (let rowid = 1; rowid <= 96; rowid++) {
  const uuid = randomUUID();
  lines.push(`UPDATE herramientas SET id = '${uuid}' WHERE rowid = ${rowid};`);
}

const sql = lines.join("\n") + "\n";
writeFileSync("scripts/fix_null_ids.sql", sql);
console.log(`Generado fix_null_ids.sql con ${lines.length} UPDATEs.`);
