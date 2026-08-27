import { useEffect, useState } from "react";
import { api } from "../api";
import { useModulo } from "./config";

interface Estado {
  /** El módulo está prendido Y hay certificado y datos fiscales cargados. */
  listo: boolean;
  /** Qué falta, si falta algo. Se muestra tal cual en pantalla. */
  motivo: string | null;
  cargando: boolean;
}

/**
 * Que el módulo de facturación esté prendido NO quiere decir que se pueda
 * facturar: falta el certificado de ARCA hasta que el dueño lo carga. Sin
 * esto, la pantalla ofrecía "Facturar" y después moría con un error —
 * peor todavía para un empleado, que ni siquiera puede configurarlo.
 */
export function useFacturacionLista(): Estado {
  const tieneModulo = useModulo("facturacion_electronica");
  const [estado, setEstado] = useState<Estado>({ listo: false, motivo: null, cargando: true });

  useEffect(() => {
    if (!tieneModulo) {
      setEstado({ listo: false, motivo: null, cargando: false });
      return;
    }
    let vivo = true;
    api
      .get<{ listo?: boolean; motivo?: string | null }>("/api/facturacion/emisor")
      .then((r) => { if (vivo) setEstado({ listo: !!r.listo, motivo: r.motivo ?? null, cargando: false }); })
      // Sin señal no se puede saber: se asume que no, y se ofrece después.
      .catch(() => { if (vivo) setEstado({ listo: false, motivo: null, cargando: false }); });
    return () => { vivo = false; };
  }, [tieneModulo]);

  return estado;
}
