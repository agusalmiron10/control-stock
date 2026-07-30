-- Registro de auditoría: quién hizo qué, para las acciones sensibles
-- (anular venta, borrar pago, cambiar precio, ajustar stock, etc.).
CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id TEXT,
  detalle TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_auditoria_creado ON auditoria (creado_en DESC);
