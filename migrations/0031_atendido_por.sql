-- "Atendido por": quién de la cuenta cargó la venta/presupuesto/remito, para
-- mostrarlo en el papel (factura, presupuesto, remito) con su foto de perfil
-- y nombre — el dueño quiere que quede claro quién atendió a cada cliente.
--
-- Nullable a propósito: las filas que ya existen no tienen quién las cargó
-- (nunca se guardó), y no hay forma de reconstruirlo con certeza — la
-- auditoría no cubre la creación de ventas ni de presupuestos (sólo
-- ediciones), así que inventar un usuario ahí sería peor que dejarlo vacío.
-- Sin REFERENCES: un usuario se puede borrar más adelante y la venta vieja
-- tiene que seguir imprimiendo bien (sin la sección, no rota).
ALTER TABLE ventas ADD COLUMN atendido_por INTEGER;
ALTER TABLE presupuestos ADD COLUMN atendido_por INTEGER;
ALTER TABLE remitos ADD COLUMN atendido_por INTEGER;
