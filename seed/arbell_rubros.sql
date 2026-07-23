-- Backfill de rubros para el catálogo ARBELL ya cargado (requiere migración 0002).
-- Idempotente: se puede correr varias veces sin problema.
UPDATE herramientas SET rubro='Corta fierros' WHERE codigo LIKE 'CF-%';
UPDATE herramientas SET rubro='Masas'         WHERE codigo LIKE 'MASA-%';
UPDATE herramientas SET rubro='Clavos'        WHERE codigo LIKE 'CLAVO-%';
UPDATE herramientas SET rubro='Cucharas'      WHERE codigo LIKE 'CUCH-%';
UPDATE herramientas SET rubro='Con cabo'      WHERE codigo IN ('HACHA','HACHITA','PIQUETA','HACHUELA');
UPDATE herramientas SET rubro='Barretas'      WHERE codigo LIKE 'BARR-%' OR codigo='BARRETON-25';
UPDATE herramientas SET rubro='Ruedas'        WHERE codigo LIKE 'RUEDA-%';
UPDATE herramientas SET rubro='Tenazas'       WHERE codigo LIKE 'TEN-%';
UPDATE herramientas SET rubro='Grinfas'       WHERE codigo LIKE 'GRINFA-%';
UPDATE herramientas SET rubro='Otros'         WHERE codigo IN ('PICO','PALA-CANO','PALA-MAD','CABO-CANO','BALDE-ALB','PALA-GER');
