-- Remitos: el papel que acompaña a la mercadería cuando sale.
--
-- Decisión de diseño: el remito SIEMPRE nace de una venta, y NO toca el stock.
--
-- Por qué no toca el stock: el stock ya se descontó al confirmar la venta. Si
-- el remito lo descontara otra vez, contaría doble. El remito documenta la
-- entrega física de algo que ya está vendido, no un movimiento nuevo.
--
-- Por qué nace de una venta: así se puede validar que no se entregue más de lo
-- que se vendió, y se habilita lo que más se usa — las ENTREGAS PARCIALES.
-- Vendés 100 bolsas de cemento, entregás 40 hoy y 60 la semana que viene: son
-- dos remitos contra la misma venta.

CREATE TABLE remitos (
  id          TEXT PRIMARY KEY,
  negocio_id  TEXT NOT NULL REFERENCES negocios(id),
  numero      INTEGER NOT NULL,           -- correlativo propio de cada negocio
  venta_id    TEXT NOT NULL REFERENCES ventas(id),
  cliente_id  TEXT NOT NULL REFERENCES clientes(id),
  fecha       TEXT NOT NULL,              -- ISO YYYY-MM-DD
  estado      TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'entregado', 'anulado')),
  -- Datos del traslado: quién lo lleva y a dónde. Se congelan acá porque el
  -- domicilio del cliente puede cambiar después y el remito ya se entregó.
  transporte  TEXT,
  domicilio   TEXT,
  recibido_por TEXT,                      -- quién firmó al recibir
  entregado_en TEXT,                      -- cuándo se marcó como entregado
  nota        TEXT,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, numero)
);

CREATE INDEX idx_remitos_negocio_fecha ON remitos (negocio_id, fecha);
CREATE INDEX idx_remitos_venta ON remitos (venta_id);
CREATE INDEX idx_remitos_cliente ON remitos (negocio_id, cliente_id);

CREATE TABLE remito_items (
  id                 TEXT PRIMARY KEY,
  negocio_id         TEXT NOT NULL REFERENCES negocios(id),
  remito_id          TEXT NOT NULL REFERENCES remitos(id),
  herramienta_id     TEXT NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT NOT NULL,       -- congelado al emitir
  cantidad           INTEGER NOT NULL
);

CREATE INDEX idx_remito_items_remito ON remito_items (remito_id);
