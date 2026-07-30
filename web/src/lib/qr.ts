import qrcode from "qrcode-generator";

// Prefijo para no confundir el QR de un cliente con cualquier otro texto
// que alguien pueda escanear por error. No es un link ni apunta a nada de
// la app — es sólo un identificador para seleccionar el cliente offline.
const PREFIJO = "cliente:";

/** SVG del QR de un cliente — sólo codifica su id, nada de red hace falta para leerlo. */
export function qrClienteSvg(clienteId: string): string {
  const qr = qrcode(0, "M");
  qr.addData(PREFIJO + clienteId);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}

/** Si el texto leído por la cámara es un QR de cliente, devuelve el id; si no, null. */
export function idDeClienteDesdeQr(texto: string): string | null {
  return texto.startsWith(PREFIJO) ? texto.slice(PREFIJO.length) : null;
}
