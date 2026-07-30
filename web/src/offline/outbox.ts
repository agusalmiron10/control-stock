import { STORE_OUTBOX, obtenerTodos, put, eliminar } from "./db";
import type { OperacionCola } from "./tipos";

/** Encola una operación. El id (idempotency_key) lo pone quien llama — así una
 * venta creada offline ya tiene identidad permanente antes de tocar la red. */
export async function encolar(op: Omit<OperacionCola, "estado" | "intentos" | "ultimo_error" | "proximo_intento">): Promise<void> {
  const completa: OperacionCola = {
    ...op,
    estado: "pendiente",
    intentos: 0,
    ultimo_error: null,
    proximo_intento: op.creado_en,
  };
  await put(STORE_OUTBOX, completa);
}

export async function listarCola(): Promise<OperacionCola[]> {
  const todas = await obtenerTodos<OperacionCola>(STORE_OUTBOX);
  return todas.sort((a, b) => a.creado_en.localeCompare(b.creado_en));
}

export async function actualizarOp(op: OperacionCola): Promise<void> {
  await put(STORE_OUTBOX, op);
}

export async function quitarOp(id: string): Promise<void> {
  await eliminar(STORE_OUTBOX, id);
}
