-- Multi-negocio: una sola instalación atiende a muchos clientes, cada uno
-- con sus datos separados por negocio_id.
--
-- Reglas que impone este esquema:
--   * Todas las tablas de datos llevan negocio_id.
--   * Lo que antes era único a nivel sistema (código de producto, número de
--     venta, nombre de usuario) pasa a ser único DENTRO de cada negocio: dos
--     negocios pueden tener su propia "Venta #1" y su propio usuario "juan".
--   * usuarios.negocio_id NULL = super admin (el proveedor del sistema).
--
-- Sobre la técnica: SQLite no permite cambiar una restricción UNIQUE con
-- ALTER TABLE, así que hay que reconstruir tablas. Y al renombrar una tabla,
-- SQLite reescribe las REFERENCES de las hijas para que apunten al nombre
-- nuevo — por eso toda tabla que apunte a una reconstruida hay que
-- reconstruirla también. D1 además no respeta PRAGMA foreign_keys = OFF
-- dentro de una migración, así que el orden tiene que ser válido de por sí:
-- primero los padres, después las hijas, y el borrado al revés.

-- ── 1. Los negocios ────────────────────────────────────────
CREATE TABLE negocios (
  id        TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  -- Lo que el usuario escribe al entrar para decir a qué negocio pertenece.
  codigo    TEXT NOT NULL UNIQUE,
  contacto  TEXT,
  telefono  TEXT,
  email     TEXT,
  estado    TEXT NOT NULL DEFAULT 'activo'
              CHECK (estado IN ('prueba', 'activo', 'suspendido', 'baja')),
  notas     TEXT,
  alta      TEXT NOT NULL DEFAULT (date('now')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_negocios_estado ON negocios (estado);

-- El negocio que ya existe. Todo lo que hay hoy en la base es suyo.
INSERT INTO negocios (id, nombre, codigo, estado)
VALUES ('00000000-0000-4000-8000-000000000001', 'ARBELL', 'arbell', 'activo');

-- ── 2. Tablas sin claves foráneas hacia lo que se reconstruye ──
-- El default '' es a propósito: si algún día una consulta se olvida de poner
-- el negocio, la fila queda huérfana (no la ve nadie) en vez de aparecer
-- dentro de otro negocio. Falla perdiendo visibilidad, nunca filtrando.
ALTER TABLE clientes    ADD COLUMN negocio_id TEXT NOT NULL DEFAULT '';
ALTER TABLE operaciones ADD COLUMN negocio_id TEXT NOT NULL DEFAULT '';
ALTER TABLE auditoria   ADD COLUMN negocio_id TEXT NOT NULL DEFAULT '';

UPDATE clientes    SET negocio_id = '00000000-0000-4000-8000-000000000001';
UPDATE operaciones SET negocio_id = '00000000-0000-4000-8000-000000000001';
UPDATE auditoria   SET negocio_id = '00000000-0000-4000-8000-000000000001';

CREATE INDEX idx_clientes_negocio    ON clientes (negocio_id);
CREATE INDEX idx_operaciones_negocio ON operaciones (negocio_id);
CREATE INDEX idx_auditoria_negocio   ON auditoria (negocio_id);

-- ── 3. Todo lo reconstruido se corre del camino ────────────
ALTER TABLE presupuesto_items RENAME TO presupuesto_items_vieja;
ALTER TABLE venta_items       RENAME TO venta_items_vieja;
ALTER TABLE movimientos_stock RENAME TO movimientos_vieja;
ALTER TABLE precios_historial RENAME TO precios_vieja;
ALTER TABLE pagos             RENAME TO pagos_vieja;
ALTER TABLE presupuestos      RENAME TO presupuestos_vieja;
ALTER TABLE ventas            RENAME TO ventas_vieja;
ALTER TABLE herramientas      RENAME TO herramientas_vieja;
ALTER TABLE usuarios          RENAME TO usuarios_vieja;
ALTER TABLE config            RENAME TO config_vieja;
ALTER TABLE resumenes_diarios RENAME TO resumenes_vieja;

-- Los índices no siguen al renombrado: hay que liberar los nombres.
DROP INDEX IF EXISTS idx_herramientas_nombre;
DROP INDEX IF EXISTS idx_herramientas_codigo;
DROP INDEX IF EXISTS idx_herramientas_rubro;
DROP INDEX IF EXISTS idx_ventas_cliente;
DROP INDEX IF EXISTS idx_ventas_fecha;
DROP INDEX IF EXISTS idx_ventas_estado;
DROP INDEX IF EXISTS idx_venta_items_venta;
DROP INDEX IF EXISTS idx_venta_items_herramienta;
DROP INDEX IF EXISTS idx_pagos_cliente;
DROP INDEX IF EXISTS idx_pagos_venta;
DROP INDEX IF EXISTS idx_pagos_fecha;
DROP INDEX IF EXISTS idx_movimientos_herramienta;
DROP INDEX IF EXISTS idx_movimientos_fecha;
DROP INDEX IF EXISTS idx_precios_herramienta;
DROP INDEX IF EXISTS idx_presupuestos_cliente;
DROP INDEX IF EXISTS idx_presupuestos_estado;
DROP INDEX IF EXISTS idx_presupuestos_fecha;
DROP INDEX IF EXISTS idx_presupuesto_items_presupuesto;

-- ── 4. Padres nuevos ───────────────────────────────────────
CREATE TABLE herramientas (
  id           TEXT PRIMARY KEY,
  negocio_id   TEXT NOT NULL REFERENCES negocios(id),
  codigo       TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  precio       INTEGER NOT NULL DEFAULT 0,
  precio_mayor INTEGER NOT NULL DEFAULT 0,
  rubro        TEXT,
  costo        INTEGER NOT NULL DEFAULT 0,
  stock        INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  notas        TEXT,
  activo       INTEGER NOT NULL DEFAULT 1,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, codigo)
);

INSERT INTO herramientas (id, negocio_id, codigo, nombre, precio, precio_mayor, rubro, costo,
                          stock, stock_minimo, notas, activo, creado_en)
SELECT id, '00000000-0000-4000-8000-000000000001', codigo, nombre, precio, precio_mayor, rubro,
       costo, stock, stock_minimo, notas, activo, creado_en
FROM herramientas_vieja;

CREATE TABLE ventas (
  id                 TEXT PRIMARY KEY,
  negocio_id         TEXT NOT NULL REFERENCES negocios(id),
  numero             INTEGER NOT NULL,
  cliente_id         TEXT NOT NULL REFERENCES clientes(id),
  fecha              TEXT NOT NULL,
  subtotal           INTEGER NOT NULL,
  descuento          INTEGER NOT NULL DEFAULT 0,
  total              INTEGER NOT NULL,
  nota               TEXT,
  estado             TEXT NOT NULL DEFAULT 'sincronizada'
                        CHECK (estado IN ('borrador', 'sincronizada', 'confirmada', 'anulada')),
  origen             TEXT NOT NULL DEFAULT 'escritorio' CHECK (origen IN ('celular', 'escritorio')),
  necesita_revision  INTEGER NOT NULL DEFAULT 0,
  motivo_revision    TEXT,
  creado_en          TEXT NOT NULL DEFAULT (datetime('now')),
  sincronizado_en    TEXT,
  UNIQUE (negocio_id, numero)
);

INSERT INTO ventas (id, negocio_id, numero, cliente_id, fecha, subtotal, descuento, total, nota,
                    estado, origen, necesita_revision, motivo_revision, creado_en, sincronizado_en)
SELECT id, '00000000-0000-4000-8000-000000000001', numero, cliente_id, fecha, subtotal, descuento,
       total, nota, estado, origen, necesita_revision, motivo_revision, creado_en, sincronizado_en
FROM ventas_vieja;

CREATE TABLE presupuestos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id   TEXT NOT NULL REFERENCES negocios(id),
  numero       INTEGER NOT NULL,
  cliente_id   TEXT NOT NULL REFERENCES clientes(id),
  fecha        TEXT NOT NULL,
  subtotal     INTEGER NOT NULL,
  descuento    INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'pendiente',
  valido_hasta TEXT,
  nota         TEXT,
  venta_id     TEXT REFERENCES ventas(id),
  creado_en    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, numero)
);

INSERT INTO presupuestos (id, negocio_id, numero, cliente_id, fecha, subtotal, descuento, total,
                          estado, valido_hasta, nota, venta_id, creado_en)
SELECT id, '00000000-0000-4000-8000-000000000001', numero, cliente_id, fecha, subtotal, descuento,
       total, estado, valido_hasta, nota, venta_id, creado_en
FROM presupuestos_vieja;

-- ── 5. Hijas nuevas (ya apuntan a los padres nuevos) ───────
CREATE TABLE venta_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id         TEXT NOT NULL REFERENCES negocios(id),
  venta_id           TEXT NOT NULL REFERENCES ventas(id),
  herramienta_id     TEXT NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT NOT NULL,
  cantidad           INTEGER NOT NULL,
  precio_unitario    INTEGER NOT NULL,
  subtotal           INTEGER NOT NULL
);

INSERT INTO venta_items (id, negocio_id, venta_id, herramienta_id, nombre_herramienta,
                         cantidad, precio_unitario, subtotal)
SELECT id, '00000000-0000-4000-8000-000000000001', venta_id, herramienta_id, nombre_herramienta,
       cantidad, precio_unitario, subtotal
FROM venta_items_vieja;

CREATE TABLE pagos (
  id         TEXT PRIMARY KEY,
  negocio_id TEXT NOT NULL REFERENCES negocios(id),
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  venta_id   TEXT REFERENCES ventas(id),
  fecha      TEXT NOT NULL,
  monto      INTEGER NOT NULL,
  medio      TEXT NOT NULL DEFAULT 'efectivo',
  nota       TEXT,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO pagos (id, negocio_id, cliente_id, venta_id, fecha, monto, medio, nota, creado_en)
SELECT id, '00000000-0000-4000-8000-000000000001', cliente_id, venta_id, fecha, monto, medio, nota, creado_en
FROM pagos_vieja;

CREATE TABLE movimientos_stock (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id       TEXT NOT NULL REFERENCES negocios(id),
  herramienta_id   TEXT NOT NULL REFERENCES herramientas(id),
  fecha            TEXT NOT NULL,
  tipo             TEXT NOT NULL,
  cantidad         INTEGER NOT NULL,
  stock_resultante INTEGER NOT NULL,
  venta_id         TEXT REFERENCES ventas(id),
  motivo           TEXT,
  costo_unitario   INTEGER
);

INSERT INTO movimientos_stock (id, negocio_id, herramienta_id, fecha, tipo, cantidad,
                               stock_resultante, venta_id, motivo, costo_unitario)
SELECT id, '00000000-0000-4000-8000-000000000001', herramienta_id, fecha, tipo, cantidad,
       stock_resultante, venta_id, motivo, costo_unitario
FROM movimientos_vieja;

CREATE TABLE precios_historial (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id      TEXT NOT NULL REFERENCES negocios(id),
  herramienta_id  TEXT NOT NULL REFERENCES herramientas(id),
  fecha           TEXT NOT NULL,
  precio_anterior INTEGER NOT NULL,
  precio_nuevo    INTEGER NOT NULL,
  tipo_precio     TEXT NOT NULL DEFAULT 'minorista',
  motivo          TEXT
);

INSERT INTO precios_historial (id, negocio_id, herramienta_id, fecha, precio_anterior,
                               precio_nuevo, tipo_precio, motivo)
SELECT id, '00000000-0000-4000-8000-000000000001', herramienta_id, fecha, precio_anterior,
       precio_nuevo, tipo_precio, motivo
FROM precios_vieja;

CREATE TABLE presupuesto_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id         TEXT NOT NULL REFERENCES negocios(id),
  presupuesto_id     INTEGER NOT NULL REFERENCES presupuestos(id),
  herramienta_id     TEXT NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT NOT NULL,
  cantidad           INTEGER NOT NULL,
  precio_unitario    INTEGER NOT NULL,
  subtotal           INTEGER NOT NULL
);

INSERT INTO presupuesto_items (id, negocio_id, presupuesto_id, herramienta_id, nombre_herramienta,
                               cantidad, precio_unitario, subtotal)
SELECT id, '00000000-0000-4000-8000-000000000001', presupuesto_id, herramienta_id, nombre_herramienta,
       cantidad, precio_unitario, subtotal
FROM presupuesto_items_vieja;

-- ── 6. Tablas sueltas ──────────────────────────────────────
-- negocio_id NULL = super admin: no pertenece a ningún negocio y los ve todos.
CREATE TABLE usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id    TEXT REFERENCES negocios(id),
  usuario       TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'dueño'
                  CHECK (rol IN ('super', 'dueño', 'empleado', 'soporte')),
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, usuario)
);

INSERT INTO usuarios (id, negocio_id, usuario, password_hash, rol, creado_en)
SELECT id, '00000000-0000-4000-8000-000000000001', usuario, password_hash, rol, creado_en
FROM usuarios_vieja;

CREATE TABLE config (
  negocio_id     TEXT NOT NULL REFERENCES negocios(id),
  clave          TEXT NOT NULL,
  valor          TEXT NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (negocio_id, clave)
);

INSERT INTO config (negocio_id, clave, valor, actualizado_en)
SELECT '00000000-0000-4000-8000-000000000001', clave, valor, actualizado_en FROM config_vieja;

CREATE TABLE resumenes_diarios (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id          TEXT NOT NULL REFERENCES negocios(id),
  fecha               TEXT NOT NULL,
  ventas_total        INTEGER NOT NULL DEFAULT 0,
  ventas_cant         INTEGER NOT NULL DEFAULT 0,
  cobranzas_total     INTEGER NOT NULL DEFAULT 0,
  cobranzas_cant      INTEGER NOT NULL DEFAULT 0,
  saldo_pendiente     INTEGER NOT NULL DEFAULT 0,
  clientes_con_deuda  INTEGER NOT NULL DEFAULT 0,
  stock_bajo_cant     INTEGER NOT NULL DEFAULT 0,
  generado_en         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, fecha)
);

INSERT INTO resumenes_diarios (id, negocio_id, fecha, ventas_total, ventas_cant, cobranzas_total,
                               cobranzas_cant, saldo_pendiente, clientes_con_deuda, stock_bajo_cant, generado_en)
SELECT id, '00000000-0000-4000-8000-000000000001', fecha, ventas_total, ventas_cant, cobranzas_total,
       cobranzas_cant, saldo_pendiente, clientes_con_deuda, stock_bajo_cant, generado_en
FROM resumenes_vieja;

-- ── 7. Fuera las viejas: hijas primero, después los padres ──
DROP TABLE presupuesto_items_vieja;
DROP TABLE venta_items_vieja;
DROP TABLE movimientos_vieja;
DROP TABLE precios_vieja;
DROP TABLE pagos_vieja;
DROP TABLE presupuestos_vieja;
DROP TABLE ventas_vieja;
DROP TABLE herramientas_vieja;
DROP TABLE usuarios_vieja;
DROP TABLE config_vieja;
DROP TABLE resumenes_vieja;

-- ── 8. Índices ─────────────────────────────────────────────
CREATE INDEX idx_herramientas_negocio       ON herramientas (negocio_id);
CREATE INDEX idx_herramientas_nombre        ON herramientas (negocio_id, nombre);
CREATE INDEX idx_herramientas_rubro         ON herramientas (negocio_id, rubro);
CREATE INDEX idx_ventas_negocio             ON ventas (negocio_id);
CREATE INDEX idx_ventas_cliente             ON ventas (negocio_id, cliente_id);
CREATE INDEX idx_ventas_fecha               ON ventas (negocio_id, fecha);
CREATE INDEX idx_ventas_estado              ON ventas (negocio_id, estado);
CREATE INDEX idx_venta_items_negocio        ON venta_items (negocio_id);
CREATE INDEX idx_venta_items_venta          ON venta_items (venta_id);
CREATE INDEX idx_venta_items_herramienta    ON venta_items (herramienta_id);
CREATE INDEX idx_pagos_negocio              ON pagos (negocio_id);
CREATE INDEX idx_pagos_cliente              ON pagos (negocio_id, cliente_id);
CREATE INDEX idx_pagos_venta                ON pagos (venta_id);
CREATE INDEX idx_pagos_fecha                ON pagos (negocio_id, fecha);
CREATE INDEX idx_movimientos_negocio        ON movimientos_stock (negocio_id);
CREATE INDEX idx_movimientos_herramienta    ON movimientos_stock (herramienta_id);
CREATE INDEX idx_movimientos_fecha          ON movimientos_stock (negocio_id, fecha);
CREATE INDEX idx_precios_negocio            ON precios_historial (negocio_id);
CREATE INDEX idx_precios_herramienta        ON precios_historial (herramienta_id);
CREATE INDEX idx_presupuestos_negocio       ON presupuestos (negocio_id);
CREATE INDEX idx_presupuestos_cliente       ON presupuestos (negocio_id, cliente_id);
CREATE INDEX idx_presupuestos_estado        ON presupuestos (negocio_id, estado);
CREATE INDEX idx_presupuesto_items_negocio  ON presupuesto_items (negocio_id);
CREATE INDEX idx_presupuesto_items_pres     ON presupuesto_items (presupuesto_id);
CREATE INDEX idx_usuarios_negocio           ON usuarios (negocio_id);
