-- Dos capacidades que estaban declaradas y no hacían nada:
-- permite_vencimientos y precios_por_escala.
--
-- Las dos son ADITIVAS a propósito: no cambian ninguna columna ni ninguna
-- cuenta existente. Un negocio con la capacidad apagada no ve ninguna
-- diferencia, y las columnas quedan en NULL / la tabla vacía.
--
-- Las otras tres capacidades declaradas (permite_variantes,
-- venta_fraccionada, requiere_numero_serie) NO entran acá: las dos primeras
-- reestructuran cómo se lleva el stock y necesitan su propia migración con
-- su propia prueba, y la tercera toca el alta de la venta.

-- ── Vencimientos ────────────────────────────────────────────
-- Fecha por producto, no por lote. Es lo que sirve para una perfumería o una
-- veterinaria (un producto, un vencimiento). El control por lote —varias
-- partidas del mismo producto con fechas distintas— es otra cosa y va a
-- necesitar su propia tabla.
ALTER TABLE herramientas ADD COLUMN vence_el TEXT;

CREATE INDEX IF NOT EXISTS idx_herramientas_vence
  ON herramientas (negocio_id, vence_el) WHERE vence_el IS NOT NULL;

-- ── Precio por cantidad (escalas) ───────────────────────────
-- "De 1 a 9, $100. De 10 en adelante, $85." Cada fila es un tramo que
-- arranca en desde_cantidad; el precio que se aplica es el del tramo más
-- alto que la cantidad alcance.
--
-- Es distinto del módulo precio_mayorista, que es una SEGUNDA LISTA elegida
-- a mano al vender. Acá el precio sale de cuánto se lleva.
CREATE TABLE IF NOT EXISTS precios_escala (
  id             TEXT PRIMARY KEY,
  negocio_id     TEXT NOT NULL,
  herramienta_id TEXT NOT NULL,
  desde_cantidad INTEGER NOT NULL,
  precio         INTEGER NOT NULL,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Un solo precio por tramo y por producto: dos filas con el mismo
  -- desde_cantidad harían ambiguo qué precio corresponde.
  UNIQUE (negocio_id, herramienta_id, desde_cantidad)
);

CREATE INDEX IF NOT EXISTS idx_precios_escala_herr
  ON precios_escala (negocio_id, herramienta_id, desde_cantidad);
