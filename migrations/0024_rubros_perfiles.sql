-- Rubros y perfiles de configuración: que el MISMO sistema sirva para una
-- ferretería, un kiosko, una casa de ropa o una verdulería sin duplicar nada
-- ni tocar código para sumar un rubro nuevo.
--
-- La regla que ordena todo esto: el código NUNCA pregunta por el rubro.
-- Pregunta por una CAPACIDAD (permite_variantes, venta_fraccionada…). El
-- rubro sólo sirve para resolver qué capacidades tiene la cuenta. Sumar un
-- rubro es insertar una fila acá, no un deploy.
--
-- Dos capas, con dueños distintos y a propósito separadas:
--   · config.modulos (ya existía) → QUÉ FUNCIONES tiene contratadas el
--     negocio. Lo decide el proveedor: es lo que se vende. El rubro NO lo
--     toca, para que nadie se autohabilite algo que no le vendieron.
--   · capacidades (esto)          → CÓMO SE COMPORTA el sistema para ese
--     rubro. Lo elige la cuenta. No es palanca comercial, es forma del dato.
--
-- Nota sobre idempotencia: las tablas y los seeds sí lo son (IF NOT EXISTS /
-- INSERT OR IGNORE / UPDATE ... WHERE IS NULL). Los ALTER TABLE ADD COLUMN
-- no pueden serlo en SQLite (no existe IF NOT EXISTS para columnas); de eso
-- se encarga el registro de migraciones, que no corre dos veces la misma.

-- ── 1. Perfiles: el comportamiento ──────────────────────────
CREATE TABLE IF NOT EXISTS perfiles_config (
  id               TEXT PRIMARY KEY,
  nombre           TEXT NOT NULL,
  -- JSON con las capacidades. Las claves desconocidas se ignoran al leer y
  -- las de tipo equivocado caen al default: una fila mal cargada a mano no
  -- puede romper la aplicación.
  capacidades_json TEXT NOT NULL,
  creado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── 2. Rubros: los nombres que ve el usuario ────────────────
-- Varios rubros pueden apuntar al mismo perfil (kiosko, bazar y librería se
-- comportan igual; lo único que cambia es cómo se llama a sí mismo el que
-- lo elige).
CREATE TABLE IF NOT EXISTS rubros (
  id        TEXT PRIMARY KEY,
  nombre    TEXT NOT NULL,
  icono     TEXT,
  perfil_id TEXT NOT NULL REFERENCES perfiles_config(id),
  orden     INTEGER NOT NULL DEFAULT 100,
  activo    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rubros_activo ON rubros (activo, orden);

-- ── 3. La cuenta ────────────────────────────────────────────
ALTER TABLE negocios ADD COLUMN rubro_id             TEXT REFERENCES rubros(id);
-- Texto libre de quien eligió "Otro". Sirve para detectar qué rubros conviene
-- agregar formalmente después.
ALTER TABLE negocios ADD COLUMN rubro_otro_texto     TEXT;
-- Ajustes finos de ESTA cuenta, que le ganan al perfil. Es lo que permite que
-- una cuenta se salga del molde de su rubro sin inventarle un perfil propio.
ALTER TABLE negocios ADD COLUMN config_override_json TEXT;
ALTER TABLE negocios ADD COLUMN rubro_configurado_en TEXT;

-- ── 4. Seed de perfiles ─────────────────────────────────────
-- Todo lo que no se declara acá cae al default seguro de src/config.ts.
-- producto_singular/plural son la "etiqueta_producto": se reusa el
-- vocabulario que el sistema ya tenía en vez de inventar un campo nuevo.
INSERT OR IGNORE INTO perfiles_config (id, nombre, capacidades_json) VALUES
  ('catalogo_simple', 'Catálogo simple', json_object(
    'producto_singular', 'Producto',
    'producto_plural',   'Productos',
    'unidad_default',    'unidad'
  )),

  ('ferreteria', 'Ferretería', json_object(
    'producto_singular',       'Artículo',
    'producto_plural',         'Artículos',
    'unidad_default',          'unidad',
    'campos_extra_producto',   json_array('marca', 'medida'),
    'categorias_sugeridas',    json_array(
      'Herramientas manuales', 'Ferretería general', 'Electricidad',
      'Tornillería', 'Pinturería', 'Plomería', 'Construcción',
      'Máquinas y accesorios'
    )
  )),

  -- Fabrica lo que vende. Existe porque ARBELL es esto, no una ferretería:
  -- su vocabulario propio es "Herramienta" y su stock sube por producción.
  ('fabrica', 'Fábrica / taller', json_object(
    'producto_singular',     'Herramienta',
    'producto_plural',       'Herramientas',
    'unidad_default',        'unidad',
    'campos_extra_producto', json_array('marca', 'medida')
  )),

  ('indumentaria', 'Indumentaria', json_object(
    'producto_singular', 'Prenda',
    'producto_plural',   'Prendas',
    'unidad_default',    'unidad',
    'permite_variantes', json('true'),
    'tipos_variante',    json_array('talle', 'color')
  )),

  ('perecederos', 'Perecederos', json_object(
    'producto_singular',        'Producto',
    'producto_plural',          'Productos',
    'unidad_default',           'unidad',
    'permite_vencimientos',     json('true'),
    'alerta_dias_antes_vencer', 30
  )),

  ('granel', 'Venta a granel', json_object(
    'producto_singular',  'Producto',
    'producto_plural',    'Productos',
    'unidad_default',     'kg',
    'venta_fraccionada',  json('true')
  )),

  ('construccion', 'Corralón / materiales', json_object(
    'producto_singular',     'Material',
    'producto_plural',       'Materiales',
    'unidad_default',        'unidad',
    'venta_fraccionada',     json('true'),
    'precios_por_escala',    json('true'),
    'campos_extra_producto', json_array('medida')
  )),

  ('serializados', 'Con número de serie', json_object(
    'producto_singular',      'Producto',
    'producto_plural',        'Productos',
    'unidad_default',         'unidad',
    'requiere_numero_serie',  json('true'),
    'campos_extra_producto',  json_array('marca', 'modelo')
  )),

  ('mayorista', 'Mayorista', json_object(
    'producto_singular',  'Producto',
    'producto_plural',    'Productos',
    'unidad_default',     'unidad',
    'precios_por_escala', json('true')
  ));

-- ── 5. Seed de rubros ───────────────────────────────────────
INSERT OR IGNORE INTO rubros (id, nombre, icono, perfil_id, orden) VALUES
  ('ferreteria',      'Ferretería',              '🔧', 'ferreteria',      10),
  ('corralon',        'Corralón / materiales',   '🧱', 'construccion',    20),
  ('fabrica',         'Fábrica / taller',        '🏭', 'fabrica',         30),
  ('kiosko',          'Kiosko / maxikiosko',     '🍬', 'catalogo_simple', 40),
  ('almacen',         'Almacén / despensa',      '🥫', 'granel',          50),
  ('autoservicio',    'Autoservicio',            '🛒', 'granel',          60),
  ('verduleria',      'Verdulería',              '🥬', 'granel',          70),
  ('indumentaria',    'Indumentaria',            '👕', 'indumentaria',    80),
  ('calzado',         'Calzado',                 '👟', 'indumentaria',    90),
  ('deportes',        'Artículos deportivos',    '⚽', 'indumentaria',   100),
  ('farmacia',        'Farmacia',                '💊', 'perecederos',    110),
  ('perfumeria',      'Perfumería',              '💄', 'perecederos',    120),
  ('veterinaria',     'Veterinaria',             '🐾', 'perecederos',    130),
  ('dietetica',       'Dietética',               '🌿', 'perecederos',    140),
  ('electrodomest',   'Electrodomésticos',       '🔌', 'serializados',   150),
  ('electronica',     'Electrónica',             '📱', 'serializados',   160),
  ('celulares',       'Celulares y accesorios',  '📞', 'serializados',   170),
  ('repuestos',       'Repuestos',               '⚙️', 'serializados',   180),
  ('distribuidora',   'Distribuidora',           '🚚', 'mayorista',      190),
  ('mayorista',       'Mayorista',               '📦', 'mayorista',      200),
  ('bazar',           'Bazar',                   '🍽️', 'catalogo_simple', 210),
  ('libreria',        'Librería',                '📚', 'catalogo_simple', 220),
  ('jugueteria',      'Juguetería',              '🧸', 'catalogo_simple', 230),
  ('regaleria',       'Regalería',               '🎁', 'catalogo_simple', 240),
  ('papeleria',       'Papelería',               '📄', 'catalogo_simple', 250),
  -- Siempre último: el que no se encuentra en la lista escribe lo suyo.
  ('otro',            'Otro',                    '➕', 'catalogo_simple', 999);

-- ── 6. Campos extra por producto ────────────────────────────
-- Una sola columna JSON en vez de una columna por campo: así "marca" y
-- "medida" (o lo que pida un rubro futuro) no necesitan otra migración.
ALTER TABLE herramientas ADD COLUMN datos_extra TEXT;

-- ── 7. Las cuentas que ya existen ───────────────────────────
-- Todas son del palo ferretero y vienen funcionando: NO tienen que ver la
-- pantalla de selección ni cambiar de comportamiento en nada.
--
-- El override les pinea el vocabulario que YA tienen. Sin esto, el perfil
-- podría renombrarles los productos en silencio (a ARBELL, "Herramienta"
-- pasaría a "Artículo") — justo lo que no puede pasar.
UPDATE negocios
   SET rubro_id = CASE
         -- ARBELL fabrica lo que vende: su rubro real es fábrica/taller.
         WHEN codigo = 'arbell' THEN 'fabrica'
         ELSE 'ferreteria'
       END,
       rubro_configurado_en = datetime('now'),
       config_override_json = json_object(
         'producto_singular', COALESCE(
           (SELECT valor FROM config WHERE negocio_id = negocios.id AND clave = 'producto_singular'),
           'Producto'
         ),
         'producto_plural', COALESCE(
           (SELECT valor FROM config WHERE negocio_id = negocios.id AND clave = 'producto_plural'),
           'Productos'
         )
       )
 WHERE rubro_id IS NULL;
