// Genera seed/demo.sql: precios reales en los 41 productos ARBELL + 50 clientes
// con compras, mezclando deudores, pagos a la mitad y pagos completos.
// Todo en centavos, con stock/movimientos/imputación coherentes.
import { writeFileSync } from "node:fs";

// ── RNG determinístico (LCG) ────────────────────────────────
let seed = 987654321;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const esc = (s) => String(s).replace(/'/g, "''");

// ── Productos con precio minorista (pesos) ──────────────────
const PRECIOS = {
  "CF-35": 9500, "CF-30": 8500, "CF-25": 7500, "CF-MINI": 5500,
  "MASA-1": 12000, "MASA-114": 14000, "MASA-112": 16000, "MASA-2": 19000, "MASA-5": 38000,
  "CLAVO-G": 4500, "CLAVO-M": 4200, "CLAVO-CH": 4000,
  "CUCH-7": 8000, "CUCH-8": 9000,
  "HACHA": 22000, "HACHITA": 15000, "PIQUETA": 18000, "HACHUELA": 16000,
  "BARR-60": 16000, "BARR-80": 21000, "BARR-100": 26000, "BARR-120": 31000, "BARRETON-25": 12000,
  "RUEDA-HORM": 45000, "RUEDA-CAD": 38000, "RUEDA-MAC": 52000,
  "TEN-9": 11000, "TEN-12": 14000,
  "GRINFA-6": 13000, "GRINFA-8": 15000, "GRINFA-10": 18000, "GRINFA-12": 22000,
  "GRINFA-16": 28000, "GRINFA-20": 35000, "GRINFA-25": 42000,
  "PICO": 24000, "PALA-CANO": 19000, "PALA-MAD": 17000, "CABO-CANO": 6000,
  "BALDE-ALB": 5000, "PALA-GER": 21000,
};
const NOMBRES = {
  "CF-35": "Cortafierro y punta N°35", "CF-30": "Cortafierro y punta N°30", "CF-25": "Cortafierro y punta N°25", "CF-MINI": "Cortafierro y punta Mini",
  "MASA-1": "Masa 1 kg", "MASA-114": "Masa 1 1/4 kg", "MASA-112": "Masa 1 1/2 kg", "MASA-2": "Masa 2 kg", "MASA-5": "Masa 5 kg",
  "CLAVO-G": "Clavos grandes", "CLAVO-M": "Clavos medianos", "CLAVO-CH": "Clavos chicos",
  "CUCH-7": 'Cuchara 7"', "CUCH-8": 'Cuchara 8"',
  "HACHA": "Hacha", "HACHITA": "Hachita", "PIQUETA": "Piqueta", "HACHUELA": "Hachuela",
  "BARR-60": "Barreta 60", "BARR-80": "Barreta 80", "BARR-100": "Barreta 100", "BARR-120": "Barreta 120", "BARRETON-25": "Barretón 25",
  "RUEDA-HORM": "Rueda hormigonera", "RUEDA-CAD": "Rueda cadenilla", "RUEDA-MAC": "Rueda maciza",
  "TEN-9": 'Tenaza 9"', "TEN-12": 'Tenaza 12"',
  "GRINFA-6": "Grinfa N°6", "GRINFA-8": "Grinfa N°8", "GRINFA-10": "Grinfa N°10", "GRINFA-12": "Grinfa N°12",
  "GRINFA-16": "Grinfa N°16", "GRINFA-20": "Grinfa N°20", "GRINFA-25": "Grinfa N°25",
  "PICO": "Pico", "PALA-CANO": "Palas de caño", "PALA-MAD": "Palas de madera", "CABO-CANO": "Cabo de caño",
  "BALDE-ALB": "Balde de albañil", "PALA-GER": "Palas de Gerardi",
};
const CODIGOS = Object.keys(PRECIOS);

// precios en centavos: minorista, mayorista (~82%), costo (~55%)
const precioCent = {};
for (const c of CODIGOS) {
  const min = PRECIOS[c] * 100;
  precioCent[c] = {
    min,
    may: Math.round(PRECIOS[c] * 0.82) * 100,
    costo: Math.round(PRECIOS[c] * 0.55) * 100,
  };
}

// ── Clientes ────────────────────────────────────────────────
const NOMBRE_PILA = ["Juan","Carlos","Miguel","Roberto","Jorge","Luis","Sergio","Diego","Pablo","Marcelo","Fernando","Gustavo","Alejandro","Daniel","Ricardo","Héctor","Raúl","Oscar","Rubén","Walter","Ariel","Damián","Ramón","Gabriel","Matías","Nicolás","Leandro","Cristian","Maximiliano","Facundo","Lucas","Martín","Andrés","Emiliano","María","Laura","Silvina","Vanesa","Romina","Natalia","Gabriela","Carla","Verónica","Sabrina"];
const APELLIDO = ["Pérez","Gómez","Rodríguez","Fernández","López","Martínez","García","Sánchez","Romero","Sosa","Torres","Álvarez","Ruiz","Ramírez","Flores","Benítez","Acosta","Medina","Herrera","Aguirre","Cabrera","Ríos","Godoy","Molina","Ortiz","Silva","Núñez","Luna","Juárez","Cardozo","Ferreyra","Vega","Coria","Ledesma","Peralta","Bravo","Ojeda","Villalba","Maldonado","Quiroga"];
const NEGOCIOS = ["Corralón El Roble","Ferretería La Esquina","Corralón San Cayetano","Materiales Don José","Ferretería El Tornillo","Corralón La Barreta","Ferretería Sur","Corralón Norte","Ferretería El Yunque","Corralón Los Andes","Materiales El Constructor","Ferretería Industrial Haedo"];
const LOCALIDADES = ["Morón","San Justo","Ramos Mejía","Haedo","Ituzaingó","Castelar","Merlo","Moreno","San Martín","Caseros","Ciudadela","Lomas de Zamora","Banfield","Lanús","Avellaneda","Quilmes","Berazategui","Tigre","San Fernando","Vicente López","González Catán","Laferrere","Isidro Casanova","El Palomar","Hurlingham"];

const usados = new Set();
function nombreCliente(i) {
  if (i < NEGOCIOS.length) return NEGOCIOS[i];
  let n;
  do { n = `${pick(NOMBRE_PILA)} ${pick(APELLIDO)}`; } while (usados.has(n));
  usados.add(n);
  return n;
}
function telefono() {
  return `11 ${ri(3000, 6999)}-${String(ri(0, 9999)).padStart(4, "0")}`;
}

const N_CLIENTES = 50;
const clientes = [];
for (let i = 1; i <= N_CLIENTES; i++) {
  clientes.push({ id: i, nombre: nombreCliente(i - 1), localidad: pick(LOCALIDADES), telefono: telefono() });
}

// ── Ventas + items + pagos ──────────────────────────────────
const BASE = Date.UTC(2026, 2, 1); // 2026-03-01
function fechaAlAzar() {
  return new Date(BASE + ri(0, 141) * 86400000).toISOString().slice(0, 10);
}

const ventas = [];
const items = [];
const pagos = [];
let ventaId = 0;
const MEDIOS = ["efectivo", "transferencia", "cheque"];
let nFull = 0, nHalf = 0, nNone = 0;

for (const cl of clientes) {
  const nVentas = ri(1, 3);
  for (let v = 0; v < nVentas; v++) {
    ventaId++;
    const fecha = fechaAlAzar();
    const mayorista = rnd() < 0.4;
    const nItems = ri(1, 4);
    const prods = [...CODIGOS].sort(() => rnd() - 0.5).slice(0, nItems);
    let subtotal = 0;
    const misItems = [];
    for (const cod of prods) {
      const cant = mayorista ? ri(3, 12) : ri(1, 5);
      const pu = mayorista ? precioCent[cod].may : precioCent[cod].min;
      const sub = cant * pu;
      subtotal += sub;
      misItems.push({ cod, cant, pu, sub });
    }
    // descuento ocasional
    let descuento = 0;
    if (rnd() < 0.15) descuento = Math.round((subtotal * ri(5, 10)) / 100);
    const total = subtotal - descuento;
    ventas.push({ id: ventaId, cliente_id: cl.id, fecha, subtotal, descuento, total });
    for (const it of misItems) items.push({ venta_id: ventaId, ...it });

    // pago: 40% completo, 30% mitad, 30% nada
    const r = rnd();
    if (r < 0.40) { pagos.push({ cliente_id: cl.id, venta_id: ventaId, fecha, monto: total, medio: pick(MEDIOS) }); nFull++; }
    else if (r < 0.70) { pagos.push({ cliente_id: cl.id, venta_id: ventaId, fecha, monto: Math.round(total / 2), medio: pick(MEDIOS) }); nHalf++; }
    else { nNone++; }
  }
}

// Algunos pagos "a cuenta" (sin venta) para ejercitar FIFO / saldo a favor
for (let k = 0; k < 6; k++) {
  const cl = pick(clientes);
  pagos.push({ cliente_id: cl.id, venta_id: null, fecha: fechaAlAzar(), monto: ri(5000, 20000) * 100, medio: "transferencia" });
}

// ── Stock: producción inicial + movimientos por venta ───────
const vendidoPorCod = {};
for (const it of items) vendidoPorCod[it.cod] = (vendidoPorCod[it.cod] || 0) + it.cant;
const finalStock = {}, inicial = {}, running = {};
for (const cod of CODIGOS) {
  finalStock[cod] = ri(15, 90);
  inicial[cod] = finalStock[cod] + (vendidoPorCod[cod] || 0);
  running[cod] = inicial[cod];
}
const ventasOrden = [...ventas].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id - b.id));

// ── Emitir SQL ──────────────────────────────────────────────
const L = [];
L.push("-- DATOS DE DEMO: precios + 50 clientes con compras (deudores, mitad y completo).");
L.push("-- Generado por scratchpad/gen_demo.mjs. Reemplaza clientes/ventas/pagos; conserva herramientas.");
L.push("PRAGMA defer_foreign_keys = TRUE;");
L.push("DELETE FROM pagos;");
L.push("DELETE FROM venta_items;");
L.push("DELETE FROM movimientos_stock;");
L.push("DELETE FROM ventas;");
L.push("DELETE FROM precios_historial;");
L.push("DELETE FROM clientes;");
L.push("DELETE FROM sqlite_sequence WHERE name IN ('clientes','ventas','venta_items','pagos','movimientos_stock','precios_historial');");

L.push("\n-- Precios, costo y stock de las herramientas");
for (const cod of CODIGOS) {
  const p = precioCent[cod];
  L.push(`UPDATE herramientas SET precio=${p.min}, precio_mayor=${p.may}, costo=${p.costo}, stock=${finalStock[cod]} WHERE codigo='${cod}';`);
}

const HID = (cod) => `(SELECT id FROM herramientas WHERE codigo='${cod}')`;

L.push("\n-- Clientes");
for (const cl of clientes) {
  L.push(`INSERT INTO clientes (id, nombre, localidad, telefono, activo) VALUES (${cl.id}, '${esc(cl.nombre)}', '${esc(cl.localidad)}', '${esc(cl.telefono)}', 1);`);
}

L.push("\n-- Ventas");
for (const v of ventas) {
  L.push(`INSERT INTO ventas (id, numero, cliente_id, fecha, subtotal, descuento, total, anulada) VALUES (${v.id}, ${v.id}, ${v.cliente_id}, '${v.fecha}', ${v.subtotal}, ${v.descuento}, ${v.total}, 0);`);
}

L.push("\n-- Items de venta (precio y nombre congelados)");
for (const it of items) {
  L.push(`INSERT INTO venta_items (venta_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal) VALUES (${it.venta_id}, ${HID(it.cod)}, '${esc(NOMBRES[it.cod])}', ${it.cant}, ${it.pu}, ${it.sub});`);
}

L.push("\n-- Movimientos: producción inicial");
for (const cod of CODIGOS) {
  L.push(`INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, motivo) VALUES (${HID(cod)}, '2026-02-15', 'produccion', ${inicial[cod]}, ${inicial[cod]}, 'Producción inicial');`);
}
L.push("\n-- Movimientos: ventas (stock corriente)");
for (const v of ventasOrden) {
  const its = items.filter((i) => i.venta_id === v.id);
  for (const it of its) {
    running[it.cod] -= it.cant;
    L.push(`INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id) VALUES (${HID(it.cod)}, '${v.fecha}', 'venta', ${-it.cant}, ${running[it.cod]}, ${v.id});`);
  }
}

L.push("\n-- Pagos");
for (const p of pagos) {
  L.push(`INSERT INTO pagos (cliente_id, venta_id, fecha, monto, medio) VALUES (${p.cliente_id}, ${p.venta_id ?? "NULL"}, '${p.fecha}', ${p.monto}, '${p.medio}');`);
}

// Se ejecuta desde la raíz del proyecto:  node seed/gen_demo.mjs
writeFileSync(new URL("./demo.sql", import.meta.url), L.join("\n") + "\n");

console.log("Generado seed/demo.sql");
console.log(`Clientes: ${clientes.length}`);
console.log(`Ventas: ${ventas.length} | Items: ${items.length} | Pagos: ${pagos.length}`);
console.log(`Pagos completos: ${nFull} | a la mitad: ${nHalf} | sin pagar (deudores): ${nNone}`);
console.log(`Statements: ${L.length}`);
