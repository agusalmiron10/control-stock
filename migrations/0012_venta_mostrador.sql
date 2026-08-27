-- Venta de mostrador: el que entra, paga y se va.
--
-- Hasta ahora toda venta exigía un cliente cargado, así que para venderle a
-- alguien de paso había que inventarle una ficha. En vez de permitir ventas
-- sin cliente (eso rompería cuenta corriente, la ficha del cliente y la
-- facturación, que necesitan a quién facturarle), cada negocio tiene un
-- cliente especial "Consumidor Final" al que se le imputan estas ventas.
--
-- Es un cliente común y corriente salvo por la marca: no se puede borrar ni
-- renombrar, y a ARCA se le informa como Consumidor Final (doc tipo 99).
ALTER TABLE clientes ADD COLUMN es_consumidor_final INTEGER NOT NULL DEFAULT 0;

-- Uno solo por negocio.
CREATE UNIQUE INDEX idx_clientes_consumidor_final
  ON clientes (negocio_id)
  WHERE es_consumidor_final = 1;
