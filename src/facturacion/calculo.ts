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
export const TIPO_NOTA_DEBITO: Record<"A" | "B" | "C", TipoComprobante> = { A: 2, B: 7, C: 12 };

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

/** Los seis valores de alícuota que ARCA reconoce, en centésimas de punto. */
export const ALICUOTAS_VALIDAS: number[] = Object.keys(ALICUOTAS_AFIP).map(Number);

export function codigoAlicuota(ivaPorcentaje: number): number {
  const codigo = ALICUOTAS_AFIP[ivaPorcentaje];
  if (!codigo) {
    throw new Error(`No hay código AFIP para una alícuota de ${ivaPorcentaje / 100}%. Usá 0, 2.5, 5, 10.5, 21 o 27.`);
  }
  return codigo;
}

/**
 * Interpreta lo que alguien tipeó o pegó de un Excel como una alícuota de
 * IVA — "21", "21%", "10,5", "Exento", "0%" — a centésimas de punto. Para
 * importación masiva: nunca tira error, así un valor raro en una fila no
 * frena las otras 500. En blanco (o lo que no se entiende) da `null`, que
 * significa "no dijo nada, que use el default del negocio" — a propósito
 * distinto de `0`, que es un valor real (exento).
 */
export function parsearAlicuota(valor: unknown): number | null {
  if (valor == null) return null;
  const t = String(valor).trim().toLowerCase();
  if (t === "") return null;
  if (t === "exento" || t === "sin iva" || t === "no aplica" || t === "n/a") return 0;
  const limpio = t.replace("%", "").replace(",", ".").trim();
  const n = Number(limpio);
  if (!Number.isFinite(n)) return null;
  const centesimas = Math.round(n * 100);
  return ALICUOTAS_AFIP[centesimas] !== undefined ? centesimas : null;
}

/**
 * Back-calcula neto e IVA desde un total "todo incluido", en centavos.
 * neto = total / (1 + alícuota); iva = total - neto. Todo entero, sin floats.
 */
export function calcularNetoIva(totalCentavos: number, ivaPorcentaje: number): { neto: number; iva: number } {
  const neto = Math.round((totalCentavos * 10000) / (10000 + ivaPorcentaje));
  return { neto, iva: totalCentavos - neto };
}

export interface DesgloseAlicuota {
  ivaPorcentaje: number;
  neto: number;
  iva: number;
}

/**
 * Agrupa los renglones de una venta por alícuota de IVA y back-calcula
 * neto/IVA de cada grupo por separado — lo que hace falta para armar un
 * comprobante con IVA mixto (ARCA acepta varios <AlicIva> dentro de un
 * mismo <Iva>, uno por alícuota). Cada renglón ya viene con su subtotal
 * "todo incluido"; agrupar y ENTONCES back-calcular es lo correcto — hacerlo
 * al revés (back-calcular renglón por renglón y despuós sumar) puede
 * arrastrar redondeos distintos a los que da back-calcular sobre la suma.
 *
 * Devuelve un grupo por alícuota distinta presente, ordenados de menor a
 * mayor. Con una sola alícuota, devuelve un array de un solo elemento — el
 * llamador decide si eso alcanza para el camino "simple" o si igual conviene
 * mandarlo como desglose (da exactamente el mismo resultado).
 */
export function agruparPorAlicuota(
  renglones: { subtotal: number; ivaPorcentaje: number }[]
): DesgloseAlicuota[] {
  const subtotalPorAlicuota = new Map<number, number>();
  for (const r of renglones) {
    subtotalPorAlicuota.set(r.ivaPorcentaje, (subtotalPorAlicuota.get(r.ivaPorcentaje) ?? 0) + r.subtotal);
  }
  return [...subtotalPorAlicuota.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ivaPorcentaje, subtotal]) => ({ ivaPorcentaje, ...calcularNetoIva(subtotal, ivaPorcentaje) }));
}

/**
 * Reparte un descuento entre los renglones de una venta, proporcional al
 * peso de cada uno. Hace falta ANTES de agruparPorAlicuota(): venta_items.
 * subtotal es el precio congelado sin descuento, y agrupar sin esto
 * sobrefacturaría el neto+IVA por el monto exacto del descuento. El último
 * renglón se lleva lo que sobre del redondeo, para que la suma dé EXACTO
 * el total con descuento — ARCA valida que el desglose de IVA sume igual
 * al total del comprobante, así que un centavo de diferencia lo rechaza.
 */
export function prorratearDescuento<T extends { subtotal: number }>(
  renglones: T[],
  totalConDescuento: number
): T[] {
  const totalBruto = renglones.reduce((s, r) => s + r.subtotal, 0);
  if (renglones.length === 0 || totalBruto === totalConDescuento) return renglones;
  let acumulado = 0;
  return renglones.map((r, i) => {
    if (i === renglones.length - 1) return { ...r, subtotal: totalConDescuento - acumulado };
    const escalado = totalBruto === 0 ? 0 : Math.round((r.subtotal * totalConDescuento) / totalBruto);
    acumulado += escalado;
    return { ...r, subtotal: escalado };
  });
}

/**
 * Igual que calcularNetoIva, pero respetando la regla de ARCA para Factura C:
 * un monotributista no discrimina IVA — el comprobante entero es "neto", sin
 * desglose. Mandar el desglose igual (como si fuera A/B) hace que ARCA
 * rechace el comprobante (errores 10047/10048/10071: "el objeto IVA no debe
 * informarse" para tipo C). Por eso esto, y no calcularNetoIva a secas, es lo
 * que hay que usar en cualquier lugar donde ya se sepa la letra.
 */
export function calcularNetoIvaParaTipo(
  totalCentavos: number,
  ivaPorcentaje: number,
  letra: "A" | "B" | "C"
): { neto: number; iva: number } {
  if (letra === "C") return { neto: totalCentavos, iva: 0 };
  return calcularNetoIva(totalCentavos, ivaPorcentaje);
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

/** Códigos de Concepto de ARCA. */
export const CONCEPTO: Record<"productos" | "servicios" | "ambos", number> = {
  productos: 1,
  servicios: 2,
  ambos: 3,
};

/**
 * ¿Cuántos días para atrás y para adelante acepta ARCA fechar un
 * comprobante? Depende del concepto: los servicios tienen más ventana que
 * los productos.
 */
export function ventanaFecha(concepto: number): number {
  return concepto === 1 ? 5 : 10;
}

/**
 * La fecha con la que se va a emitir. Se prefiere la de la venta (facturar
 * el lunes una venta del lunes), pero si ya se pasó de la ventana que acepta
 * ARCA, se cae a hoy: es preferible una fecha distinta a la de la venta que
 * un comprobante rechazado.
 */
export function fechaParaEmitir(fechaVenta: string, hoy: string, concepto: number): string {
  const dias = Math.abs(
    (new Date(hoy + "T00:00:00Z").getTime() - new Date(fechaVenta + "T00:00:00Z").getTime()) / 86400000
  );
  return dias <= ventanaFecha(concepto) ? fechaVenta : hoy;
}
