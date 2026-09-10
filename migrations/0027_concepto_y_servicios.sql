-- Concepto del comprobante, fechas de servicio, condición de venta y fecha
-- elegible. Y con eso, el sistema pasa a servir para un rubro de SERVICIOS.
--
-- Por qué importa: `Concepto` es un campo obligatorio del pedido a ARCA y
-- hasta ahora se mandaba siempre 1 (Productos), hardcodeado. Una empresa de
-- servicios —una fumigadora, un gasista, un estudio— emitía facturas
-- declaradas como venta de productos. No era un campo que faltaba en una
-- pantalla: el sistema directamente no servía para ese rubro.
--
-- Cuando el concepto es 2 (Servicios) o 3 (Productos y Servicios), ARCA
-- exige además el período del servicio y el vencimiento del pago; por eso
-- las tres fechas de abajo.
--
-- Todo aditivo: una factura vieja o de un negocio de productos queda con
-- concepto 1 y las fechas en NULL, que es exactamente lo que se mandaba.

ALTER TABLE facturas ADD COLUMN concepto INTEGER NOT NULL DEFAULT 1;
ALTER TABLE facturas ADD COLUMN fch_serv_desde TEXT;
ALTER TABLE facturas ADD COLUMN fch_serv_hasta TEXT;
ALTER TABLE facturas ADD COLUMN fch_vto_pago   TEXT;

-- No la pide ARCA en el pedido de emisión: es un dato del comprobante
-- impreso. Se guarda para poder imprimirlo y para no perder con qué se
-- pactó la venta.
ALTER TABLE facturas ADD COLUMN condicion_venta TEXT;

-- ── Perfil de servicios ─────────────────────────────────────
-- Lo que lo distingue no es sólo el concepto: el que vende servicios no
-- lleva stock, así que su vocabulario y sus campos son otros.
INSERT OR IGNORE INTO perfiles_config (id, nombre, capacidades_json) VALUES
  ('servicios', 'Servicios', json_object(
    'producto_singular', 'Servicio',
    'producto_plural',   'Servicios',
    'unidad_default',    'servicio',
    'concepto_default',  'servicios'
  ));

-- Un rubro nuevo es una fila. Estos son los que más se piden y no existían.
INSERT OR IGNORE INTO rubros (id, nombre, icono, perfil_id, orden) VALUES
  ('fumigacion',   'Fumigación / control de plagas', '🪳', 'servicios', 300),
  ('plomeria',     'Plomería',                       '🔧', 'servicios', 310),
  ('gasista',      'Gasista',                        '🔥', 'servicios', 320),
  ('electricista', 'Electricista',                   '💡', 'servicios', 330),
  ('refrigeracion','Refrigeración / aire',           '❄️', 'servicios', 340),
  ('limpieza',     'Limpieza',                       '🧽', 'servicios', 350),
  ('estetica',     'Estética / peluquería',          '💇', 'servicios', 360),
  ('taller_mec',   'Taller mecánico',                '🚗', 'servicios', 370),
  ('servicios_pro','Servicios profesionales',        '📐', 'servicios', 380);
