-- Compras y proveedores: la otra mitad del stock.
--
-- Hasta ahora el stock sólo bajaba (ventas) o subía a mano (ajuste / alta /
-- producción). Para un negocio que compra para revender, eso significa cargar
-- todo a mano y no tener registro de a quién le compró ni a cuánto.
--
-- Al registrar una compra el stock sube y el costo del producto se recalcula
-- como promedio ponderado — el mismo criterio que ya usa Producción, para que
-- la ganancia de los reportes siga siendo comparable.

CREATE TABLE proveedores (
  id         TEXT PRIMARY KEY,
  negocio_id TEXT NOT NULL REFERENCES negocios(id),
  nombre     TEXT NOT NULL,
  telefono   TEXT,
  email      TEXT,
  direccion  TEXT,
  cuit       TEXT,
  notas      TEXT,
  activo     INTEGER NOT NULL DEFAULT 1,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_proveedores_negocio ON proveedores (negocio_id);
-- Dos negocios distintos pueden tener un proveedor con el mismo nombre.
CREATE UNIQUE INDEX idx_proveedores_nombre ON proveedores (negocio_id, nombre COLLATE NOCASE);

CREATE TABLE compras (
  id           TEXT PRIMARY KEY,
  negocio_id   TEXT NOT NULL REFERENCES negocios(id),
  numero       INTEGER NOT NULL,        -- correlativo propio de cada negocio
  proveedor_id TEXT NOT NULL REFERENCES proveedores(id),
  fecha        TEXT NOT NULL,           -- ISO YYYY-MM-DD
  comprobante  TEXT,                    -- nro. de factura del proveedor, como venga
  total        INTEGER NOT NULL,        -- centavos
  nota         TEXT,
  estado       TEXT NOT NULL DEFAULT 'registrada'
                  CHECK (estado IN ('registrada', 'anulada')),
  creado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, numero)
);
CREATE INDEX idx_compras_negocio_fecha ON compras (negocio_id, fecha);
CREATE INDEX idx_compras_proveedor ON compras (proveedor_id);

CREATE TABLE compra_items (
  id                 TEXT PRIMARY KEY,
  negocio_id         TEXT NOT NULL REFERENCES negocios(id),
  compra_id          TEXT NOT NULL REFERENCES compras(id),
  herramienta_id     TEXT NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT NOT NULL,     -- congelado al momento de la compra
  cantidad           INTEGER NOT NULL,
  costo_unitario     INTEGER NOT NULL,  -- centavos
  subtotal           INTEGER NOT NULL
);
CREATE INDEX idx_compra_items_compra ON compra_items (compra_id);
CREATE INDEX idx_compra_items_herramienta ON compra_items (herramienta_id);

-- Para poder rastrear un movimiento de stock hasta la compra que lo generó,
-- igual que ya se hace con venta_id.
ALTER TABLE movimientos_stock ADD COLUMN compra_id TEXT REFERENCES compras(id);
