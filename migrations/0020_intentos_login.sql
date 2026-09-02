-- Rate limiting del login, persistente.
--
-- Antes vivía en un Map() en memoria del isolate: Cloudflare recicla
-- isolates todo el tiempo y corre varios en paralelo para el mismo Worker,
-- así que el contador se reiniciaba solo. El límite existía en el código
-- pero no bloqueaba a nadie de verdad.

CREATE TABLE intentos_login (
  clave      TEXT PRIMARY KEY,  -- 'ip:<ip>' o 'u:<usuario>'
  intentos   INTEGER NOT NULL DEFAULT 0,
  ultimo_en  TEXT NOT NULL DEFAULT (datetime('now'))
);
