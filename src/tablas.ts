/**
 * Qué entra en el respaldo de un negocio, en qué orden, y qué se deja afuera.
 *
 * ESTA ES LA ÚNICA LISTA. Antes había dos copias escritas a mano (una en la
 * descarga manual y otra en el backup nocturno) y las dos quedaron viejas: se
 * escribieron cuando el sistema tenía diez tablas y nadie las tocó al agregar
 * facturación, compras y remitos. Resultado: durante meses el respaldo que se
 * descargaba NO tenía las facturas ni los remitos, y nadie se enteraba porque
 * el archivo se bajaba igual.
 *
 * Para que no vuelva a pasar, scripts/auditar-aislamiento.mjs corta el deploy
 * si aparece una tabla de negocio que no esté declarada acá — ni en la lista
 * de respaldo ni en la de exclusiones.
 *
 * EL ORDEN IMPORTA: se inserta de arriba hacia abajo y se borra al revés, así
 * que cada tabla tiene que ir después de aquellas a las que apunta.
 */

export interface TablaRespaldo {
  nombre: string;
  /**
   * Columnas que NO se exportan. Se usa para secretos: un respaldo es un
   * archivo que el ferretero baja a su computadora y manda por mail.
   */
  omitir?: string[];
  /**
   * Filas que tienen que insertarse primero (las que se apuntan a sí mismas).
   */
  primero?: (fila: Record<string, unknown>) => boolean;
}

export const TABLAS_RESPALDO: TablaRespaldo[] = [
  { nombre: "clientes" },
  { nombre: "herramientas" },
  { nombre: "proveedores" },
  { nombre: "ventas" },
  { nombre: "venta_items" },
  { nombre: "pagos" },
  { nombre: "compras" },
  { nombre: "compra_items" },
  { nombre: "movimientos_stock" },
  { nombre: "precios_historial" },
  { nombre: "presupuestos" },
  { nombre: "presupuesto_items" },
  {
    nombre: "facturacion_config",
    // El certificado, la clave privada y el token de sesión de ARCA no salen
    // de la base por ningún motivo. El CUIT y el punto de venta sí, que es lo
    // que hace falta para volver a configurar.
    omitir: ["cert_pem", "clave_privada_enc", "clave_privada_iv", "wsaa_token", "wsaa_sign", "wsaa_expira_en"],
  },
  {
    nombre: "facturas",
    // Una Nota de Crédito apunta a la factura que anula: las originales
    // primero, si no la clave foránea rebota.
    primero: (f) => f.factura_original_id == null,
  },
  { nombre: "remitos" },
  { nombre: "remito_items" },
  { nombre: "resumenes_diarios" },
  { nombre: "config" },
  { nombre: "operaciones" },
  { nombre: "auditoria" },
];

/**
 * Tablas de negocio que a propósito NO van al respaldo, con el motivo.
 * Sacar algo de acá sin pensarlo es cómo se filtra información.
 */
export const FUERA_DEL_RESPALDO: Record<string, string> = {
  usuarios:
    "guarda los hash de las contraseñas: no puede viajar en un archivo que se baja y se manda por mail",
};

export const NOMBRES_RESPALDO = TABLAS_RESPALDO.map((t) => t.nombre);

/** Saca del registro las columnas que no se exportan. */
export function filtrarColumnas(fila: Record<string, unknown>, omitir?: string[]): Record<string, unknown> {
  if (!omitir?.length) return fila;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fila)) if (!omitir.includes(k)) out[k] = v;
  return out;
}
