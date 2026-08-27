-- Facturación electrónica ARCA (ex-AFIP): cada negocio puede activar el
-- módulo, cargar su CUIT/certificado y emitir Factura A/B/C con CAE real
-- desde una venta ya cargada, más la Nota de Crédito si la anula.
--
-- Diseño (ver plan de facturación electrónica):
--   * IVA v1: una sola alícuota por comprobante. iva_porcentaje_defecto es
--     por negocio; herramientas.iva_porcentaje es un override opcional que
--     el flujo v1 todavía no usa, pero el esquema ya lo soporta.
--   * La numeración fiscal la pone ARCA (FECompUltimoAutorizado), no esta
--     tabla — facturas.numero sólo cachea lo que ARCA autorizó.
--   * facturas.factura_original_id: null en una factura, seteado apuntando
--     a la factura que credita cuando la fila es una Nota de Crédito.
--   * La clave privada se guarda cifrada (AES-GCM, ver src/facturacion/
--     certificados.ts) — clave_privada_enc es el ciphertext en base64, nunca
--     la clave en texto plano. El certificado público no es secreto.

-- ── Datos fiscales del negocio (1:1, la clave es negocio_id) ──
CREATE TABLE facturacion_config (
  negocio_id             TEXT PRIMARY KEY REFERENCES negocios(id),
  activo                 INTEGER NOT NULL DEFAULT 0,
  cuit                   TEXT,
  razon_social           TEXT,
  condicion_iva          TEXT CHECK (condicion_iva IN ('responsable_inscripto', 'monotributo', 'exento')),
  punto_venta            INTEGER,
  ambiente               TEXT NOT NULL DEFAULT 'homologacion'
                            CHECK (ambiente IN ('homologacion', 'produccion')),
  iva_porcentaje_defecto INTEGER NOT NULL DEFAULT 2100, -- centésimas de punto: 2100 = 21,00%
  cert_pem               TEXT,
  clave_privada_enc      TEXT,
  clave_privada_iv       TEXT,
  cert_subido_en         TEXT,
  wsaa_token             TEXT,
  wsaa_sign              TEXT,
  wsaa_expira_en         TEXT,
  actualizado_en         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Documento fiscal del cliente (opcional; obligatorio sólo para tipo A) ──
ALTER TABLE clientes ADD COLUMN doc_tipo TEXT;      -- 'CUIT' | 'DNI' | null (consumidor final)
ALTER TABLE clientes ADD COLUMN doc_numero TEXT;
ALTER TABLE clientes ADD COLUMN condicion_iva TEXT; -- 'responsable_inscripto'|'monotributo'|'exento'|null

-- ── Override de alícuota por producto (no usado por el flujo v1 todavía) ──
ALTER TABLE herramientas ADD COLUMN iva_porcentaje INTEGER;

-- ── Comprobantes emitidos: facturas y sus notas de crédito ──
CREATE TABLE facturas (
  id                  TEXT PRIMARY KEY,
  negocio_id          TEXT NOT NULL REFERENCES negocios(id),
  venta_id            TEXT NOT NULL REFERENCES ventas(id),
  factura_original_id TEXT REFERENCES facturas(id),
  tipo_comprobante    INTEGER NOT NULL, -- código AFIP: 1/6/11=Factura A/B/C · 3/8/13=NC A/B/C
  punto_venta         INTEGER NOT NULL,
  numero              INTEGER,
  cae                 TEXT,
  cae_vencimiento     TEXT,
  estado              TEXT NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente', 'autorizada', 'rechazada', 'error')),
  neto_gravado        INTEGER NOT NULL,
  iva                 INTEGER NOT NULL,
  total                INTEGER NOT NULL,
  iva_porcentaje      INTEGER NOT NULL,
  doc_tipo             INTEGER NOT NULL, -- código AFIP: 80=CUIT, 96=DNI, 99=Consumidor Final
  doc_numero          TEXT NOT NULL,
  respuesta_afip      TEXT,
  observaciones       TEXT,
  creado_en           TEXT NOT NULL DEFAULT (datetime('now')),
  autorizado_en       TEXT
);

-- Una factura por venta (la NC no cuenta: comparte venta_id con su original).
CREATE UNIQUE INDEX idx_facturas_venta
  ON facturas (negocio_id, venta_id)
  WHERE factura_original_id IS NULL;

CREATE INDEX idx_facturas_negocio ON facturas (negocio_id);
CREATE INDEX idx_facturas_original ON facturas (factura_original_id);
