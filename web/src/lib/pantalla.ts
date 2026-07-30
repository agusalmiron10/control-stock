import { useEffect, useState } from "react";

const CONSULTA = "(max-width: 640px)";

/** true si la pantalla es de tamaño celular — misma persona, mismo teléfono:
 * la "venta rápida" reemplaza al formulario de escritorio en pantallas chicas. */
export function useEsMovil(): boolean {
  const [esMovil, setEsMovil] = useState(() => window.matchMedia(CONSULTA).matches);
  useEffect(() => {
    const mq = window.matchMedia(CONSULTA);
    const on = () => setEsMovil(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return esMovil;
}
