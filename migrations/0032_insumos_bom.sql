-- Insumos (materiales de taller) + lista de materiales (BOM) por presupuesto.
--
-- "insumos" es un stock aparte del catálogo de venta (herramientas): son los
-- materiales que se consumen para ARMAR algo a medida (cuero, hilo, hebillas,
-- etc.), no productos que se venden sueltos. Por eso tabla propia, con su
-- propio costo y su propio stock — que además puede ser fraccionario (2,5
-- metros de cuero), a diferencia del stock entero de herramientas.
--
-- "presupuesto_insumos" es la lista de materiales de UN presupuesto (el BOM):
-- se suma a los presupuesto_items que ya existían (productos de catálogo),
-- no los reemplaza — un presupuesto puede tener renglones de catálogo,
-- materiales de taller, o las dos cosas.
CREATE TABLE insumos (
  id             TEXT PRIMARY KEY,
  negocio_id     TEXT NOT NULL REFERENCES negocios(id),
  nombre         TEXT NOT NULL,
  unidad_medida  TEXT NOT NULL DEFAULT 'unidad',
  costo_unitario INTEGER NOT NULL DEFAULT 0, -- centavos, mismo criterio que el resto del sistema
  stock_actual   REAL NOT NULL DEFAULT 0,    -- puede ser fraccionario (metros, kg, litros…)
  activo         INTEGER NOT NULL DEFAULT 1,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_insumos_negocio ON insumos(negocio_id);
CREATE INDEX idx_insumos_nombre  ON insumos(negocio_id, nombre);

CREATE TABLE presupuesto_insumos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id         TEXT NOT NULL REFERENCES negocios(id),
  presupuesto_id     INTEGER NOT NULL REFERENCES presupuestos(id),
  insumo_id          TEXT NOT NULL REFERENCES insumos(id),
  nombre_insumo      TEXT NOT NULL,    -- copia histórica, mismo criterio que presupuesto_items.nombre_herramienta
  cantidad_requerida REAL NOT NULL,
  costo_unitario     INTEGER NOT NULL  -- copia histórica del costo al momento de armar el presupuesto
);
CREATE INDEX idx_presupuesto_insumos_negocio ON presupuesto_insumos(negocio_id);
CREATE INDEX idx_presupuesto_insumos_pres    ON presupuesto_insumos(presupuesto_id);

-- Marca cuándo se descontó el stock de insumos de este presupuesto (al
-- aprobarlo). NULL = todavía no se descontó nada. Sirve para no descontar
-- dos veces y para saber si "cancelar" tiene algo que devolver.
ALTER TABLE presupuestos ADD COLUMN insumos_descontados_en TEXT;
