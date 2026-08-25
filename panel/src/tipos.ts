export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

export interface Variables {
  admin: { uid: number; usuario: string };
}

export type EstadoNegocio = "prueba" | "activo" | "suspendido" | "baja";

export interface Negocio {
  id: string;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  url: string | null;
  estado: EstadoNegocio;
  notas: string | null;
  token: string;
  alta: string;
  creado_en: string;
}

export interface Reporte {
  id: number;
  negocio_id: string;
  fecha: string;
  ventas_mes: number;
  ventas_cant: number;
  clientes: number;
  productos: number;
  usuarios: number;
  ultima_venta: string | null;
  recibido_en: string;
}
