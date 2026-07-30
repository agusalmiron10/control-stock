import { useState } from "react";
import { useEstadoSync } from "../offline/useEstadoSync";
import { sincronizarAhora } from "../offline/sync";

/** Indicador de sincronización, siempre visible y tocable. Muestra cuántas
 * ventas/pagos quedan sin subir y permite forzar el envío. */
export function SyncIndicator() {
  const estado = useEstadoSync();
  const [abierto, setAbierto] = useState(false);

  const total = estado.pendientes + estado.conflictivas;
  let etiqueta = "Todo sincronizado";
  let clase = "ok";
  if (!estado.online) { etiqueta = total > 0 ? `Sin conexión — ${total} sin subir` : "Sin conexión"; clase = "off"; }
  else if (estado.sincronizando) { etiqueta = "Sincronizando…"; clase = "sync"; }
  else if (estado.conflictivas > 0) { etiqueta = `${estado.conflictivas} con problemas`; clase = "alerta"; }
  else if (estado.pendientes > 0) { etiqueta = `${estado.pendientes} sin subir`; clase = "pendiente"; }

  return (
    <div className="sync-indicador">
      <button className={`sync-chip sync-${clase}`} onClick={() => setAbierto((v) => !v)}>
        <span className="sync-punto" /> {etiqueta}
      </button>
      {abierto && (
        <>
          <div className="sync-fondo" onClick={() => setAbierto(false)} />
          <div className="sync-panel">
            <p><b>Estado:</b> {estado.online ? "con conexión" : "sin conexión"}</p>
            <p><b>Sin subir:</b> {estado.pendientes}</p>
            {estado.conflictivas > 0 && (
              <p className="sync-conflictivas"><b>Con problemas:</b> {estado.conflictivas} — revisalas en Pendientes.</p>
            )}
            {estado.hayAtascadas && (
              <p className="sync-conflictivas">Hay operaciones esperando hace más de 24hs. Revisá la conexión.</p>
            )}
            {estado.ultimoError && <p className="mut">{estado.ultimoError}</p>}
            <button
              className="btn primario chico"
              disabled={estado.sincronizando || !estado.online}
              onClick={() => void sincronizarAhora()}
            >
              {estado.sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
