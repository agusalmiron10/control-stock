-- Datos de ejemplo: 3 herramientas, 3 clientes, 4 ventas con pagos parciales,
-- pagos a cuenta con FIFO y un saldo a favor. Todo en centavos.
-- Ejecutar con: npm run db:seed:local  (o :remote)
-- Para borrar y arrancar limpio: npm run db:reset:local

-- ── Clientes ──────────────────────────────────────────────
INSERT INTO clientes (id, nombre, localidad, direccion, telefono, email, notas, activo) VALUES
  (1, 'Juan Pérez',        'San Martín',  'Av. Mitre 1234', '11-5555-1001', 'juanperez@example.com',  'Cliente frecuente', 1),
  (2, 'María Gómez',       'Morón',       'Belgrano 567',   '11-5555-1002', 'mariagomez@example.com', NULL, 1),
  (3, 'Pedro Rodríguez',   'Ramos Mejía', 'Rivadavia 890',  '11-5555-1003', NULL,                     'Paga siempre por adelantado', 1);

-- ── Herramientas ──────────────────────────────────────────
INSERT INTO herramientas (id, codigo, nombre, precio, costo, stock, stock_minimo, notas, activo) VALUES
  (1, 'MART-001', 'Martillo de bola 500g',      1250000, 700000, 35, 10, NULL, 1),
  (2, 'PINZ-002', 'Pinza universal 8"',          890000, 500000, 14, 15, 'Reponer', 1),
  (3, 'DEST-003', 'Destornillador Phillips #2',  350000, 150000,  7,  8, NULL, 1);

-- ── Ventas ────────────────────────────────────────────────
INSERT INTO ventas (id, numero, cliente_id, fecha, subtotal, descuento, total, nota, anulada) VALUES
  (1, 1, 1, '2026-06-10',  8030000,      0,  8030000, 'Pedido de banco de trabajo', 0),
  (2, 2, 2, '2026-06-20',  1050000,      0,  1050000, NULL, 0),
  (3, 3, 2, '2026-07-05', 12500000, 625000, 11875000, 'Descuento 5% por cantidad', 0),
  (4, 4, 3, '2026-07-10',  3560000,      0,  3560000, NULL, 0);

-- ── Items de venta (precios congelados) ───────────────────
INSERT INTO venta_items (venta_id, herramienta_id, nombre_herramienta, cantidad, precio_unitario, subtotal) VALUES
  (1, 1, 'Martillo de bola 500g',     5, 1250000, 6250000),
  (1, 2, 'Pinza universal 8"',        2,  890000, 1780000),
  (2, 3, 'Destornillador Phillips #2',3,  350000, 1050000),
  (3, 1, 'Martillo de bola 500g',    10, 1250000,12500000),
  (4, 2, 'Pinza universal 8"',        4,  890000, 3560000);

-- ── Movimientos de stock (alta inicial + ventas) ──────────
-- Va después de las ventas porque referencia venta_id (clave foránea).
INSERT INTO movimientos_stock (herramienta_id, fecha, tipo, cantidad, stock_resultante, venta_id, motivo) VALUES
  (1, '2026-06-01', 'alta',       50,  50, NULL, 'Carga inicial'),
  (2, '2026-06-01', 'alta',       20,  20, NULL, 'Carga inicial'),
  (3, '2026-06-01', 'alta',       10,  10, NULL, 'Carga inicial'),
  (1, '2026-06-10', 'venta',      -5,  45, 1,    NULL),
  (2, '2026-06-10', 'venta',      -2,  18, 1,    NULL),
  (3, '2026-06-20', 'venta',      -3,   7, 2,    NULL),
  (1, '2026-07-05', 'venta',     -10,  35, 3,    NULL),
  (2, '2026-07-10', 'venta',      -4,  14, 4,    NULL);

-- ── Pagos ─────────────────────────────────────────────────
-- Juan: pago directo parcial. María: pago total de la #2 + pago a cuenta (FIFO → #3 parcial).
-- Pedro: pago a cuenta que cubre su venta y deja saldo a favor.
INSERT INTO pagos (id, cliente_id, venta_id, fecha, monto, medio, nota) VALUES
  (1, 1, 1,    '2026-06-10', 4000000, 'transferencia', 'Seña 50%'),
  (2, 2, 2,    '2026-06-20', 1050000, 'efectivo',      NULL),
  (3, 3, NULL, '2026-07-10', 5000000, 'efectivo',      'Pago adelantado'),
  (4, 2, NULL, '2026-07-15', 6000000, 'transferencia', 'A cuenta');

-- ── Historial de precios (ejemplo de un aumento) ──────────
INSERT INTO precios_historial (herramienta_id, fecha, precio_anterior, precio_nuevo, motivo) VALUES
  (1, '2026-05-15', 1100000, 1250000, 'Aumento de insumos');
