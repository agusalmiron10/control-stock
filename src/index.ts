import { Hono } from "hono";
import type { Env, Variables } from "./types";
import { HttpError } from "./validate";
import { requireAuth, requireNegocio } from "./auth";
import { superAdmin } from "./routes/super";
import { auth } from "./routes/auth";
import { clientes } from "./routes/clientes";
import { herramientas } from "./routes/herramientas";
import { ventas } from "./routes/ventas";
import { pagos } from "./routes/pagos";
import { presupuestos } from "./routes/presupuestos";
import { panel } from "./routes/panel";
import { reportes } from "./routes/reportes";
import { exportar } from "./routes/export";
import { backup } from "./routes/backup";
import { buscar } from "./routes/buscar";
import { auditoriaRoutes } from "./routes/auditoria";
import { config } from "./routes/config";
import { facturacion } from "./routes/facturacion";
import { compras } from "./routes/compras";
import { remitos } from "./routes/remitos";
import { scheduled } from "./scheduled";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Manejo central de errores: HttpError → { error } con su status.
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  console.error("Error no controlado:", err);
  return c.json({ error: "Ocurrió un error inesperado. Probá de nuevo." }, 500);
});

// Rutas públicas de autenticación (login / setup / status).
app.route("/api/auth", auth);

// Rutas del proveedor del sistema. Van antes que las de datos porque no
// exigen estar dentro de un negocio: justamente sirven para elegir uno.
const sup = new Hono<{ Bindings: Env; Variables: Variables }>();
sup.use("*", requireAuth);
sup.route("/", superAdmin);
app.route("/api/super", sup);

// A partir de acá, TODAS las rutas de datos exigen sesión válida Y un negocio.
// requireNegocio es la red de seguridad del multi-negocio: sin él, una sesión
// sin negocio llegaría a las consultas y negocioDe() explotaría con un 500.
const api = new Hono<{ Bindings: Env; Variables: Variables }>();
api.use("*", requireAuth);
api.use("*", requireNegocio);
api.route("/clientes", clientes);
api.route("/herramientas", herramientas);
api.route("/ventas", ventas);
api.route("/pagos", pagos);
api.route("/presupuestos", presupuestos);
api.route("/panel", panel);
api.route("/reportes", reportes);
api.route("/export", exportar);
api.route("/backup", backup);
api.route("/buscar", buscar);
api.route("/auditoria", auditoriaRoutes);
api.route("/config", config);
api.route("/facturacion", facturacion);
api.route("/compras", compras);
api.route("/remitos", remitos);
app.route("/api", api);

// Cualquier otra ruta /api que no exista.
app.all("/api/*", (c) => c.json({ error: "Ruta no encontrada." }, 404));

// El resto (assets estáticos y SPA) lo sirve el binding de assets.
// not_found_handling: "single-page-application" devuelve index.html para las
// rutas del router del front (ej. /clientes/12).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled,
};
