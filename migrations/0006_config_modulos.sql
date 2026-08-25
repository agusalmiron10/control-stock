-- Configuración del negocio y módulos activos.
--
-- Todo lo que hace que la MISMA aplicación sirva para una fábrica de
-- herramientas, una ferretería o un kiosko vive acá, en la base — no en el
-- código. Así se despliega el mismo código a todos los clientes y cada
-- instalación se configura sola.
CREATE TABLE config (
  clave          TEXT PRIMARY KEY,
  valor          TEXT NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Valores iniciales: los de ARBELL, para que la instalación que ya está en
-- producción siga funcionando exactamente igual que antes de esta migración.
-- Un cliente nuevo los cambia desde Ajustes.
INSERT INTO config (clave, valor) VALUES
  ('negocio_nombre',    'ARBELL'),
  ('negocio_rubro',     'Herramientas — Ventas por mayor y por menor'),
  ('negocio_telefono',  '11 33288059'),
  ('negocio_instagram', '@arbellherramientas'),
  ('producto_singular', 'Herramienta'),
  ('producto_plural',   'Herramientas'),
  ('modulos', '["cuenta_corriente","produccion","presupuestos","precio_mayorista","venta_rapida","auditoria"]');
