import type { Context } from "hono";

/** Bindings del Worker (ver wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  BACKUPS: R2Bucket;
}

export type Rol = "super" | "dueño" | "empleado" | "soporte";

/**
 * "soporte" es la cuenta del proveedor del sistema dentro de un negocio:
 * necesita el mismo acceso que el dueño para poder resolver problemas. No
 * aparece en el listado de usuarios, pero todo lo que hace queda en la
 * Auditoría. "super" es el proveedor a nivel sistema: no pertenece a ningún
 * negocio y puede entrar a cualquiera.
 */
export function esDuenoOSoporte(rol: Rol): boolean {
  return rol === "dueño" || rol === "soporte" || rol === "super";
}

/** Variables que la sesión deja disponibles en el contexto de Hono. */
export interface Variables {
  usuario: {
    uid: number;
    usuario: string;
    rol: Rol;
    /**
     * Negocio al que pertenecen los datos de esta sesión. Un super admin que
     * todavía no entró a ningún negocio lo tiene en null; en ese caso sólo
     * puede usar las rutas de /api/super.
     */
     negocioId: string | null;
  };
}

/**
 * El negocio de la sesión actual. TODA consulta a datos de negocio tiene que
 * filtrar por esto — es lo único que separa a un cliente de otro.
 */
export function negocioDe(c: { get: (k: "usuario") => Variables["usuario"] }): string {
  const n = c.get("usuario").negocioId;
  if (!n) throw new Error("La sesión no tiene negocio asignado.");
  return n;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// ── Filas de la base ────────────────────────────────────────
// clientes/herramientas/ventas/pagos usan id TEXT (UUID): el celular los
// puede generar sin hablar con el servidor. venta_items/movimientos_stock/
// precios_historial/presupuestos/presupuesto_items nunca se crean offline,
// así que sus id propios siguen siendo INTEGER autoincrement de servidor.

export interface Cliente {
  id: string;
  nombre: string;
  localidad: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  latitud: number | null;
  longitud: number | null;
  activo: number;
  creado_en: string;
}

export interface Herramienta {
  id: string;
  codigo: string;
  nombre: string;
  precio: number; // minorista, centavos
  precio_mayor: number; // mayorista, centavos
  rubro: string | null;
  costo: number;
  stock: number;
  stock_minimo: number;
  notas: string | null;
  activo: number;
  creado_en: string;
}

export type EstadoVenta = "borrador" | "sincronizada" | "confirmada" | "anulada";
export type OrigenVenta = "celular" | "escritorio";

export interface Venta {
  id: string;
  numero: number;
  cliente_id: string;
  fecha: string;
  subtotal: number;
  descuento: number;
  total: number;
  nota: string | null;
  estado: EstadoVenta;
  origen: OrigenVenta;
  necesita_revision: number;
  motivo_revision: string | null;
  creado_en: string;
  sincronizado_en: string | null;
}

export interface VentaItem {
  id: number;
  venta_id: string;
  herramienta_id: string;
  nombre_herramienta: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Pago {
  id: string;
  cliente_id: string;
  venta_id: string | null;
  fecha: string;
  monto: number;
  medio: string;
  nota: string | null;
  creado_en: string;
}

export interface MovimientoStock {
  id: number;
  herramienta_id: string;
  fecha: string;
  tipo: string;
  cantidad: number;
  stock_resultante: number;
  venta_id: string | null;
  motivo: string | null;
  costo_unitario: number | null;
}

export interface PrecioHistorial {
  id: number;
  herramienta_id: string;
  fecha: string;
  precio_anterior: number;
  precio_nuevo: number;
  tipo_precio: string; // 'minorista' | 'mayorista'
  motivo: string | null;
}

export interface Presupuesto {
  id: number;
  numero: number;
  cliente_id: string;
  fecha: string;
  subtotal: number;
  descuento: number;
  total: number;
  estado: "pendiente" | "aceptado" | "rechazado" | "vencido";
  valido_hasta: string | null;
  nota: string | null;
  venta_id: string | null;
  creado_en: string;
}

export interface PresupuestoItem {
  id: number;
  presupuesto_id: number;
  herramienta_id: string;
  nombre_herramienta: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface ResumenDiario {
  id: number;
  fecha: string;
  ventas_total: number;
  ventas_cant: number;
  cobranzas_total: number;
  cobranzas_cant: number;
  saldo_pendiente: number;
  clientes_con_deuda: number;
  stock_bajo_cant: number;
  generado_en: string;
}

/** Registro de idempotencia: una fila por operación de venta/pago ya procesada. */
export interface Operacion {
  idempotency_key: string;
  tipo: "venta" | "pago";
  entidad_id: string;
  resultado: string; // JSON serializado
  creado_en: string;
}
