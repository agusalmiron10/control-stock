-- Borra TODOS los datos del negocio para arrancar limpio.
-- NO borra usuarios (tu login se mantiene).
-- Ejecutar con: npm run db:reset:local  (o :remote)
DELETE FROM precios_historial;
DELETE FROM movimientos_stock;
DELETE FROM pagos;
DELETE FROM venta_items;
DELETE FROM ventas;
DELETE FROM herramientas;
DELETE FROM clientes;

-- Reinicia los contadores AUTOINCREMENT (si existe la tabla sqlite_sequence).
DELETE FROM sqlite_sequence WHERE name IN
  ('clientes','herramientas','ventas','venta_items','pagos','movimientos_stock','precios_historial');
