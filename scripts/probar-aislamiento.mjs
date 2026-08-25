#!/usr/bin/env node
/**
 * Prueba de aislamiento entre negocios, contra el servidor de verdad.
 *
 * Es la prueba que decide si esto se puede desplegar: crea DOS negocios con
 * datos deliberadamente idénticos (mismo código de producto, mismo nombre de
 * cliente, mismo usuario "admin") y verifica que ninguno pueda ver ni tocar
 * nada del otro. Un dato del negocio A apareciendo en el negocio B es la
 * peor falla posible de este sistema.
 *
 *   npx wrangler dev            (en otra terminal)
 *   node scripts/probar-aislamiento.mjs [http://localhost:8787]
 *
 * Necesita un super admin: node scripts/crear-super.mjs <usuario> <clave>
 */
const BASE = process.argv[2] || "http://localhost:8787";
const SUPER_USUARIO = process.env.SUPER_USUARIO || "agustin";
const SUPER_CLAVE = process.env.SUPER_CLAVE || "super1234";

let fallos = 0;
let pruebas = 0;

function ok(desc) {
  pruebas++;
  console.log(`  ✓ ${desc}`);
}
function mal(desc, detalle) {
  pruebas++;
  fallos++;
  console.log(`  ✗ ${desc}`);
  if (detalle) console.log(`     ${detalle}`);
}
function chequear(cond, desc, detalle) {
  cond ? ok(desc) : mal(desc, detalle);
}

/** Un cliente HTTP que recuerda su cookie: cada sesión es una "persona". */
function sesion(nombre) {
  let cookie = "";
  return {
    nombre,
    async pedir(metodo, ruta, body) {
      const res = await fetch(`${BASE}${ruta}`, {
        method: metodo,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const texto = await res.text();
      let datos;
      try { datos = JSON.parse(texto); } catch { datos = { _crudo: texto.slice(0, 200) }; }
      return { status: res.status, datos };
    },
    get(r) { return this.pedir("GET", r); },
    post(r, b) { return this.pedir("POST", r, b); },
    put(r, b) { return this.pedir("PUT", r, b); },
    del(r) { return this.pedir("DELETE", r); },
  };
}

/** Datos iguales a propósito en los dos negocios: si se mezclan, se nota. */
const IGUALES = {
  producto: { codigo: "MISMO-001", nombre: "Producto de prueba", precio: 100000, stock: 50 },
  cliente: { nombre: "Juan Pérez", telefono: "1122334455" },
  usuario: "admin",
  clave: "prueba1234",
};

async function crearNegocio(sup, nombre, codigo, rubro) {
  const r = await sup.post("/api/super/negocios", {
    nombre, codigo, rubro, estado: "activo",
    usuario: IGUALES.usuario, password: IGUALES.clave,
  });
  if (r.status !== 200) throw new Error(`No se pudo crear ${nombre}: ${JSON.stringify(r.datos)}`);
  return r.datos;
}

/** Carga un cliente, un producto y una venta. Devuelve los ids creados. */
async function cargarDatos(s, sufijo) {
  const cli = await s.post("/api/clientes", { ...IGUALES.cliente, nombre: IGUALES.cliente.nombre });
  if (cli.status !== 200) throw new Error(`cliente (${s.nombre}): ${JSON.stringify(cli.datos)}`);

  const prod = await s.post("/api/herramientas", { ...IGUALES.producto, nombre: `${IGUALES.producto.nombre} ${sufijo}` });
  if (prod.status !== 200) throw new Error(`producto (${s.nombre}): ${JSON.stringify(prod.datos)}`);

  const venta = await s.post("/api/ventas", {
    cliente_id: cli.datos.id,
    items: [{ herramienta_id: prod.datos.id, cantidad: 2, precio_unitario: IGUALES.producto.precio }],
  });
  if (venta.status !== 200) throw new Error(`venta (${s.nombre}): ${JSON.stringify(venta.datos)}`);

  const pago = await s.post("/api/pagos", { cliente_id: cli.datos.id, monto: 5000, medio: "efectivo" });
  if (pago.status !== 200) throw new Error(`pago (${s.nombre}): ${JSON.stringify(pago.datos)}`);

  return { cliente: cli.datos.id, producto: prod.datos.id, venta: venta.datos.id, pago: pago.datos.id };
}

const marca = Date.now().toString(36);

console.log(`Prueba de aislamiento contra ${BASE}\n`);

// ── 1. El proveedor da de alta dos clientes ────────────────────
console.log("1) Alta de dos negocios desde el super admin");
const sup = sesion("super");
const login = await sup.post("/api/auth/login", { usuario: SUPER_USUARIO, password: SUPER_CLAVE });
if (login.status !== 200) {
  console.error(`\nNo pude entrar como super admin (${login.status}): ${JSON.stringify(login.datos)}`);
  console.error(`Creá uno con: node scripts/crear-super.mjs ${SUPER_USUARIO} ${SUPER_CLAVE}`);
  process.exit(1);
}
ok(`entré como super admin "${SUPER_USUARIO}"`);

const A = await crearNegocio(sup, `Ferretería Test ${marca}`, `ferre-${marca}`, "ferreteria");
const B = await crearNegocio(sup, `Kiosko Test ${marca}`, `kiosko-${marca}`, "kiosko");
ok(`negocio A creado: ${A.codigo}`);
ok(`negocio B creado: ${B.codigo}`);

// ── 2. Los dos dueños se llaman "admin" y conviven ─────────────
console.log("\n2) Login de cada dueño (los dos se llaman \"admin\")");
const a = sesion("A");
const b = sesion("B");
const la = await a.post("/api/auth/login", { usuario: IGUALES.usuario, password: IGUALES.clave, negocio: A.codigo });
const lb = await b.post("/api/auth/login", { usuario: IGUALES.usuario, password: IGUALES.clave, negocio: B.codigo });
chequear(la.status === 200, "el dueño de A entra con su código de negocio", JSON.stringify(la.datos));
chequear(lb.status === 200, "el dueño de B entra con su código de negocio", JSON.stringify(lb.datos));

const sinCodigo = sesion("sin");
const lsc = await sinCodigo.post("/api/auth/login", { usuario: IGUALES.usuario, password: IGUALES.clave });
chequear(lsc.status === 401, "sin código de negocio, \"admin\" NO entra", `status ${lsc.status}`);

const cruzado = sesion("cruzado");
const lcr = await cruzado.post("/api/auth/login", { usuario: IGUALES.usuario, password: IGUALES.clave, negocio: "no-existe-" + marca });
chequear(lcr.status === 401, "con un código de negocio inexistente, no entra", `status ${lcr.status}`);

// ── 3. Datos idénticos en los dos ──────────────────────────────
console.log("\n3) Cargo datos idénticos en los dos negocios");
const datosA = await cargarDatos(a, "A");
const datosB = await cargarDatos(b, "B");
ok("mismo código de producto en los dos negocios, sin choque de UNIQUE");
ok("mismo nombre de cliente en los dos negocios");

const va = await a.get("/api/ventas");
const vb = await b.get("/api/ventas");
chequear(
  va.datos.ventas?.[0]?.numero === 1 && vb.datos.ventas?.[0]?.numero === 1,
  "cada negocio numera sus ventas desde 1",
  `A=${va.datos.ventas?.[0]?.numero} B=${vb.datos.ventas?.[0]?.numero}`
);

// ── 4. Listados: cada uno ve sólo lo suyo ──────────────────────
console.log("\n4) Listados: ninguno ve lo del otro");
const LISTADOS = [
  ["/api/clientes", "clientes"],
  ["/api/herramientas", "herramientas"],
  ["/api/ventas", "ventas"],
  ["/api/pagos", "pagos"],
  ["/api/presupuestos", "presupuestos"],
];

// La auditoría viene apagada en el preset de ferretería. La prendo a mano
// porque el registro de quién entró a mirar los datos hay que probarlo igual.
for (const s of [a, b]) {
  const cfg = (await s.get("/api/config")).datos;
  const activos = Object.entries(cfg.modulos ?? {}).filter(([, v]) => v).map(([k]) => k);
  await s.put("/api/config", { ...cfg, modulos: { ...cfg.modulos, auditoria: true } });
  if (!activos.includes("auditoria")) ok(`auditoría activada en ${s.nombre} para la prueba`);
}
LISTADOS.push(["/api/auditoria", "auditoria"]);
const idsB = new Set(Object.values(datosB));
for (const [ruta, campo] of LISTADOS) {
  const r = await a.get(ruta);
  if (r.status !== 200) { mal(`${ruta} responde 200`, `status ${r.status}`); continue; }
  const filas = r.datos[campo] ?? r.datos.items ?? [];
  const intrusos = filas.filter((f) => idsB.has(f.id));
  chequear(intrusos.length === 0, `${ruta}: A no ve nada de B (${filas.length} filas propias)`,
    `se filtraron ${intrusos.length} filas de B`);
}

// ── 5. Acceso directo por id ajeno ─────────────────────────────
console.log("\n5) Pidiendo por id un registro del otro negocio");
const AJENOS = [
  [`/api/clientes/${datosB.cliente}`, "cliente"],
  [`/api/herramientas/${datosB.producto}`, "producto"],
  [`/api/ventas/${datosB.venta}`, "venta"],
];
for (const [ruta, que] of AJENOS) {
  const r = await a.get(ruta);
  chequear(r.status === 404, `A no puede leer el ${que} de B (404)`, `devolvió ${r.status}`);
}

// ── 6. Modificar y borrar lo ajeno ─────────────────────────────
console.log("\n6) Modificando y borrando registros del otro negocio");
const mod = await a.put(`/api/clientes/${datosB.cliente}`, { nombre: "HACKEADO" });
chequear(mod.status === 404, "A no puede editar el cliente de B", `devolvió ${mod.status}`);

const bor = await a.del(`/api/herramientas/${datosB.producto}`);
chequear(bor.status === 404, "A no puede borrar el producto de B", `devolvió ${bor.status}`);

const compB = await b.get(`/api/clientes/${datosB.cliente}`);
chequear(
  compB.status === 200 && compB.datos.cliente?.nombre === IGUALES.cliente.nombre,
  "el cliente de B quedó intacto",
  JSON.stringify(compB.datos).slice(0, 120)
);

// ── 7. Venta con un producto/cliente del otro negocio ──────────
console.log("\n7) Armando una venta con datos del otro negocio");
const ventaCruzada = await a.post("/api/ventas", {
  cliente_id: datosB.cliente,
  items: [{ herramienta_id: datosB.producto, cantidad: 1, precio_unitario: 100 }],
});
chequear(ventaCruzada.status >= 400, "A no puede venderle al cliente de B", `devolvió ${ventaCruzada.status}`);

const ventaMixta = await a.post("/api/ventas", {
  cliente_id: datosA.cliente,
  items: [{ herramienta_id: datosB.producto, cantidad: 1, precio_unitario: 100 }],
});
chequear(ventaMixta.status >= 400, "A no puede vender un producto de B", `devolvió ${ventaMixta.status}`);

// ── 8. Totales del panel y reportes ────────────────────────────
console.log("\n8) Panel y reportes cuentan sólo lo propio");
const panelA = await a.get("/api/panel");
const panelB = await b.get("/api/panel");
chequear(panelA.status === 200 && panelB.status === 200, "el panel responde en los dos negocios");
const totA = JSON.stringify(panelA.datos);
chequear(!totA.includes(datosB.venta) && !totA.includes(datosB.cliente),
  "el panel de A no menciona ids de B");

const expA = await a.get("/api/export/general");
const crudoExp = JSON.stringify(expA.datos);
chequear(expA.status === 200, "la exportación general de A responde", `devolvió ${expA.status}`);
chequear(!crudoExp.includes(datosB.cliente) && !crudoExp.includes(datosB.venta),
  "la exportación general de A no arrastra datos de B");

const expCliB = await a.get(`/api/export/cliente/${datosB.cliente}`);
chequear(expCliB.status === 404, "A no puede exportar la cuenta del cliente de B", `devolvió ${expCliB.status}`);

const bkA = await a.get("/api/backup");
chequear(bkA.status !== 200 || !JSON.stringify(bkA.datos).includes(datosB.cliente),
  "el backup de A no contiene datos de B");

const busq = await a.get(`/api/buscar?q=${encodeURIComponent(IGUALES.cliente.nombre)}`);
const encontrados = JSON.stringify(busq.datos);
chequear(!encontrados.includes(datosB.cliente),
  "la búsqueda global de A no encuentra el cliente de B");

// ── 9. Config y módulos por negocio ────────────────────────────
console.log("\n9) Configuración independiente");
const cfgA = await a.get("/api/config");
const cfgB = await b.get("/api/config");
chequear(cfgA.datos.modulos?.presupuestos === true && cfgB.datos.modulos?.presupuestos === false,
  "la ferretería tiene presupuestos y el kiosko no",
  `A=${cfgA.datos.modulos?.presupuestos} B=${cfgB.datos.modulos?.presupuestos}`);
chequear(cfgB.datos.modulos?.caja_turno === true,
  "el kiosko tiene caja por turno");

const presuB = await b.get("/api/presupuestos");
chequear(presuB.status === 404, "un módulo apagado devuelve 404 en el kiosko", `devolvió ${presuB.status}`);

// ── 10. El empleado no puede escaparse de su negocio ───────────
console.log("\n10) Rutas de proveedor cerradas para los clientes");
for (const ruta of ["/api/super/negocios", "/api/super/rubros"]) {
  const r = await a.get(ruta);
  chequear(r.status === 403, `el dueño de A no accede a ${ruta}`, `devolvió ${r.status}`);
}
const entrar = await a.post(`/api/super/negocios/${B.id}/entrar`);
chequear(entrar.status === 403, "el dueño de A no puede entrar al negocio de B", `devolvió ${entrar.status}`);

// ── 11. El super admin sin negocio no toca datos ───────────────
console.log("\n11) El super admin sin negocio elegido");
const supDatos = await sup.get("/api/clientes");
chequear(supDatos.status === 409, "sin negocio elegido, /api/clientes pide elegir uno", `devolvió ${supDatos.status}`);

const entrarA = await sup.post(`/api/super/negocios/${A.id}/entrar`);
chequear(entrarA.status === 200, "el super admin entra al negocio A");
const supEnA = await sup.get("/api/clientes");
const idsSup = new Set((supEnA.datos.clientes ?? []).map((x) => x.id));
chequear(idsSup.has(datosA.cliente) && !idsSup.has(datosB.cliente),
  "dentro de A, el super admin ve los clientes de A y ninguno de B");

const auditA = await a.get("/api/auditoria");
chequear(JSON.stringify(auditA.datos).includes("soporte_entra"),
  "el acceso de soporte quedó registrado en la auditoría del cliente");

await sup.post("/api/super/salir");
const supFuera = await sup.get("/api/clientes");
chequear(supFuera.status === 409, "al salir, el super admin vuelve a no tener negocio", `devolvió ${supFuera.status}`);

// ── 12. Suspender un negocio corta el acceso ───────────────────
console.log("\n12) Suspensión de un cliente");
await sup.put(`/api/super/negocios/${B.id}`, { nombre: B.nombre, estado: "suspendido" });
const bSuspendido = sesion("B-susp");
const lbs = await bSuspendido.post("/api/auth/login", {
  usuario: IGUALES.usuario, password: IGUALES.clave, negocio: B.codigo,
});
chequear(lbs.status === 403, "un negocio suspendido no puede entrar", `devolvió ${lbs.status}`);

const laDespues = await a.get("/api/clientes");
chequear(laDespues.status === 200, "suspender B no afecta a A");

// ── Resultado ──────────────────────────────────────────────────
console.log("");
console.log("─".repeat(60));
if (fallos === 0) {
  console.log(`✓ ${pruebas} verificaciones, ninguna falla. Los negocios están aislados.`);
} else {
  console.log(`✗ ${fallos} de ${pruebas} verificaciones fallaron. NO desplegar.`);
  process.exit(1);
}
