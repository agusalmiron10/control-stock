-- Registro de errores no controlados (500), para que el proveedor pueda ver
-- de un vistazo "¿se rompió algo hoy, en cualquier negocio?" sin tener que
-- vivir pegado a `wrangler tail`. negocio_id va nullable a propósito: un
-- error puede pasar antes de saber a qué negocio pertenece la sesión (login,
-- setup, o una sesión sin negocio asignado).

CREATE TABLE errores_sistema (
  id         TEXT PRIMARY KEY,
  negocio_id TEXT,
  metodo     TEXT NOT NULL,
  ruta       TEXT NOT NULL,
  mensaje    TEXT NOT NULL,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_errores_sistema_creado ON errores_sistema (creado_en DESC);
