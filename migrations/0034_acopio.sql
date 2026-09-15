-- Acopio: el cliente paga y reserva mercadería ahora, y se la lleva en
-- retiros parciales más adelante (distintas fechas).
--
-- Decisión de diseño: se reusa la tabla `remitos` como el mecanismo de
-- retiro, en vez de crear una tabla paralela. `remitos` ya sabe controlar
-- entregas parciales contra una venta (numeración, estados, "cuánto queda
-- por entregar" — ver migrations/0017_remitos.sql). La única diferencia real
-- es CUÁNDO se mueve el stock físico:
--   · Venta normal   → el stock físico baja al confirmar la venta. El remito
--                      es sólo el papel, no toca stock (como hasta ahora).
--   · Venta de acopio → el stock físico NO baja al vender (ver es_acopio):
--                      baja recién en cada remito de retiro contra esa venta.
--
-- Con esto, "stock disponible" (lo que se puede seguir vendiendo) siempre se
-- puede calcular como: stock físico − lo comprado en acopio y todavía no
-- retirado. No hace falta guardar ese número aparte: sale de sumar
-- venta_items de ventas con es_acopio=1 y restarle remito_items ya
-- entregados contra esas mismas ventas (ver src/acopio.ts).

ALTER TABLE ventas ADD COLUMN es_acopio INTEGER NOT NULL DEFAULT 0;

-- Sólo indexa las ventas de acopio (que van a ser una minoría): más chico y
-- más rápido que un índice sobre toda la tabla para una consulta que siempre
-- filtra por es_acopio = 1.
CREATE INDEX idx_ventas_acopio ON ventas (negocio_id, id) WHERE es_acopio = 1;

-- Traza qué remito generó (o deshizo) un movimiento de stock de acopio, para
-- poder revertirlo con precisión si el remito de retiro se anula. Nullable:
-- todo movimiento que no sea de acopio sigue sin tener remito de por medio.
ALTER TABLE movimientos_stock ADD COLUMN remito_id TEXT REFERENCES remitos(id);
