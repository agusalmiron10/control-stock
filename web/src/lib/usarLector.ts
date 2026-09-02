import { useEffect, useRef } from "react";
import { ESTADO_INICIAL, procesarTecla, type EstadoLector } from "./lectorCodigoBarras";

/** ¿El foco está en algo donde la persona está escribiendo? */
function focoEditable(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Escucha el lector de código de barras en toda la pantalla.
 *
 * REGLA DE ORO PARA NO ROMPER NADA: si el foco está en un campo de texto, este
 * hook no hace absolutamente nada. Si el cajero está escribiendo un precio o
 * una nota, sus teclas son suyas.
 *
 * ¿Y entonces cómo se escanea mientras se completa la venta? El POS tiene un
 * campo de escaneo que maneja su propio Enter (ver BarraEscaneo). Ese campo
 * cubre el caso normal —el foco vive ahí— y este hook cubre el otro: cuando el
 * cajero tocó un botón y el foco quedó en cualquier lado, pasa un producto y
 * igual se carga.
 *
 * No hace falta hacer preventDefault de los dígitos: si el foco no está en un
 * campo, esas teclas no escriben en ningún lado. Sí se frena el Enter final,
 * que si no le pegaría un segundo click al botón que tenga el foco.
 */
export function useLectorDeCodigos(alLeer: (codigo: string) => void, activo = true) {
  const estado = useRef<EstadoLector>(ESTADO_INICIAL);
  // Guardado en ref para no tener que re-suscribir el listener en cada render.
  const cb = useRef(alLeer);
  cb.current = alLeer;

  useEffect(() => {
    if (!activo) return;
    function alTeclear(e: KeyboardEvent) {
      if (focoEditable()) { estado.current = ESTADO_INICIAL; return; }
      const r = procesarTecla(estado.current, e.key, e.timeStamp || performance.now());
      estado.current = r.estado;
      if (r.codigo) {
        e.preventDefault();
        cb.current(r.codigo);
      }
    }
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [activo]);
}
