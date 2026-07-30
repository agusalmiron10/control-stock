-- Modo calle: IDs a UUID (TEXT) para que el celular pueda crear ventas y pagos
-- con identidad propia sin hablar con el servidor, ciclo de vida completo de
-- la venta (borrador/sincronizada/confirmada/anulada) e idempotencia.
--
-- SQLite no permite cambiar el tipo de una PRIMARY KEY con ALTER TABLE, así
-- que cada tabla afectada se reconstruye. Truco clave: a las 4 tablas que
-- OTRAS referencian por FK (clientes, herramientas, ventas, presupuestos) hay
-- que sacarlas del camino con RENAME antes de poder crear la versión nueva
-- con el nombre definitivo — SQLite (desde 3.25) actualiza solo las cláusulas
-- REFERENCES de las tablas que las apuntan, así que nada queda inconsistente.
-- (No se usa PRAGMA foreign_keys=OFF: D1 no lo respeta de forma confiable
-- dentro de una migración por lotes, así que el orden de este archivo está
-- pensado para no violar ninguna FK en ningún paso, incluso con FKs siempre
-- activas. Verificado con `PRAGMA foreign_key_check` al final, sin resultados.)
--
-- Los clientes/herramientas/ventas/pagos existentes se re-identifican con un
-- UUID nuevo (generado acá mismo, sin script externo). Las ventas viejas
-- (todas cargadas desde escritorio, ya con sus efectos aplicados) migran con
-- estado='confirmada' y origen='escritorio' — no aparecen en la bandeja de
-- revisión el primer día.

-- ─────────────── Tablas de mapeo (id viejo INTEGER → id nuevo TEXT) ───────
-- Se arman ANTES de tocar nada, leyendo las tablas originales intactas.
CREATE TABLE _map_clientes (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);
INSERT INTO _map_clientes (old_id, new_id)
SELECT id,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))
FROM clientes;

CREATE TABLE _map_herramientas (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);
INSERT INTO _map_herramientas (old_id, new_id)
SELECT id,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))
FROM herramientas;

CREATE TABLE _map_ventas (old_id INTEGER PRIMARY KEY, new_id TEXT NOT NULL);
INSERT INTO _map_ventas (old_id, new_id)
SELECT id,
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6)))
FROM ventas;

-- ─── Sacar del camino a las 4 tablas "padre" (las que otras referencian) ───
-- SQLite reescribe automáticamente los REFERENCES de venta_items/pagos/
-- movimientos_stock/precios_historial/presupuesto_items para que apunten a
-- estos nuevos nombres — nada queda inconsistente todavía.
ALTER TABLE clientes     RENAME TO clientes_vieja;
ALTER TABLE herramientas RENAME TO herramientas_vieja;
ALTER TABLE ventas       RENAME TO ventas_vieja;
ALTER TABLE presupuestos RENAME TO presupuestos_vieja;

-- Los índices no siguen el rename con un nombre nuevo: hay que liberar los
-- nombres a mano para poder crear los definitivos más abajo sin chocar.
DROP INDEX idx_clientes_nombre;
DROP INDEX idx_clientes_localidad;
DROP INDEX idx_clientes_activo;
DROP INDEX idx_herramientas_nombre;
DROP INDEX idx_herramientas_activo;
DROP INDEX idx_herramientas_rubro;
DROP INDEX idx_ventas_cliente;
DROP INDEX idx_ventas_fecha;
DROP INDEX idx_ventas_anulada;
DROP INDEX idx_presupuestos_cliente;
DROP INDEX idx_presupuestos_fecha;
DROP INDEX idx_presupuestos_estado;

-- ─────────────────────── CLIENTES ───────────────────────
CREATE TABLE clientes (
  id        TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  localidad TEXT,
  direccion TEXT,
  telefono  TEXT,
  email     TEXT,
  notas     TEXT,
  activo    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO clientes (id, nombre, localidad, direccion, telefono, email, notas, activo, creado_en)
SELECT m.new_id, c.nombre, c.localidad, c.direccion, c.telefono, c.email, c.notas, c.activo, c.creado_en
FROM clientes_vieja c JOIN _map_clientes m ON m.old_id = c.id;
CREATE INDEX idx_clientes_nombre    ON clientes(nombre);
CREATE INDEX idx_clientes_localidad ON clientes(localidad);
CREATE INDEX idx_clientes_activo    ON clientes(activo);

-- ─────────────────────── HERRAMIENTAS ───────────────────
CREATE TABLE herramientas (
  id           TEXT PRIMARY KEY,
  codigo       TEXT NOT NULL UNIQUE,
  nombre       TEXT NOT NULL,
  precio       INTEGER NOT NULL DEFAULT 0,
  precio_mayor INTEGER NOT NULL DEFAULT 0,
  rubro        TEXT,
  costo        INTEGER NOT NULL DEFAULT 0,
  stock        INTEGER NOT NULL DEFAULT 0,
  stock_minimo INTEGER NOT NULL DEFAULT 0,
  notas        TEXT,
  activo       INTEGER NOT NULL DEFAULT 1,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO herramientas (id, codigo, nombre, precio, precio_mayor, rubro, costo, stock, stock_minimo, notas, activo, creado_en)
SELECT m.new_id, h.codigo, h.nombre, h.precio, h.precio_mayor, h.rubro, h.costo, h.stock, h.stock_minimo, h.notas, h.activo, h.creado_en
FROM herramientas_vieja h JOIN _map_herramientas m ON m.old_id = h.id;
CREATE INDEX idx_herramientas_nombre ON herramientas(nombre);
CREATE INDEX idx_herramientas_activo ON herramientas(activo);
CREATE INDEX idx_herramientas_rubro  ON herramientas(rubro);

-- ──────────────────────────  VENTAS ─────────────────────
CREATE TABLE ventas (
  id                 TEXT PRIMARY KEY,
  numero             INTEGER NOT NULL UNIQUE,
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
  sincronizado_en    TEXT
);
INSERT INTO ventas (id, numero, cliente_id, fecha, subtotal, descuento, total, nota, estado, origen, necesita_revision, motivo_revision, creado_en, sincronizado_en)
SELECT mv.new_id, v.numero, mc.new_id, v.fecha, v.subtotal, v.descuento, v.total, v.nota,
  CASE WHEN v.anulada = 1 THEN 'anulada' ELSE 'confirmada' END,
  'escritorio', 0, NULL, v.creado_en, v.creado_en
FROM ventas_vieja v
JOIN _map_ventas mv   ON mv.old_id = v.id
JOIN _map_clientes mc ON mc.old_id = v.cliente_id;
CREATE INDEX idx_ventas_cliente ON ventas(cliente_id);
CREATE INDEX idx_ventas_fecha   ON ventas(fecha);
CREATE INDEX idx_ventas_estado  ON ventas(estado);

-- ──────────────────────── VENTA_ITEMS ───────────────────
-- Tabla hoja: nada la referencia, se reconstruye y se dropea la vieja directo.
CREATE TABLE venta_items_nueva (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id           TEXT NOT NULL REFERENCES ventas(id),
  herramienta_id     TEXT NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT NOT NULL,
  cantidad           INTEGER NOT NULL,
  precio_unitario    INTEGER NOT NULL,
  subtotal           INTEGER NOT NULL
);
INSERT INTO venta_items_nueva (id, venta_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal)
SELECT vi.id, mv.new_id, mh.new_id, vi.nombre_herramienta, vi.cantidad, vi.precio_unitario, vi.subtotal
FROM venta_items vi
JOIN _map_ventas mv       ON mv.old_id = vi.venta_id
JOIN _map_herramientas mh ON mh.old_id = vi.herramienta_id;
DROP TABLE venta_items;
ALTER TABLE venta_items_nueva RENAME TO venta_items;
CREATE INDEX idx_venta_items_venta       ON venta_items(venta_id);
CREATE INDEX idx_venta_items_herramienta ON venta_items(herramienta_id);

-- ──────────────────────────  PAGOS ──────────────────────
CREATE TABLE pagos_nueva (
  id         TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  venta_id   TEXT REFERENCES ventas(id),
  fecha      TEXT NOT NULL,
  monto      INTEGER NOT NULL,
  medio      TEXT NOT NULL DEFAULT 'efectivo',
  nota       TEXT,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO pagos_nueva (id, cliente_id, venta_id, fecha, monto, medio, nota, creado_en)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  mc.new_id, mv.new_id, p.fecha, p.monto, p.medio, p.nota, p.creado_en
FROM pagos p
JOIN _map_clientes mc    ON mc.old_id = p.cliente_id
LEFT JOIN _map_ventas mv ON mv.old_id = p.venta_id;
DROP TABLE pagos;
ALTER TABLE pagos_nueva RENAME TO pagos;
CREATE INDEX idx_pagos_cliente ON pagos(cliente_id);
CREATE INDEX idx_pagos_venta   ON pagos(venta_id);
CREATE INDEX idx_pagos_fecha   ON pagos(fecha);

-- ──────────────────── MOVIMIENTOS DE STOCK ──────────────
CREATE TABLE movimientos_stock_nueva (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  herramienta_id   TEXT NOT NULL REFERENCES herramientas(id),
  fecha            TEXT NOT NULL,
  tipo             TEXT NOT NULL,
  cantidad         INTEGER NOT NULL,
  stock_resultante INTEGER NOT NULL,
  venta_id         TEXT REFERENCES ventas(id),
  motivo           TEXT,
  costo_unitario   INTEGER
);
INSERT INTO movimientos_stock_nueva (id, herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, motivo, costo_unitario)
SELECT ms.id, mh.new_id, ms.fecha, ms.tipo, ms.cantidad, ms.stock_resultante, mv.new_id, ms.motivo, ms.costo_unitario
FROM movimientos_stock ms
JOIN _map_herramientas mh ON mh.old_id = ms.herramienta_id
LEFT JOIN _map_ventas mv  ON mv.old_id = ms.venta_id;
DROP TABLE movimientos_stock;
ALTER TABLE movimientos_stock_nueva RENAME TO movimientos_stock;
CREATE INDEX idx_mov_herramienta ON movimientos_stock(herramienta_id);
CREATE INDEX idx_mov_fecha       ON movimientos_stock(fecha);
CREATE INDEX idx_mov_venta       ON movimientos_stock(venta_id);

-- ──────────────────── HISTORIAL DE PRECIOS ──────────────
CREATE TABLE precios_historial_nueva (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  herramienta_id  TEXT NOT NULL REFERENCES herramientas(id),
  fecha           TEXT NOT NULL,
  precio_anterior INTEGER NOT NULL,
  precio_nuevo    INTEGER NOT NULL,
  tipo_precio     TEXT NOT NULL DEFAULT 'minorista',
  motivo          TEXT
);
INSERT INTO precios_historial_nueva (id, herramienta_id, fecha, precio_anterior, precio_nuevo, tipo_precio, motivo)
SELECT ph.id, mh.new_id, ph.fecha, ph.precio_anterior, ph.precio_nuevo, ph.tipo_precio, ph.motivo
FROM precios_historial ph
JOIN _map_herramientas mh ON mh.old_id = ph.herramienta_id;
DROP TABLE precios_historial;
ALTER TABLE precios_historial_nueva RENAME TO precios_historial;
CREATE INDEX idx_precios_herramienta ON precios_historial(herramienta_id);
CREATE INDEX idx_precios_fecha       ON precios_historial(fecha);

-- ─────────────────────── PRESUPUESTOS ───────────────────
-- id/numero siguen INTEGER (nunca se crean offline); solo cambian las FK.
CREATE TABLE presupuestos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  numero       INTEGER NOT NULL UNIQUE,
  cliente_id   TEXT NOT NULL REFERENCES clientes(id),
  fecha        TEXT NOT NULL,
  subtotal     INTEGER NOT NULL,
  descuento    INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'pendiente',
  valido_hasta TEXT,
  nota         TEXT,
  venta_id     TEXT REFERENCES ventas(id),
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO presupuestos (id, numero, cliente_id, fecha, subtotal, descuento, total, estado, valido_hasta, nota, venta_id, creado_en)
SELECT p.id, p.numero, mc.new_id, p.fecha, p.subtotal, p.descuento, p.total, p.estado, p.valido_hasta, p.nota, mv.new_id, p.creado_en
FROM presupuestos_vieja p
JOIN _map_clientes mc     ON mc.old_id = p.cliente_id
LEFT JOIN _map_ventas mv  ON mv.old_id = p.venta_id;
CREATE INDEX idx_presupuestos_cliente ON presupuestos(cliente_id);
CREATE INDEX idx_presupuestos_fecha   ON presupuestos(fecha);
CREATE INDEX idx_presupuestos_estado  ON presupuestos(estado);

-- ─────────────────── PRESUPUESTO_ITEMS ──────────────────
CREATE TABLE presupuesto_items_nueva (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  presupuesto_id     INTEGER NOT NULL REFERENCES presupuestos(id),
  herramienta_id     TEXT NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT NOT NULL,
  cantidad           INTEGER NOT NULL,
  precio_unitario    INTEGER NOT NULL,
  subtotal           INTEGER NOT NULL
);
INSERT INTO presupuesto_items_nueva (id, presupuesto_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal)
SELECT pi.id, pi.presupuesto_id, mh.new_id, pi.nombre_herramienta, pi.cantidad, pi.precio_unitario, pi.subtotal
FROM presupuesto_items pi
JOIN _map_herramientas mh ON mh.old_id = pi.herramienta_id;
DROP TABLE presupuesto_items;
ALTER TABLE presupuesto_items_nueva RENAME TO presupuesto_items;
CREATE INDEX idx_presupuesto_items_presupuesto ON presupuesto_items(presupuesto_id);

-- ─────────────────── IDEMPOTENCIA (nueva) ───────────────
-- Una fila por operación ya procesada. El servidor la consulta ANTES de
-- insertar: si la clave ya existe, devuelve "resultado" tal cual y no
-- vuelve a tocar la base. Así un reintento o un envío duplicado del celular
-- nunca duplica una venta ni un pago.
CREATE TABLE operaciones (
  idempotency_key TEXT PRIMARY KEY,
  tipo            TEXT NOT NULL,        -- 'venta' | 'pago'
  entidad_id      TEXT NOT NULL,        -- id (UUID) de lo que se creó
  resultado       TEXT NOT NULL,        -- JSON de la respuesta original
  creado_en       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_operaciones_entidad ON operaciones(entidad_id);

-- ─────────────────────── LIMPIEZA ───────────────────────
-- Ahora sí: nada vivo referencia ya a estas 4 tablas viejas (todos sus hijos
-- ya fueron reconstruidos y las versiones originales, dropeadas arriba).
DROP TABLE presupuestos_vieja;
DROP TABLE ventas_vieja;
DROP TABLE clientes_vieja;
DROP TABLE herramientas_vieja;

DROP TABLE _map_clientes;
DROP TABLE _map_herramientas;
DROP TABLE _map_ventas;
