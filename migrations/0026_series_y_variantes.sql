-- Las tres capacidades que faltaban. Dos necesitan esquema; la tercera no.
--
-- 1) requiere_numero_serie → tabla nueva + una bandera por producto.
-- 2) permite_variantes     → una variante ES un producto, hijo de otro.
-- 3) venta_fraccionada     → NO necesita migración (ver el comentario al pie).
--
-- Como siempre: todo aditivo. Un negocio con las capacidades apagadas no ve
-- ninguna diferencia y estas columnas quedan en NULL / 0.

-- ── 1. Número de serie ──────────────────────────────────────
-- La capacidad se prende por RUBRO, pero dentro de un mismo negocio no todo
-- lleva serie: una casa de celulares vende teléfonos con serie y fundas sin
-- serie. Por eso además de la capacidad hay una bandera por producto.
ALTER TABLE herramientas ADD COLUMN requiere_serie INTEGER NOT NULL DEFAULT 0;

-- Una fila por UNIDAD vendida, no por renglón: si vende 3 televisores, son
-- 3 series. Por eso no cuelga de venta_items (que es un renglón con
-- cantidad) sino de la venta + el producto.
CREATE TABLE IF NOT EXISTS series_vendidas (
  id             TEXT PRIMARY KEY,
  negocio_id     TEXT NOT NULL,
  venta_id       TEXT NOT NULL,
  herramienta_id TEXT NOT NULL,
  serie          TEXT NOT NULL,
  garantia_hasta TEXT,
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Para "¿a quién le vendí esta serie?", que es la pregunta real cuando
-- alguien vuelve con una garantía.
CREATE INDEX IF NOT EXISTS idx_series_busqueda ON series_vendidas (negocio_id, serie);
CREATE INDEX IF NOT EXISTS idx_series_venta    ON series_vendidas (negocio_id, venta_id);

-- ── 2. Variantes (talle, color) ─────────────────────────────
-- Decisión de diseño importante: una variante es un PRODUCTO, hijo de otro,
-- no una tabla aparte con su propio stock.
--
-- Con esto, todo lo que ya existe sigue funcionando sin tocar una línea:
-- el stock, los movimientos, la venta, el remito, la importación y la
-- facturación ya saben trabajar con productos. Una tabla aparte habría
-- obligado a reescribir cada uno de esos caminos, que es exactamente donde
-- están las ventas reales de los negocios que ya usan el sistema.
--
-- El padre es sólo la agrupación ("Remera lisa"); lo que se vende y lo que
-- tiene stock son los hijos ("Remera lisa · M · negro").
ALTER TABLE herramientas ADD COLUMN padre_id TEXT;
-- Qué combinación es este hijo: {"talle":"M","color":"negro"}. Las claves
-- salen de la capacidad tipos_variante, así que un rubro que mañana use
-- {"sabor","tamaño"} no necesita otra migración.
ALTER TABLE herramientas ADD COLUMN variante_json TEXT;

CREATE INDEX IF NOT EXISTS idx_herramientas_padre
  ON herramientas (negocio_id, padre_id) WHERE padre_id IS NOT NULL;

-- ── 3. Venta fraccionada: por qué no hay nada acá ───────────
-- Vender 1,5 kg no necesita migración: SQLite guarda 1.5 tal cual en una
-- columna declarada INTEGER (la afinidad sólo convierte cuando la
-- conversión es exacta; 1.5 no lo es, así que queda REAL).
--
-- Todo el trabajo de esa capacidad es de código: los validadores que hoy
-- exigen entero, y las cuentas y los textos que asumen unidades enteras.
