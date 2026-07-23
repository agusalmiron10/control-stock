import type { Context } from "hono";

/** Bindings del Worker (ver wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
}

/** Variables que la sesión deja disponibles en el contexto de Hono. */
export interface Variables {
  usuario: { uid: number; usuario: string };
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// ── Filas de la base ────────────────────────────────────────
export interface Cliente {
  id: number;
  nombre: string;
  localidad: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: number;
  creado_en: string;
}

export interface Herramienta {
  id: number;
  codigo: string;
  nombre: string;
  precio: number;
  costo: number;
  stock: number;
  stock_minimo: number;
  notas: string | null;
  activo: number;
  creado_en: string;
}

export interface Venta {
  id: number;
  numero: number;
  cliente_id: number;
  fecha: string;
  subtotal: number;
  descuento: number;
  total: number;
  nota: string | null;
  anulada: number;
  creado_en: string;
}

export interface VentaItem {
  id: number;
  venta_id: number;
  herramienta_id: number;
  nombre_herramienta: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Pago {
  id: number;
  cliente_id: number;
  venta_id: number | null;
  fecha: string;
  monto: number;
  medio: string;
  nota: string | null;
  creado_en: string;
}

export interface MovimientoStock {
  id: number;
  herramienta_id: number;
  fecha: string;
  tipo: string;
  cantidad: number;
  stock_resultante: number;
  venta_id: number | null;
  motivo: string | null;
}

export interface PrecioHistorial {
  id: number;
  herramienta_id: number;
  fecha: string;
  precio_anterior: number;
  precio_nuevo: number;
  motivo: string | null;
}
