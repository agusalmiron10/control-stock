-- Etapa 6: cuánto pesa cada negocio, sin depender de la Analytics API de
-- Cloudflare (que necesitaría un token aparte, sólo para vigilar un límite
-- que hoy está al 0,1% — ver la propuesta original).
--
-- filas y bytes_estimados NO son una consulta nueva: se sacan del mismo JSON
-- que arma la copia diaria de cada negocio, así que el costo es casi cero y
-- el número es real (el tamaño exacto de SU copia), no una aproximación.

CREATE TABLE uso_diario (
  negocio_id       TEXT NOT NULL,
  fecha            TEXT NOT NULL,
  filas            INTEGER NOT NULL,
  bytes_estimados  INTEGER NOT NULL,
  ventas           INTEGER NOT NULL DEFAULT 0,
  facturas         INTEGER NOT NULL DEFAULT 0,
  remitos          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (negocio_id, fecha)
);

CREATE INDEX idx_uso_diario_fecha ON uso_diario (fecha DESC);
