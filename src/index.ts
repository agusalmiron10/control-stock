import { Hono } from "hono";
import type { Env, Variables } from "./types";
import { HttpError } from "./validate";
import { requireAuth, requireNegocio, bloquearSiSoloLectura } from "./auth";
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
import { catalogo } from "./routes/catalogo";
import { rubros } from "./routes/rubros";
import { cuenta } from "./routes/cuenta";
import { mensajes } from "./routes/mensajes";
import { insumos } from "./routes/insumos";
import { scheduled } from "./scheduled";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Cabeceras de seguridad en toda respuesta. Cierran ataques que no dependen
// de la sesión: clickjacking (que carguen la app en un iframe para engañar al
// usuario), sniffing de tipo de contenido, y fuga del referer a terceros.
// La CSP restringe de dónde puede cargar recursos la página: scripts sólo
// propios, y así una inyección de HTML no puede traer código de afuera.
app.use("*", async (c, next) => {
  await next();
  c.header("X-Frame-Options", "DENY");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // El bundle de Vite y algún estilo embebido necesitan 'unsafe-inline'.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // Fotos de perfil y QRs van como data:; los tiles del mapa desde CARTO.
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
      // El geocodificador de direcciones (nominatim) del alta de clientes.
      "connect-src 'self' https://nominatim.openstreetmap.org",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );
});

/**
 * Aviso a Discord de un error 500, en paralelo al guardado en
 * errores_sistema. Nunca puede ser lo que rompe la respuesta al usuario: si
 * el webhook no está configurado, si Discord está caído, o si devuelve
 * cualquier cosa rara, esto se traga el error y listo — el panel de
 * Herramientas del proveedor (errores_sistema) sigue siendo la fuente de
 * verdad, esto es sólo el aviso en tiempo real.
 */
async function avisarDiscord(env: Env, datos: { negocioId: string | null; metodo: string; ruta: string; mensaje: string }): Promise<void> {
  const webhook = env.ALERTA_DISCORD_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: "🔴 Error 500 en Stockeate",
            color: 0xd64545,
            fields: [
              { name: "Negocio", value: datos.negocioId ?? "(sin sesión)", inline: true },
              { name: "Ruta", value: `${datos.metodo} ${datos.ruta}`, inline: true },
              { name: "Mensaje", value: "```" + datos.mensaje.slice(0, 1000) + "```" },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch {
    // Best-effort: un webhook caído no puede volver a lanzar acá.
  }
}

// Manejo central de errores: HttpError → { error } con su status.
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as any);
  console.error("Error no controlado:", err);
  // Best-effort: si esto falla, no tiene que tumbar la respuesta de error
  // que ya se le está por mandar al usuario. waitUntil para no atrasarla.
  try {
    const negocioId = c.get("usuario")?.negocioId ?? null;
    const mensaje = String((err as any)?.message ?? err).slice(0, 500);
    const metodo = c.req.method;
    const ruta = c.req.path;
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        `INSERT INTO errores_sistema (id, negocio_id, metodo, ruta, mensaje) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), negocioId, metodo, ruta, mensaje)
        .run()
        .catch(() => {})
    );
    c.executionCtx.waitUntil(avisarDiscord(c.env, { negocioId, metodo, ruta, mensaje }));
  } catch {
    // Ni esto puede romper el manejo de errores.
  }
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
// Y si es una visita de soporte en sólo lectura, no dejan escribir. Va acá,
// una sola vez, para que ninguna ruta futura pueda olvidarse.
api.use("*", bloquearSiSoloLectura);
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
api.route("/catalogo", catalogo);
api.route("/rubros", rubros);
api.route("/cuenta", cuenta);
api.route("/mensajes", mensajes);
api.route("/insumos", insumos);
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
