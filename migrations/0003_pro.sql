-- Features pro: presupuestos, roles, resumen diario automático, costo por lote.

-- ── Roles (dueño ve todo; empleado no ve costos ni rentabilidad) ──
ALTER TABLE usuarios ADD COLUMN rol TEXT NOT NULL DEFAULT 'dueño';

-- ── Costo del lote en cada movimiento de producción (para costo promedio ponderado) ──
ALTER TABLE movimientos_stock ADD COLUMN costo_unitario INTEGER;

-- ─────────────────────── PRESUPUESTOS ────────────────────────
-- No tocan stock ni generan deuda. Si el cliente acepta, se convierten en venta.
CREATE TABLE presupuestos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  numero       INTEGER NOT NULL UNIQUE,
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id),
  fecha        TEXT    NOT NULL,             -- ISO YYYY-MM-DD
  subtotal     INTEGER NOT NULL,
  descuento    INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL,
  estado       TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente|aceptado|rechazado|vencido
  valido_hasta TEXT,                         -- ISO, opcional
  nota         TEXT,
  venta_id     INTEGER REFERENCES ventas(id), -- si se convirtió, la venta resultante
  creado_en    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_presupuestos_cliente ON presupuestos(cliente_id);
CREATE INDEX idx_presupuestos_fecha   ON presupuestos(fecha);
CREATE INDEX idx_presupuestos_estado  ON presupuestos(estado);

CREATE TABLE presupuesto_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  presupuesto_id     INTEGER NOT NULL REFERENCES presupuestos(id),
  herramienta_id     INTEGER NOT NULL REFERENCES herramientas(id),
  nombre_herramienta TEXT    NOT NULL,
  cantidad           INTEGER NOT NULL,
  precio_unitario    INTEGER NOT NULL,
  subtotal           INTEGER NOT NULL
);
CREATE INDEX idx_presupuesto_items_presupuesto ON presupuesto_items(presupuesto_id);

-- ────────────────── RESUMEN DIARIO (cron automático) ──────────────────
-- Una fila por día, generada de madrugada por el Cron Trigger.
CREATE TABLE resumenes_diarios (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha               TEXT    NOT NULL UNIQUE, -- día que resume, ISO
  ventas_total        INTEGER NOT NULL DEFAULT 0,
  ventas_cant         INTEGER NOT NULL DEFAULT 0,
  cobranzas_total     INTEGER NOT NULL DEFAULT 0,
  cobranzas_cant      INTEGER NOT NULL DEFAULT 0,
  saldo_pendiente     INTEGER NOT NULL DEFAULT 0, -- total a cobrar a esa fecha
  clientes_con_deuda  INTEGER NOT NULL DEFAULT 0,
  stock_bajo_cant     INTEGER NOT NULL DEFAULT 0,
  generado_en         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resumenes_fecha ON resumenes_diarios(fecha);
