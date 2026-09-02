-- Panel de proveedor, etapas 1 y 2: soporte en sólo lectura y auditoría útil.

/*
 * Sesiones de soporte: cada vez que el proveedor entra a la instalación de un
 * cliente queda una fila acá.
 *
 * Antes esto era una línea suelta en la auditoría: constaba que alguien había
 * entrado, pero no en qué modo, ni por qué, ni hasta cuándo, ni qué tocó. Con
 * una fila propia se puede responder "el martes entré a ARBELL en modo edición
 * porque X, y estos tres cambios son míos y no del ferretero".
 */
CREATE TABLE sesiones_soporte (
  id           TEXT PRIMARY KEY,
  negocio_id   TEXT NOT NULL,
  admin        TEXT NOT NULL,
  -- 'lectura' es el modo por defecto y el único que se puede abrir sin motivo.
  modo         TEXT NOT NULL CHECK (modo IN ('lectura', 'edicion')),
  motivo       TEXT,
  iniciada_en  TEXT NOT NULL DEFAULT (datetime('now')),
  cerrada_en   TEXT,
  FOREIGN KEY (negocio_id) REFERENCES negocios(id)
);

CREATE INDEX idx_sesiones_soporte_negocio ON sesiones_soporte (negocio_id, iniciada_en DESC);
CREATE INDEX idx_sesiones_soporte_abiertas ON sesiones_soporte (cerrada_en) WHERE cerrada_en IS NULL;

/*
 * Auditoría: qué cambió exactamente, y de qué visita de soporte vino.
 *
 * Hasta ahora 'detalle' era texto armado a mano ("Venta #105 por 10000"): sirve
 * para leerlo, no para reconstruir nada ni para comparar. Los dos campos nuevos
 * guardan JSON con los valores, así se puede responder "de cuánto a cuánto".
 */
ALTER TABLE auditoria ADD COLUMN valor_anterior TEXT;
ALTER TABLE auditoria ADD COLUMN valor_nuevo TEXT;
ALTER TABLE auditoria ADD COLUMN sesion_soporte TEXT;

CREATE INDEX idx_auditoria_sesion ON auditoria (sesion_soporte) WHERE sesion_soporte IS NOT NULL;

/*
 * Append-only de verdad: lo impide la base, no el código.
 *
 * Una auditoría que el mismo sistema puede editar o borrar no prueba nada. Con
 * estos triggers, ni un bug ni una consulta a mano pueden cambiar el pasado.
 *
 * OJO — esto obliga a que la restauración de un respaldo NO toque esta tabla.
 * Restaurar borra y reinserta todo, y acá el DELETE aborta. Por eso en
 * src/tablas.ts la auditoría queda marcada como "sólo exportar": va en el
 * archivo que se baja, pero la restauración la saltea.
 */
CREATE TRIGGER auditoria_sin_update BEFORE UPDATE ON auditoria
BEGIN
  SELECT RAISE(ABORT, 'La auditoría no se modifica.');
END;

CREATE TRIGGER auditoria_sin_delete BEFORE DELETE ON auditoria
BEGIN
  SELECT RAISE(ABORT, 'La auditoría no se borra.');
END;
