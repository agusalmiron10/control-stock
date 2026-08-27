-- Comprobantes huérfanos: cuando no sabemos qué contestó ARCA.
--
-- El problema: si se manda el pedido de CAE y se corta la conexión antes de
-- que llegue la respuesta, ARCA pudo haberlo autorizado igual. Hasta ahora eso
-- se guardaba como 'rechazada' y se permitía reintentar — y si ARCA sí lo
-- había autorizado, el reintento sacaba OTRO número y quedaban DOS facturas
-- reales para una sola venta, con una de ellas invisible para el sistema.
-- Eso es un problema fiscal, no un detalle técnico.
--
-- Ahora ese caso queda en 'huerfano': no se puede reintentar hasta preguntarle
-- a ARCA con FECompConsultar qué pasó realmente. Si la había autorizado, se
-- completa el CAE; si no, el número queda libre y se puede volver a emitir.
--
-- SQLite no permite modificar un CHECK, así que hay que recrear la tabla.

CREATE TABLE facturas_nueva (
  id                  TEXT PRIMARY KEY,
  negocio_id          TEXT NOT NULL REFERENCES negocios(id),
  venta_id            TEXT NOT NULL REFERENCES ventas(id),
  factura_original_id TEXT REFERENCES facturas(id),
  tipo_comprobante    INTEGER NOT NULL,
  punto_venta         INTEGER NOT NULL,
  numero              INTEGER,
  cae                 TEXT,
  cae_vencimiento     TEXT,
  estado              TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente', 'autorizada', 'rechazada', 'error', 'huerfano')),
  neto_gravado        INTEGER NOT NULL,
  iva                 INTEGER NOT NULL,
  total               INTEGER NOT NULL,
  iva_porcentaje      INTEGER NOT NULL,
  doc_tipo            INTEGER NOT NULL,
  doc_numero          TEXT NOT NULL,
  respuesta_afip      TEXT,
  observaciones       TEXT,
  creado_en           TEXT NOT NULL DEFAULT (datetime('now')),
  autorizado_en       TEXT
);

INSERT INTO facturas_nueva
  (id, negocio_id, venta_id, factura_original_id, tipo_comprobante, punto_venta, numero,
   cae, cae_vencimiento, estado, neto_gravado, iva, total, iva_porcentaje,
   doc_tipo, doc_numero, respuesta_afip, observaciones, creado_en, autorizado_en)
SELECT
   id, negocio_id, venta_id, factura_original_id, tipo_comprobante, punto_venta, numero,
   cae, cae_vencimiento, estado, neto_gravado, iva, total, iva_porcentaje,
   doc_tipo, doc_numero, respuesta_afip, observaciones, creado_en, autorizado_en
FROM facturas;

DROP TABLE facturas;
ALTER TABLE facturas_nueva RENAME TO facturas;

-- Los índices se van con la tabla vieja: hay que rehacerlos igual que estaban.
CREATE INDEX idx_facturas_negocio ON facturas (negocio_id);
CREATE INDEX idx_facturas_original ON facturas (factura_original_id);
CREATE INDEX idx_facturas_negocio_fecha ON facturas (negocio_id, creado_en);
-- Sólo el comprobante autorizado reserva la venta: los intentos fallidos se
-- acumulan como historial y no la traban.
CREATE UNIQUE INDEX idx_facturas_venta
  ON facturas (negocio_id, venta_id)
  WHERE factura_original_id IS NULL AND estado = 'autorizada';
-- Para que el repaso de huérfanos no recorra toda la tabla.
CREATE INDEX idx_facturas_huerfanas ON facturas (negocio_id, estado) WHERE estado = 'huerfano';
