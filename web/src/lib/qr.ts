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

/**
 * QR que exige ARCA en cada comprobante fiscal (RG 4291): una URL pública
 * con un JSON codificado en base64 como parámetro. El formato del JSON es el
 * vigente al momento de escribir esto — reconfirmar contra el manual de ARCA
 * si algo no coincide (puede haber pasado de afip.gob.ar a arca.gob.ar).
 */
export interface PayloadQrArca {
  fecha: string; // AAAA-MM-DD
  cuit: number;
  ptoVta: number;
  tipoCmp: number; // código AFIP de comprobante
  nroCmp: number;
  importe: number; // en pesos, con decimales
  moneda: "PES";
  ctz: 1;
  tipoDocRec: number;
  nroDocRec: number;
  tipoCodAut: "E"; // E = CAE
  codAut: number;
}

export function qrArcaSvg(payload: PayloadQrArca): string {
  const json = JSON.stringify({ ver: 1, ...payload });
  const url = `https://www.afip.gob.ar/fe/qr/?p=${btoa(json)}`;
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}
