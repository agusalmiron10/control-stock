import type { Env } from "./types";

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
  detalle: string | null = null
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO auditoria (negocio_id, usuario, accion, entidad, entidad_id, detalle)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(negocioId, usuario, accion, entidad, entidadId, detalle);
}
