/**
 * Contadores técnicos que son GLOBALES a propósito, no por negocio.
 *
 * presupuestos.id es un PRIMARY KEY AUTOINCREMENT compartido por todos los
 * negocios — no hay (ni tiene que haber) una secuencia de id por negocio,
 * a diferencia de "numero", que sí es visible al cliente y sí es por
 * negocio (UNIQUE (negocio_id, numero)). Por eso esta consulta NO filtra
 * por negocio_id A PROPÓSITO: id acá es un contador técnico interno, no un
 * dato de negocio — filtrar por negocio_id daría el id más alto DE ESE
 * NEGOCIO, que puede ya estar usado por otro, y el INSERT rompería contra
 * la clave primaria (pasó de verdad: un negocio sin presupuestos previos
 * chocaba contra el id ya tomado por otro negocio que sí tenía).
 */
import type { Env } from "./types";

export async function proximoIdPresupuesto(env: Env): Promise<number> {
  const row = await env.DB.prepare(`SELECT COALESCE(MAX(id), 0) AS mid FROM presupuestos`).first<{ mid: number }>();
  return (row?.mid ?? 0) + 1;
}
