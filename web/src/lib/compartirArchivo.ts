/**
 * Entregar un archivo generado en el momento (PDF, por ahora) directo a
 * WhatsApp — o a cualquier app instalada — usando el selector nativo del
 * sistema operativo (Web Share API). Es lo más cerca que se puede llegar a
 * "mandarlo solo": WhatsApp no tiene forma de recibir un archivo por link,
 * así que sin esto la única opción es descargarlo y adjuntarlo a mano.
 *
 * SIEMPRE se descarga primero, pase lo que pase después: así quien lo usa
 * tiene la certeza de que el archivo quedó guardado en el celular o la
 * computadora apenas toca el botón, en vez de depender de si el selector de
 * compartir abrió bien, si lo cerró sin querer, o si el navegador no lo
 * soporta (no es soporte parejo en todos lados — anda bien en Chrome/Safari
 * de celular, más parejo que no en escritorio). El share nativo se intenta
 * DESPUÉS, como una comodidad extra para mandarlo por WhatsApp en un toque
 * cuando el navegador lo permite — nunca en lugar de la descarga.
 */
export type ResultadoCompartir = "compartido" | "cancelado" | "descargado";

function descargar(blob: Blob, nombreArchivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function compartirArchivo(
  blob: Blob,
  nombreArchivo: string,
  opciones: { titulo?: string; texto?: string } = {}
): Promise<ResultadoCompartir> {
  descargar(blob, nombreArchivo);

  const file = new File([blob], nombreArchivo, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opciones.titulo, text: opciones.texto });
      return "compartido";
    } catch (err: any) {
      // AbortError = la persona cerró el selector sin elegir nada: no es un
      // error — el archivo ya se descargó igual, así que no hay nada más
      // que hacer.
      if (err?.name === "AbortError") return "cancelado";
      // Cualquier otro problema real del selector: no importa, ya se descargó.
    }
  }

  return "descargado";
}

/** Texto para mostrar en un aviso después de compartirArchivo(): el archivo
 *  ya se descargó siempre, esto sólo aclara qué pasó con el selector. */
export function mensajeCompartir(resultado: ResultadoCompartir): string {
  if (resultado === "compartido") return "PDF descargado y compartido.";
  if (resultado === "cancelado") return "PDF descargado — no elegiste nada en el selector para compartir, pero ya lo tenés guardado.";
  return "PDF descargado — este navegador no puede compartir el archivo directo, adjuntalo a mano en WhatsApp.";
}
