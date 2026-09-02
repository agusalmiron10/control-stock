import type { Env, Variables } from "./types";
import type { Context } from "hono";

/** Valores de antes y después, para poder responder "de cuánto a cuánto". */
export interface Valores {
  anterior?: unknown;
  nuevo?: unknown;
}

/**
 * Prepara el INSERT de auditoría — no lo ejecuta. El caller lo suma como
 * última sentencia de su propio db.batch() atómico, junto con el cambio
 * real, para no romper el invariante de escrituras atómicas del proyecto.
 */
export function auditar(
  env: Env,
  negocioId: string,
  usuario: string,
  accion: string,
  entidad: string,
  entidadId: string | null,
  detalle: string | null = null,
  valores?: Valores,
  sesionSoporte?: string | null
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO auditoria
       (negocio_id, usuario, accion, entidad, entidad_id, detalle, valor_anterior, valor_nuevo, sesion_soporte)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    negocioId,
    usuario,
    accion,
    entidad,
    entidadId,
    detalle,
    valores?.anterior === undefined ? null : JSON.stringify(valores.anterior),
    valores?.nuevo === undefined ? null : JSON.stringify(valores.nuevo),
    sesionSoporte ?? null
  );
}

/**
 * Lo mismo, pero sacando negocio, usuario y visita de soporte del contexto.
 *
 * Esta es la forma de llamarlo: al tomar la sesión de soporte sola, cualquier
 * cambio hecho por el proveedor mientras está dentro de la cuenta de un cliente
 * queda atado a esa visita sin que el que escribe la ruta tenga que acordarse.
 */
export function auditarDe(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  accion: string,
  entidad: string,
  entidadId: string | null,
  detalle: string | null = null,
  valores?: Valores
): D1PreparedStatement {
  const u = c.get("usuario");
  return auditar(
    c.env, u.negocioId!, u.usuario, accion, entidad, entidadId, detalle, valores, u.sesionSoporte
  );
}
