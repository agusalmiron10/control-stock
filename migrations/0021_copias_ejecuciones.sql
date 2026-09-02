-- Etapa 4: los fallos de copia dejan de ser invisibles.
--
-- Hasta ahora un fallo del cron sólo existe en console.error, que se
-- pierde a los pocos días en los logs de Cloudflare y que nadie mira si no
-- hay ningún motivo para ir a buscarlo. Con esta tabla, el panel puede
-- decir "a este cliente le falló la copia de ayer" en vez de que el
-- proveedor se entere el día que necesita restaurar y no hay nada.

CREATE TABLE copias_ejecuciones (
  negocio_id   TEXT NOT NULL,
  fecha        TEXT NOT NULL,
  estado       TEXT NOT NULL CHECK (estado IN ('ok', 'error')),
  tamano       INTEGER,
  error        TEXT,
  duracion_ms  INTEGER,
  terminada_en TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (negocio_id, fecha)
);

CREATE INDEX idx_copias_ejecuciones_fecha ON copias_ejecuciones (fecha DESC);
CREATE INDEX idx_copias_ejecuciones_error ON copias_ejecuciones (estado) WHERE estado = 'error';
