-- Precio mayorista, rubro (categoría) e historial por tipo de precio.

-- Precio de venta por mayor (centavos). El "precio" existente es el minorista.
ALTER TABLE herramientas ADD COLUMN precio_mayor INTEGER NOT NULL DEFAULT 0;

-- Rubro / categoría (Corta fierros, Masas, Grinfas, etc.).
ALTER TABLE herramientas ADD COLUMN rubro TEXT;

-- Distingue si un cambio de precio fue del minorista o del mayorista.
ALTER TABLE precios_historial ADD COLUMN tipo_precio TEXT NOT NULL DEFAULT 'minorista';

CREATE INDEX idx_herramientas_rubro ON herramientas(rubro);
