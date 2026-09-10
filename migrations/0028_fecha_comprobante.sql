-- Con qué fecha se emitió el comprobante ante ARCA.
--
-- Hasta la migración anterior no hacía falta: se emitía siempre con la fecha
-- de hoy, así que la fecha fiscal y `creado_en` eran la misma y el
-- comprobante impreso podía usar cualquiera de las dos.
--
-- Al permitir fechar el comprobante con la fecha de la venta, las dos se
-- separaron: facturar el miércoles una venta del lunes deja a ARCA con
-- lunes y a `creado_en` con miércoles. Sin guardar cuál se mandó, el papel
-- y el QR mostrarían una fecha distinta de la que ARCA tiene registrada —
-- en un comprobante fiscal eso no puede pasar.
ALTER TABLE facturas ADD COLUMN fecha_comprobante TEXT;

-- Las que ya existen se emitieron todas con la fecha del día, así que su
-- fecha fiscal es la de creación.
UPDATE facturas SET fecha_comprobante = date(creado_en) WHERE fecha_comprobante IS NULL;
