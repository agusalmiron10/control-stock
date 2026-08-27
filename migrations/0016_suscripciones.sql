-- Capa de suscripción: qué te paga cada negocio y hasta cuándo está al día.
--
-- Hasta ahora la tabla `negocios` tenía `estado` (prueba/activo/suspendido/
-- baja) pero nada de plata: ni plan, ni precio, ni vencimiento, ni registro de
-- quién pagó. O sea que el cobro se llevaba de memoria.
--
-- El corte es por FECHA, no por un booleano: `paga_hasta` es el día hasta el
-- que el negocio está cubierto. Cada pago la empuja hacia adelante. Así el
-- sistema puede avisar quién vence esta semana y suspender solo al que se pasó.

ALTER TABLE negocios ADD COLUMN plan TEXT;                    -- texto libre: "Básico", "Full", lo que uses
ALTER TABLE negocios ADD COLUMN precio_mensual INTEGER;       -- centavos, NULL = todavía sin definir
ALTER TABLE negocios ADD COLUMN paga_hasta TEXT;              -- ISO YYYY-MM-DD; NULL = nunca pagó
-- Días de tolerancia después del vencimiento antes de suspender. Por defecto
-- una semana: nadie pierde el sistema por atrasarse un día.
ALTER TABLE negocios ADD COLUMN dias_gracia INTEGER NOT NULL DEFAULT 7;
-- Si es 1, el cron nunca lo suspende (para el negocio propio, o un acuerdo especial).
ALTER TABLE negocios ADD COLUMN sin_corte INTEGER NOT NULL DEFAULT 0;

-- El negocio del propio proveedor no se corta a sí mismo.
UPDATE negocios SET sin_corte = 1 WHERE codigo = 'arbell';

-- ---------------------------------------------------------------
-- Cobros. Append-only: es el respaldo de qué se cobró y cuándo.
-- ---------------------------------------------------------------
CREATE TABLE suscripcion_pagos (
  id             TEXT PRIMARY KEY,
  negocio_id     TEXT NOT NULL REFERENCES negocios(id),
  fecha          TEXT NOT NULL,              -- cuándo se cobró
  monto          INTEGER NOT NULL,           -- centavos
  medio          TEXT,                       -- transferencia, efectivo, etc.
  -- Hasta qué fecha quedó cubierto el negocio DESPUÉS de este pago. Guardarlo
  -- acá permite reconstruir el historial aunque después se corrija a mano.
  cubre_hasta    TEXT NOT NULL,
  nota           TEXT,
  registrado_por TEXT,                       -- usuario del proveedor que lo cargó
  creado_en      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_susc_pagos_negocio ON suscripcion_pagos (negocio_id, fecha);
