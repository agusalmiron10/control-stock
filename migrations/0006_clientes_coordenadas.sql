-- Migración para agregar latitud y longitud a la tabla clientes
ALTER TABLE clientes ADD COLUMN latitud REAL;
ALTER TABLE clientes ADD COLUMN longitud REAL;
