import { Hono } from "hono";
import type { Env, Variables, Negocio, Reporte, EstadoNegocio } from "./tipos";
import {
  hashPassword, verifyPassword, crearSesion, cerrarSesion, leerSesion, requireAdmin, permitirIntento,
} from "./auth";
import { pagina, vistaLogin, vistaSetup, vistaLista, vistaNegocio, vistaNuevo, esc } from "./vistas";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.onError((err, c) => {
  console.error("Error en el panel:", err);
  return c.html(pagina("Error", `<div class="err">Ocurrió un error inesperado.</div>`), 500);
});

const texto = (v: unknown, max = 200): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s.slice(0, max);
};

const ESTADOS: EstadoNegocio[] = ["prueba", "activo", "suspendido", "baja"];
const estadoValido = (v: unknown): EstadoNegocio =>
  ESTADOS.includes(v as EstadoNegocio) ? (v as EstadoNegocio) : "prueba";

async function hayAdmins(env: Env): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM admins`).first<{ n: number }>();
  return (r?.n ?? 0) > 0;
}

// ── Reporte nocturno de una instalación ─────────────────────
// Único endpoint público: lo llama cada instalación con su token. No expone
// nada — sólo acepta el resumen y lo guarda.
app.post("/api/reporte", async (c) => {
  const token = c.req.header("x-panel-token") ?? "";
  if (!token) return c.json({ error: "Falta el token." }, 401);

  const negocio = await c.env.DB.prepare(`SELECT id FROM negocios WHERE token = ?`)
    .bind(token)
    .first<{ id: string }>();
  if (!negocio) return c.json({ error: "Token desconocido." }, 401);

  const b = await c.req.json().catch(() => ({} as any));
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha)) ? String(b.fecha) : new Date().toISOString().slice(0, 10);

  // Un reporte por día: si la instalación reintenta, se pisa el del día.
  await c.env.DB.prepare(
    `INSERT INTO reportes (negocio_id, fecha, ventas_mes, ventas_cant, clientes, productos, usuarios, ultima_venta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(negocio_id, fecha) DO UPDATE SET
       ventas_mes = excluded.ventas_mes, ventas_cant = excluded.ventas_cant,
       clientes = excluded.clientes, productos = excluded.productos,
       usuarios = excluded.usuarios, ultima_venta = excluded.ultima_venta,
       recibido_en = datetime('now')`
  )
    .bind(negocio.id, fecha, n(b.ventas_mes), n(b.ventas_cant), n(b.clientes), n(b.productos), n(b.usuarios),
          texto(b.ultima_venta, 10))
    .run();

  return c.json({ ok: true });
});

// ── Primer uso: crear el acceso ─────────────────────────────
app.get("/setup", async (c) => {
  if (await hayAdmins(c.env)) return c.redirect("/login");
  return c.html(vistaSetup());
});

app.post("/setup", async (c) => {
  if (await hayAdmins(c.env)) return c.redirect("/login");
  const f = await c.req.formData();
  const usuario = texto(f.get("usuario"), 40);
  const password = String(f.get("password") ?? "");
  if (!usuario) return c.html(vistaSetup("Poné un nombre de usuario."));
  if (password.length < 8) return c.html(vistaSetup("La contraseña tiene que tener al menos 8 caracteres."));

  const res = await c.env.DB.prepare(`INSERT INTO admins (usuario, password_hash) VALUES (?, ?)`)
    .bind(usuario, await hashPassword(password))
    .run();
  await crearSesion(c, Number(res.meta.last_row_id), usuario);
  return c.redirect("/");
});

// ── Login ───────────────────────────────────────────────────
app.get("/login", async (c) => {
  if (!(await hayAdmins(c.env))) return c.redirect("/setup");
  if (await leerSesion(c)) return c.redirect("/");
  return c.html(vistaLogin());
});

app.post("/login", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (!permitirIntento(ip)) return c.html(vistaLogin("Demasiados intentos. Esperá un rato."), 429);

  const f = await c.req.formData();
  const usuario = String(f.get("usuario") ?? "").trim();
  const password = String(f.get("password") ?? "");

  const u = await c.env.DB.prepare(`SELECT id, usuario, password_hash FROM admins WHERE usuario = ?`)
    .bind(usuario)
    .first<{ id: number; usuario: string; password_hash: string }>();
  const ok = u ? await verifyPassword(password, u.password_hash) : false;
  if (!ok || !u) return c.html(vistaLogin("Usuario o contraseña incorrectos."), 401);

  await crearSesion(c, u.id, u.usuario);
  return c.redirect("/");
});

app.post("/logout", (c) => {
  cerrarSesion(c);
  return c.redirect("/login");
});

// ── De acá para abajo, todo exige sesión ────────────────────
app.use("*", requireAdmin);

app.get("/", async (c) => {
  // Cada negocio con su reporte más reciente.
  const rows = await c.env.DB.prepare(
    `SELECT n.*, r.fecha AS ultimo_reporte, r.ventas_mes, r.ventas_cant
     FROM negocios n
     LEFT JOIN reportes r ON r.id = (
       SELECT id FROM reportes WHERE negocio_id = n.id ORDER BY fecha DESC LIMIT 1
     )
     ORDER BY CASE n.estado WHEN 'activo' THEN 0 WHEN 'prueba' THEN 1 WHEN 'suspendido' THEN 2 ELSE 3 END,
              n.nombre COLLATE NOCASE`
  ).all<any>();
  return c.html(vistaLista(rows.results ?? [], c.get("admin").usuario, c.req.query("ok") ?? undefined));
});

app.get("/nuevo", (c) => c.html(vistaNuevo(c.get("admin").usuario)));

app.post("/nuevo", async (c) => {
  const f = await c.req.formData();
  const nombre = texto(f.get("nombre"), 80);
  if (!nombre) return c.html(vistaNuevo(c.get("admin").usuario, "El negocio necesita un nombre."));

  const id = crypto.randomUUID();
  // Token largo y aleatorio: es la credencial con la que la instalación reporta.
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  await c.env.DB.prepare(
    `INSERT INTO negocios (id, nombre, contacto, telefono, email, url, estado, notas, token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, nombre, texto(f.get("contacto")), texto(f.get("telefono"), 40), texto(f.get("email"), 120),
          texto(f.get("url"), 200), estadoValido(f.get("estado")), texto(f.get("notas"), 1000), token)
    .run();

  return c.redirect(`/negocio/${id}`);
});

app.get("/negocio/:id", async (c) => {
  const id = c.req.param("id");
  const n = await c.env.DB.prepare(`SELECT * FROM negocios WHERE id = ?`).bind(id).first<Negocio>();
  if (!n) return c.html(pagina("No encontrado", `<div class="err">Ese cliente no existe.</div>`), 404);

  const reportes = await c.env.DB.prepare(
    `SELECT * FROM reportes WHERE negocio_id = ? ORDER BY fecha DESC LIMIT 30`
  ).bind(id).all<Reporte>();

  const urlPanel = new URL(c.req.url).origin;
  return c.html(
    vistaNegocio(n, reportes.results ?? [], c.get("admin").usuario, urlPanel, c.req.query("ok") ?? undefined)
  );
});

app.post("/negocio/:id", async (c) => {
  const id = c.req.param("id");
  const f = await c.req.formData();
  const nombre = texto(f.get("nombre"), 80);
  if (!nombre) return c.redirect(`/negocio/${id}`);

  await c.env.DB.prepare(
    `UPDATE negocios SET nombre=?, contacto=?, telefono=?, email=?, url=?, estado=?, notas=? WHERE id=?`
  )
    .bind(nombre, texto(f.get("contacto")), texto(f.get("telefono"), 40), texto(f.get("email"), 120),
          texto(f.get("url"), 200), estadoValido(f.get("estado")), texto(f.get("notas"), 1000), id)
    .run();

  return c.redirect(`/negocio/${id}?ok=${encodeURIComponent("Datos guardados.")}`);
});

app.all("*", (c) => c.html(pagina("No encontrado", `<div class="err">Página no encontrada. ${esc("")}<a href="/">Volver</a></div>`), 404));

export default app;
