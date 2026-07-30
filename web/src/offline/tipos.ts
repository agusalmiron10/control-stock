export type EstadoOp = "pendiente" | "enviando" | "conflictiva" | "enviada";

/** Una operación encolada (venta o pago cargado sin señal). */
export interface OperacionCola {
  id: string; // = idempotency_key, minteada en el celular al crear la operación.
  tipo: "cliente" | "venta" | "pago";
  /** Body que se manda tal cual a POST /api/ventas o /api/pagos. */
  payload: Record<string, unknown>;
  estado: EstadoOp;
  intentos: number;
  ultimo_error: string | null;
  /** Si conflictiva=true, no bloquea el resto de la cola. */
  creado_en: string; // ISO, para procesar en orden FIFO.
  proximo_intento: string; // ISO — no se reintenta antes de esta hora.
}

export interface EstadoSync {
  pendientes: number;
  conflictivas: number;
  sincronizando: boolean;
  online: boolean;
  hayAtascadas: boolean; // alguna pendiente hace más de 24hs sin subir.
  ultimoError: string | null;
}
