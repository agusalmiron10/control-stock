-- Limpieza de deuda técnica: el modelo "un certificado por negocio" (migración
-- 0008) quedó reemplazado por la delegación a un certificado único del
-- proveedor (migración 0015). Estas columnas de facturacion_config no las lee
-- ni las escribe ningún código desde entonces — se confirmó con una búsqueda
-- en todo src/ antes de esta migración. src/facturacion/certificados.ts (el
-- cifrado AES-GCM de la clave privada por negocio) se borra en el mismo
-- cambio que esta migración, y con él el secret CERT_ENC_KEY deja de usarse
-- en el código (el secret en sí puede quedar cargado en Cloudflare sin
-- problema, simplemente ya no lo lee nadie).
ALTER TABLE facturacion_config DROP COLUMN cert_pem;
ALTER TABLE facturacion_config DROP COLUMN clave_privada_enc;
ALTER TABLE facturacion_config DROP COLUMN clave_privada_iv;
ALTER TABLE facturacion_config DROP COLUMN cert_subido_en;
-- Estas tres eran el cache de WSAA por negocio, de antes de que el ticket de
-- acceso pasara a ser global por ambiente (ver arca_proveedor, migración
-- 0015). Mismo caso: sin lectores desde esa migración.
ALTER TABLE facturacion_config DROP COLUMN wsaa_token;
ALTER TABLE facturacion_config DROP COLUMN wsaa_sign;
ALTER TABLE facturacion_config DROP COLUMN wsaa_expira_en;
