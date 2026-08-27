/**
 * Funciones puras de facturación: back-cálculo neto/IVA (los precios del
 * sistema son "todo incluido", ARCA quiere el desglose), inferencia del tipo
 * de comprobante y códigos de documento/alícuota que exige WSFE. Sin red,
 * testeables solas — ver test/facturacion-calculo.test.ts.
 */
import type { CondicionIva, Cliente, TipoComprobante } from "../types";

/** Códigos AFIP de tipo de comprobante: factura y su Nota de Crédito, por letra. */
export const TIPO_FACTURA: Record<"A" | "B" | "C", TipoComprobante> = { A: 1, B: 6, C: 11 };
export const TIPO_NOTA_CREDITO: Record<"A" | "B" | "C", TipoComprobante> = { A: 3, B: 8, C: 13 };

/** Código AFIP de documento: 80=CUIT, 96=DNI, 99=Consumidor Final (sin identificar). */
export function codigoDocumento(cliente: Pick<Cliente, "doc_tipo" | "doc_numero">): { tipo: number; numero: string } {
  if (cliente.doc_tipo === "CUIT" && cliente.doc_numero) return { tipo: 80, numero: cliente.doc_numero };
  if (cliente.doc_tipo === "DNI" && cliente.doc_numero) return { tipo: 96, numero: cliente.doc_numero };
  return { tipo: 99, numero: "0" };
}

/** Código AFIP de alícuota de IVA a partir del % en centésimas (2100 = 21,00%). */
const ALICUOTAS_AFIP: Record<number, number> = {
  0: 3, // 0%
  250: 9, // 2,5%
  500: 8, // 5%
  1050: 4, // 10,5%
  2100: 5, // 21%
  2700: 6, // 27%
};

export function codigoAlicuota(ivaPorcentaje: number): number {
  const codigo = ALICUOTAS_AFIP[ivaPorcentaje];
  if (!codigo) {
    throw new Error(`No hay código AFIP para una alícuota de ${ivaPorcentaje / 100}%. Usá 0, 2.5, 5, 10.5, 21 o 27.`);
  }
  return codigo;
}

/**
 * Back-calcula neto e IVA desde un total "todo incluido", en centavos.
 * neto = total / (1 + alícuota); iva = total - neto. Todo entero, sin floats.
 */
export function calcularNetoIva(totalCentavos: number, ivaPorcentaje: number): { neto: number; iva: number } {
  const neto = Math.round((totalCentavos * 10000) / (10000 + ivaPorcentaje));
  return { neto, iva: totalCentavos - neto };
}

/**
 * A qué letra de comprobante corresponde, según la condición del negocio
 * (emisor) y la del cliente (receptor). El usuario puede overridear la
 * sugerencia al emitir — esto es sólo el default razonable.
 *   - Monotributo: siempre C (no importa el cliente).
 *   - Responsable Inscripto: A si el cliente es RI con CUIT cargado, B si no.
 *   - Exento: B por defecto (no suele emitir A).
 */
export function inferirTipoComprobante(
  condicionNegocio: CondicionIva,
  cliente: Pick<Cliente, "condicion_iva" | "doc_tipo" | "doc_numero">
): "A" | "B" | "C" {
  if (condicionNegocio === "monotributo") return "C";
  const clienteEsRIConCuit = cliente.condicion_iva === "responsable_inscripto" && cliente.doc_tipo === "CUIT" && !!cliente.doc_numero;
  return clienteEsRIConCuit ? "A" : "B";
}

/** Factura A exige CUIT del cliente cargado — se valida antes de llamar a ARCA. */
export function validarDocumentoParaTipo(tipo: "A" | "B" | "C", cliente: Pick<Cliente, "doc_tipo" | "doc_numero">): void {
  if (tipo === "A" && (cliente.doc_tipo !== "CUIT" || !cliente.doc_numero)) {
    throw new Error("Para Factura A el cliente necesita tener un CUIT cargado.");
  }
}
