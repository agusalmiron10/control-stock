-- Catálogo ARBELL (lista de precios por menor).
-- 41 productos cargados con precio, costo y stock en 0 para completar después.
-- Aplicar:  wrangler d1 execute control-stock --remote --file=./seed/arbell.sql
--   (o --local para la base de desarrollo)

INSERT INTO herramientas (codigo, nombre, precio, costo, stock, stock_minimo) VALUES
  -- Corta fierros y puntas
  ('CF-35',      'Cortafierro y punta N°35', 0, 0, 0, 0),
  ('CF-30',      'Cortafierro y punta N°30', 0, 0, 0, 0),
  ('CF-25',      'Cortafierro y punta N°25', 0, 0, 0, 0),
  ('CF-MINI',    'Cortafierro y punta Mini', 0, 0, 0, 0),
  -- Masas (mazas)
  ('MASA-1',     'Masa 1 kg',      0, 0, 0, 0),
  ('MASA-114',   'Masa 1 1/4 kg',  0, 0, 0, 0),
  ('MASA-112',   'Masa 1 1/2 kg',  0, 0, 0, 0),
  ('MASA-2',     'Masa 2 kg',      0, 0, 0, 0),
  ('MASA-5',     'Masa 5 kg',      0, 0, 0, 0),
  -- Clavos
  ('CLAVO-G',    'Clavos grandes',  0, 0, 0, 0),
  ('CLAVO-M',    'Clavos medianos', 0, 0, 0, 0),
  ('CLAVO-CH',   'Clavos chicos',   0, 0, 0, 0),
  -- Cucharas
  ('CUCH-7',     'Cuchara 7"', 0, 0, 0, 0),
  ('CUCH-8',     'Cuchara 8"', 0, 0, 0, 0),
  -- Con cabo
  ('HACHA',      'Hacha',    0, 0, 0, 0),
  ('HACHITA',    'Hachita',  0, 0, 0, 0),
  ('PIQUETA',    'Piqueta',  0, 0, 0, 0),
  ('HACHUELA',   'Hachuela', 0, 0, 0, 0),
  -- Barretas
  ('BARR-60',    'Barreta 60',  0, 0, 0, 0),
  ('BARR-80',    'Barreta 80',  0, 0, 0, 0),
  ('BARR-100',   'Barreta 100', 0, 0, 0, 0),
  ('BARR-120',   'Barreta 120', 0, 0, 0, 0),
  ('BARRETON-25','Barretón 25', 0, 0, 0, 0),
  -- Ruedas
  ('RUEDA-HORM', 'Rueda hormigonera', 0, 0, 0, 0),
  ('RUEDA-CAD',  'Rueda cadenilla',   0, 0, 0, 0),
  ('RUEDA-MAC',  'Rueda maciza',      0, 0, 0, 0),
  -- Tenazas
  ('TEN-9',      'Tenaza 9"',  0, 0, 0, 0),
  ('TEN-12',     'Tenaza 12"', 0, 0, 0, 0),
  -- Grinfas (llaves grifa)
  ('GRINFA-6',   'Grinfa N°6',  0, 0, 0, 0),
  ('GRINFA-8',   'Grinfa N°8',  0, 0, 0, 0),
  ('GRINFA-10',  'Grinfa N°10', 0, 0, 0, 0),
  ('GRINFA-12',  'Grinfa N°12', 0, 0, 0, 0),
  ('GRINFA-16',  'Grinfa N°16', 0, 0, 0, 0),
  ('GRINFA-20',  'Grinfa N°20', 0, 0, 0, 0),
  ('GRINFA-25',  'Grinfa N°25', 0, 0, 0, 0),
  -- Otros productos
  ('PICO',       'Pico',              0, 0, 0, 0),
  ('PALA-CANO',  'Palas de caño',     0, 0, 0, 0),
  ('PALA-MAD',   'Palas de madera',   0, 0, 0, 0),
  ('CABO-CANO',  'Cabo de caño',      0, 0, 0, 0),
  ('BALDE-ALB',  'Balde de albañil',  0, 0, 0, 0),
  ('PALA-GER',   'Palas de Gerardi',  0, 0, 0, 0);
