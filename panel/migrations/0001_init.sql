-- Panel de clientes: el registro de a qué negocios les vendiste el sistema.
-- OJO: acá NO viven los datos de los negocios (sus ventas, clientes ni stock).
-- Cada instalación tiene su propia base, aislada. Esto es sólo el registro
-- comercial más un resumen que cada instalación reporta una vez por noche.

CREATE TABLE negocios (
  id         TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  contacto   TEXT,
  telefono   TEXT,
  email      TEXT,
  url        TEXT,
  -- prueba | activo | suspendido | baja
  estado     TEXT NOT NULL DEFAULT 'prueba' CHECK (estado IN ('prueba','activo','suspendido','baja')),
  notas      TEXT,
  -- Con este token la instalación se identifica al reportar. Secreto.
  token      TEXT NOT NULL UNIQUE,
  alta       TEXT NOT NULL DEFAULT (date('now')),
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_negocios_estado ON negocios (estado);

-- Un renglón por noche y por negocio: cómo viene funcionando esa instalación.
CREATE TABLE reportes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id   TEXT NOT NULL REFERENCES negocios(id),
  fecha        TEXT NOT NULL,
  ventas_mes   INTEGER NOT NULL DEFAULT 0,
  ventas_cant  INTEGER NOT NULL DEFAULT 0,
  clientes     INTEGER NOT NULL DEFAULT 0,
  productos    INTEGER NOT NULL DEFAULT 0,
  usuarios     INTEGER NOT NULL DEFAULT 0,
  ultima_venta TEXT,
  recibido_en  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (negocio_id, fecha)
);

CREATE INDEX idx_reportes_negocio ON reportes (negocio_id, fecha DESC);

-- Los usuarios del panel: vos. Nada que ver con los usuarios de cada negocio.
CREATE TABLE admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);
