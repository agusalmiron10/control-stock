/**
 * Puente entre la base y la función pura de imputación.
 * Carga ventas y pagos y calcula el estado de cuenta de un cliente
 * (o de todos, en batch para el panel/exportaciones).
 */
import type { Env } from "./types";
import { imputar, type VentaImput, type PagoImput, type ResultadoImputacion } from "./imputacion";

/** Ventas que cuentan como deuda activa: llegaron al servidor (sincronizada) o ya se revisaron (confirmada). */
const ESTADOS_ACTIVOS = `('sincronizada', 'confirmada')`;

/** Estado de cuenta de un cliente puntual. */
export async function estadoDeCuenta(env: Env, clienteId: string): Promise<ResultadoImputacion> {
  const ventas = await env.DB.prepare(
    `SELECT id, numero, fecha, total FROM ventas WHERE cliente_id = ? AND estado IN ${ESTADOS_ACTIVOS}`
  )
    .bind(clienteId)
    .all<VentaImput>();

  const pagos = await env.DB.prepare(
    `SELECT id, venta_id, monto FROM pagos WHERE cliente_id = ?`
  )
    .bind(clienteId)
    .all<PagoImput>();

  return imputar(ventas.results ?? [], pagos.results ?? []);
}

/**
 * Estado de cuenta de TODOS los clientes de una sola pasada.
 * Devuelve un Map<cliente_id, ResultadoImputacion>. Evita N+1 en el panel
 * y en el listado de clientes.
 */
export async function estadoDeCuentaTodos(env: Env): Promise<Map<string, ResultadoImputacion>> {
  const [ventasRes, pagosRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, numero, fecha, total, cliente_id FROM ventas WHERE estado IN ${ESTADOS_ACTIVOS}`
    ).all<VentaImput & { cliente_id: string }>(),
    
    env.DB.prepare(
      `SELECT id, venta_id, monto, cliente_id FROM pagos`
    ).all<PagoImput & { cliente_id: string }>()
  ]);

  const ventasPorCliente = new Map<string, VentaImput[]>();
  for (const v of ventasRes.results ?? []) {
    const arr = ventasPorCliente.get(v.cliente_id) ?? [];
    arr.push({ id: v.id, numero: v.numero, fecha: v.fecha, total: v.total });
    ventasPorCliente.set(v.cliente_id, arr);
  }

  const pagosPorCliente = new Map<string, PagoImput[]>();
  for (const p of pagosRes.results ?? []) {
    const arr = pagosPorCliente.get(p.cliente_id) ?? [];
    arr.push({ id: p.id, venta_id: p.venta_id, monto: p.monto });
    pagosPorCliente.set(p.cliente_id, arr);
  }

  const clientes = new Set<string>([...ventasPorCliente.keys(), ...pagosPorCliente.keys()]);
  const out = new Map<string, ResultadoImputacion>();
  for (const cid of clientes) {
    out.set(cid, imputar(ventasPorCliente.get(cid) ?? [], pagosPorCliente.get(cid) ?? []));
  }
  return out;
}
