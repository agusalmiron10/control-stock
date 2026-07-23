/**
 * Imputación de pagos a ventas (cuenta corriente).
 *
 * ÚNICA fuente de verdad del reparto. No se persiste ninguna asignación:
 * dado el conjunto de ventas (no anuladas) y pagos de un cliente, esta función
 * pura calcula, de forma determinística, cuánto quedó pagado en cada venta,
 * el saldo del cliente y el saldo a favor.
 *
 * Reglas:
 *  1. Se ordenan las ventas FIFO: por fecha ascendente, y a igual fecha por número.
 *  2. Los pagos DIRECTOS (con venta_id) se aplican primero a su venta.
 *     El excedente de un pago directo cae al "pozo a cuenta".
 *  3. Los pagos A CUENTA (venta_id null) + los excedentes forman el pozo,
 *     que se reparte FIFO tapando el saldo pendiente de cada venta.
 *  4. Lo que sobra del pozo es saldo a favor (crédito).
 *
 * Todos los montos en centavos (enteros).
 */

export interface VentaImput {
  id: number;
  numero: number;
  fecha: string; // ISO YYYY-MM-DD
  total: number; // centavos
}

export interface PagoImput {
  id: number;
  venta_id: number | null;
  monto: number; // centavos
}

export type EstadoVenta = "pagada" | "parcial" | "impaga";

export interface VentaResultado {
  id: number;
  numero: number;
  total: number;
  pagado: number;
  saldo: number; // total - pagado (>= 0)
  estado: EstadoVenta;
}

export interface ResultadoImputacion {
  porVenta: Map<number, VentaResultado>;
  /** Suma de totales de ventas − suma de todos los pagos. Positivo = debe, negativo = a favor. */
  saldoCliente: number;
  /** Crédito sin aplicar (>= 0). */
  saldoAFavor: number;
  totalVentas: number;
  totalPagado: number;
}

function estadoDe(total: number, pagado: number): EstadoVenta {
  if (pagado >= total) return "pagada";
  if (pagado > 0) return "parcial";
  return "impaga";
}

/**
 * Ordena las ventas FIFO: fecha asc, luego número asc. No muta el arreglo original.
 */
function ordenarFIFO(ventas: VentaImput[]): VentaImput[] {
  return [...ventas].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    return a.numero - b.numero;
  });
}

export function imputar(
  ventas: VentaImput[],
  pagos: PagoImput[]
): ResultadoImputacion {
  const ordenadas = ordenarFIFO(ventas);

  // Estado de pago por venta.
  const pagado = new Map<number, number>();
  for (const v of ordenadas) pagado.set(v.id, 0);

  // Índice rápido total por venta (para topear el excedente de pagos directos).
  const totalPorVenta = new Map<number, number>();
  for (const v of ordenadas) totalPorVenta.set(v.id, v.total);

  let pozo = 0; // pagos a cuenta + excedentes de pagos directos

  // Paso 2: pagos directos.
  for (const p of pagos) {
    if (p.venta_id != null && pagado.has(p.venta_id)) {
      const totalV = totalPorVenta.get(p.venta_id)!;
      const yaPagado = pagado.get(p.venta_id)!;
      const espacio = Math.max(0, totalV - yaPagado);
      const aplica = Math.min(espacio, p.monto);
      pagado.set(p.venta_id, yaPagado + aplica);
      pozo += p.monto - aplica; // excedente al pozo
    } else {
      // Pago a cuenta (o dirigido a una venta anulada/inexistente → a cuenta).
      pozo += p.monto;
    }
  }

  // Paso 3: reparto FIFO del pozo.
  for (const v of ordenadas) {
    if (pozo <= 0) break;
    const yaPagado = pagado.get(v.id)!;
    const pendiente = Math.max(0, v.total - yaPagado);
    if (pendiente <= 0) continue;
    const aplica = Math.min(pendiente, pozo);
    pagado.set(v.id, yaPagado + aplica);
    pozo -= aplica;
  }

  // Resultado por venta.
  const porVenta = new Map<number, VentaResultado>();
  let totalVentas = 0;
  for (const v of ordenadas) {
    const pg = pagado.get(v.id)!;
    totalVentas += v.total;
    porVenta.set(v.id, {
      id: v.id,
      numero: v.numero,
      total: v.total,
      pagado: pg,
      saldo: Math.max(0, v.total - pg),
      estado: estadoDe(v.total, pg),
    });
  }

  const totalPagado = pagos.reduce((acc, p) => acc + p.monto, 0);
  const saldoCliente = totalVentas - totalPagado; // + debe / − a favor
  const saldoAFavor = pozo; // lo que sobró del reparto

  return { porVenta, saldoCliente, saldoAFavor, totalVentas, totalPagado };
}
