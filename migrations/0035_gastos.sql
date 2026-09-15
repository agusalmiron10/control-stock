-- Gastos: la plata que sale y NO es mercadería.
--
-- Hasta acá el sistema sabía todo lo que entra (ventas, cobranzas) y una
-- sola cosa de lo que sale: las compras a proveedores. Por eso el reporte
-- de rentabilidad mostraba margen bruto —lo vendido menos lo que costó la
-- mercadería— y no la ganancia real: alquiler, sueldos, luz, impuestos y
-- fletes no estaban en ningún lado.
--
-- Por qué una tabla aparte y no reusar `compras`: una compra mueve stock
-- (entra mercadería, se recalcula el costo promedio) y un gasto no mueve
-- nada, sólo plata. Meterlos juntos obligaría a que la mitad de las
-- columnas de compras queden vacías y a filtrar por un flag en cada
-- consulta de stock.

CREATE TABLE gastos (
  id          TEXT PRIMARY KEY,
  negocio_id  TEXT NOT NULL REFERENCES negocios(id),
  fecha       TEXT NOT NULL,              -- ISO YYYY-MM-DD
  -- Texto libre y no una lista fija: cada rubro gasta en cosas distintas, y
  -- una lista cerrada termina en que todo el mundo carga "Otros". La
  -- pantalla sugiere las que ya usó este negocio.
  categoria   TEXT NOT NULL,
  descripcion TEXT,
  monto       INTEGER NOT NULL,           -- centavos, como todo el resto
  medio_pago  TEXT,
  -- Quién lo cargó (usuarios.id), para el registro de auditoría.
  atendido_por INTEGER REFERENCES usuarios(id),
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El reporte siempre pide un rango de fechas de un negocio.
CREATE INDEX idx_gastos_negocio_fecha ON gastos (negocio_id, fecha);
