-- 1. Restaurar el stock de los productos que habían sido vendidos
UPDATE herramientas 
SET stock = stock + (
    SELECT COALESCE(SUM(cantidad), 0) 
    FROM venta_items 
    WHERE herramienta_id = herramientas.id
);

-- 2. Borrar transacciones y clientes
DELETE FROM pagos;
DELETE FROM venta_items;
DELETE FROM movimientos_stock WHERE venta_id IS NOT NULL;
DELETE FROM ventas;
DELETE FROM clientes;

-- 3. Reiniciar los IDs automáticos
UPDATE sqlite_sequence SET seq = 0 WHERE name IN ('pagos', 'venta_items', 'ventas', 'clientes');
