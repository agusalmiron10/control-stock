// Motor de sincronización: procesa la cola en orden (FIFO), respeta
// dependencias (una venta se manda antes que un pago que la referencia
// porque se encoló antes), reintenta con backoff exponencial ante fallas de
// red, y marca "conflictiva" (sin frenar el resto de la cola) ante un
// rechazo del servidor que no es de conectividad.
//
// Deliberadamente NO usa la Background Sync API: no existe en iOS Safari,
// que es donde se usa esta app en la calle. En cambio dispara sync al
// volver la conexión, al volver a primer plano, después de encolar (si hay
// red) y con el botón manual.
import { api, ApiError } from "../api";
import { listarCola, actualizarOp, quitarOp, encolar } from "./outbox";
import type { OperacionCola, EstadoSync } from "./tipos";

const URL_POR_TIPO: Record<OperacionCola["tipo"], string> = {
  cliente: "/api/clientes",
  venta: "/api/ventas",
  pago: "/api/pagos",
};

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_TOPE_MS = 10 * 60 * 1000;
const UMBRAL_ATASCADA_MS = 24 * 60 * 60 * 1000;

let procesando = false;
let temporizador: ReturnType<typeof setTimeout> | null = null;
const oyentes = new Set<(e: EstadoSync) => void>();
let ultimoError: string | null = null;

function backoffMs(intentos: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** intentos, BACKOFF_TOPE_MS);
}

/** Manda un id ya minteado por el cliente como idempotency_key y como id de la fila. */
function conIdentidad(payload: Record<string, unknown>, id: string): Record<string, unknown> {
  return { ...payload, id: payload.id ?? id, idempotency_key: id };
}

async function enviarUna(op: OperacionCola): Promise<"ok" | "conflictiva" | "red"> {
  try {
    await api.post(URL_POR_TIPO[op.tipo], conIdentidad(op.payload, op.id));
    return "ok";
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      return "conflictiva";
    }
    return "red";
  }
}

/** Recorre la cola en orden. Corta en el primer fallo de red (no tiene
 * sentido seguir probando si no hay conexión) pero las conflictivas se
 * saltan sin frenar nada. */
export async function procesarCola(): Promise<void> {
  if (procesando) return;
  procesando = true;
  notificar();
  try {
    if (!navigator.onLine) return;
    const cola = await listarCola();
    const ahora = new Date();
    for (const op of cola) {
      if (op.estado === "conflictiva") continue;
      if (new Date(op.proximo_intento) > ahora) break; // respeta el orden: no salta adelante.

      const resultado = await enviarUna(op);
      if (resultado === "ok") {
        await quitarOp(op.id);
        ultimoError = null;
      } else if (resultado === "conflictiva") {
        await actualizarOp({ ...op, estado: "conflictiva", intentos: op.intentos + 1 });
      } else {
        const intentos = op.intentos + 1;
        await actualizarOp({
          ...op,
          estado: "pendiente",
          intentos,
          ultimo_error: "Sin conexión o el servidor no respondió.",
          proximo_intento: new Date(Date.now() + backoffMs(intentos)).toISOString(),
        });
        ultimoError = "Sin conexión o el servidor no respondió.";
        programarReintento(backoffMs(intentos));
        break;
      }
    }
  } finally {
    procesando = false;
    notificar();
  }
}

function programarReintento(ms: number): void {
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => { void procesarCola(); }, ms);
}

/** Registra una operación y, si hay red, intenta mandarla ya mismo. */
export async function encolarOperacion(tipo: OperacionCola["tipo"], id: string, payload: Record<string, unknown>): Promise<void> {
  await encolar({ id, tipo, payload, creado_en: new Date().toISOString() });
  notificar();
  if (navigator.onLine) void procesarCola();
}

export async function calcularEstado(): Promise<EstadoSync> {
  const cola = await listarCola();
  const pendientes = cola.filter((o) => o.estado === "pendiente").length;
  const conflictivas = cola.filter((o) => o.estado === "conflictiva").length;
  const ahora = Date.now();
  const hayAtascadas = cola.some(
    (o) => o.estado === "pendiente" && ahora - new Date(o.creado_en).getTime() > UMBRAL_ATASCADA_MS
  );
  return {
    pendientes,
    conflictivas,
    sincronizando: procesando,
    online: navigator.onLine,
    hayAtascadas,
    ultimoError,
  };
}

function notificar(): void {
  calcularEstado().then((e) => oyentes.forEach((fn) => fn(e)));
}

export function suscribirseAEstado(fn: (e: EstadoSync) => void): () => void {
  oyentes.add(fn);
  notificar();
  return () => oyentes.delete(fn);
}

let iniciado = false;

/** Se llama una vez al arrancar la app: pide almacenamiento persistente y
 * conecta los disparadores de sync (online, volver a primer plano). */
export function iniciarSync(): void {
  if (iniciado) return;
  iniciado = true;

  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

  window.addEventListener("online", () => void procesarCola());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void procesarCola();
  });

  void procesarCola();
}

export function sincronizarAhora(): Promise<void> {
  return procesarCola();
}

/** Solo para tests: cancela cualquier reintento con backoff pendiente, para
 * no dejar un setTimeout real colgado entre casos de prueba. */
export function _detenerTemporizador(): void {
  if (temporizador) {
    clearTimeout(temporizador);
    temporizador = null;
  }
}
