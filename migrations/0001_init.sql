-- Migración inicial: control de stock y cuenta corriente.
-- Toda la plata en centavos (INTEGER). Fechas en ISO 'YYYY-MM-DD'.

-- ─────────────────────────── AUTH ───────────────────────────
CREATE TABLE usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario       TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,   -- PBKDF2 (WebCrypto), formato: iteraciones:saltB64:hashB64
  creado_en     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─────────────────────── CLIENTES ───────────────────────────
CREATE TABLE clientes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre    TEXT    NOT NULL,
  localidad TEXT,
  direccion TEXT,
  telefono  TEXT,
  email     TEXT,
  notas     TEXT,
  activo    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_clientes_nombre    ON clientes(nombre);
CREATE INDEX idx_clientes_localidad ON clientes(localidad);
CREATE INDEX idx_clientes_activo    ON clientes(activo);

-- ─────────────────────── HERRAMIENTAS ───────────────────────
CREATE TABLE herramientas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo       TEXT    NOT NULL UNIQUE,
  nombre       TEXT    NOT NULL,
  precio       INTEGER NOT NULL DEFAULT 0,  -- centavos
  costo        INTEGER NOT NULL DEFAULT 0,  -- centavos
  stock        INTEGER NOT NULL DEFAULT 0,  -- puede quedar negativo (marcado en rojo)
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  notas        TEXT,
  activo       INTEGER NOT NULL DEFAULT 1,
  creado_en    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_herramientas_nombre ON herramientas(nombre);
CREATE INDEX idx_herramientas_activo ON herramientas(activo);

-- ──────────────────────────  VENTAS ─────────────────────────
CREATE TABLE ventas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  numero     INTEGER NOT NULL UNIQUE,       -- correlativo visible
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha      TEXT    NOT NULL,              -- ISO YYYY-MM-DD
  subtotal   INTEGER NOT NULL,             -- centavos
  descuento  INTEGER NOT NULL DEFAULT 0,   -- centavos
  total      INTEGER NOT NULL,             -- subtotal - descuento
  nota       TEXT,
  anulada    INTEGER NOT NULL DEFAULT 0,
  creado_en  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ventas_cliente ON ventas(cliente_id);
CREATE INDEX idx_ventas_fecha   ON ventas(fecha);
CREATE INDEX idx_ventas_anulada ON ventas(anulada);

CREATE TABLE venta_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id           INTEGER NOT NULL REFERENCES ventas(id),
  herramienta_id     INTEGER NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT    NOT NULL,      -- congelado al momento de la venta
  cantidad           INTEGER NOT NULL,
  precio_unitario    INTEGER NOT NULL,      -- congelado, centavos
  subtotal           INTEGER NOT NULL       -- cantidad * precio_unitario
);
CREATE INDEX idx_venta_items_venta       ON venta_items(venta_id);
CREATE INDEX idx_venta_items_herramienta ON venta_items(herramienta_id);

-- ──────────────────────────  PAGOS ──────────────────────────
CREATE TABLE pagos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  venta_id   INTEGER REFERENCES ventas(id),  -- NULL = pago a cuenta (FIFO)
  fecha      TEXT    NOT NULL,               -- ISO
  monto      INTEGER NOT NULL,               -- centavos, > 0
  medio      TEXT    NOT NULL DEFAULT 'efectivo', -- efectivo|transferencia|cheque|otro
  nota       TEXT,
  creado_en  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pagos_cliente ON pagos(cliente_id);
CREATE INDEX idx_pagos_venta   ON pagos(venta_id);
CREATE INDEX idx_pagos_fecha   ON pagos(fecha);

-- ──────────────────── MOVIMIENTOS DE STOCK ──────────────────
CREATE TABLE movimientos_stock (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  herramienta_id   INTEGER NOT NULL REFERENCES herramientas(id),
  fecha            TEXT    NOT NULL,
  tipo             TEXT    NOT NULL,   -- alta|produccion|venta|ajuste|anulacion
  cantidad         INTEGER NOT NULL,   -- +sube / -baja
  stock_resultante INTEGER NOT NULL,
  venta_id         INTEGER REFERENCES ventas(id),
  motivo           TEXT
);
CREATE INDEX idx_mov_herramienta ON movimientos_stock(herramienta_id);
CREATE INDEX idx_mov_fecha       ON movimientos_stock(fecha);
CREATE INDEX idx_mov_venta       ON movimientos_stock(venta_id);

-- ──────────────────── HISTORIAL DE PRECIOS ──────────────────
CREATE TABLE precios_historial (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  herramienta_id  INTEGER NOT NULL REFERENCES herramientas(id),
  fecha           TEXT    NOT NULL,
  precio_anterior INTEGER NOT NULL,  -- centavos
  precio_nuevo    INTEGER NOT NULL,  -- centavos
  motivo          TEXT
);
CREATE INDEX idx_precios_herramienta ON precios_historial(herramienta_id);
CREATE INDEX idx_precios_fecha       ON precios_historial(fecha);
