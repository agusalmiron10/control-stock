-- Facturación ARCA: pasar de "un certificado por negocio" a delegación.
--
-- Modelo nuevo: hay UN solo certificado, el del proveedor del sistema. Cada
-- negocio le delega el servicio de Facturación Electrónica desde el
-- Administrador de Relaciones de ARCA (trámite que hacen ellos con su propia
-- clave fiscal — nunca nos dan credenciales). En cada llamada a WSFE se manda
-- Auth.Cuit = CUIT del negocio, así el comprobante sale a nombre de ellos.
--
-- Por qué el ticket de acceso es GLOBAL y no por negocio: el
-- LoginTicketRequest que se firma sólo lleva uniqueId, tiempos y el nombre del
-- servicio — el CUIT representado no aparece por ningún lado. O sea que el
-- ticket queda atado al certificado, no al negocio, y uno solo sirve para
-- todos. Cachearlo por negocio provocaría N logins idénticos, y WSAA rechaza
-- pedir uno nuevo mientras el anterior siga vigente.

CREATE TABLE arca_proveedor (
  -- Una fila por ambiente: homologación y producción tienen tickets distintos.
  ambiente        TEXT PRIMARY KEY CHECK (ambiente IN ('homologacion', 'produccion')),
  wsaa_token      TEXT,
  wsaa_sign       TEXT,
  wsaa_expira_en  TEXT,
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO arca_proveedor (ambiente) VALUES ('homologacion'), ('produccion');

-- El certificado y la clave privada del negocio dejan de usarse: ahora hay uno
-- solo y vive en los secrets del Worker, nunca en la base. Las columnas se
-- dejan por ahora (SQLite hace costoso sacarlas y no molestan), pero no se
-- leen más. El código las ignora.

-- Qué punto de venta usa cada negocio se sigue guardando por negocio, igual
-- que el CUIT y la condición de IVA: eso no cambia con la delegación.

-- Deja constancia de si la delegación fue verificada contra ARCA, para poder
-- avisar en pantalla cuando falta el trámite del lado del cliente.
ALTER TABLE facturacion_config ADD COLUMN delegacion_verificada_en TEXT;
