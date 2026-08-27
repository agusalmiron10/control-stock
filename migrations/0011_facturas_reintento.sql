-- Poder reintentar una factura que ARCA rechazó.
--
-- El índice original reservaba (negocio_id, venta_id) para cualquier factura
-- que no fuera Nota de Crédito. El problema: cuando ARCA se caía o rechazaba,
-- igual quedaba grabada una fila 'rechazada' — y esa fila ocupaba el lugar,
-- así que la venta no se podía facturar nunca más. Un corte de red dejaba la
-- venta trabada para siempre.
--
-- Ahora el único que reserva el lugar es el comprobante autorizado: los
-- intentos fallidos se pueden acumular (quedan como historial de qué dijo
-- ARCA) y la venta se puede reintentar hasta que salga.
DROP INDEX IF EXISTS idx_facturas_venta;

CREATE UNIQUE INDEX idx_facturas_venta
  ON facturas (negocio_id, venta_id)
  WHERE factura_original_id IS NULL AND estado = 'autorizada';

-- Buscar las facturas de un negocio por fecha (listado y libro de IVA).
CREATE INDEX IF NOT EXISTS idx_facturas_negocio_fecha ON facturas (negocio_id, creado_en);
