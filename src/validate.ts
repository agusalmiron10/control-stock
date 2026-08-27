/**
 * Validaciones livianas con mensajes en castellano.
 * Lanzan HttpError, que index.ts convierte en respuesta 400 con { error }.
 */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function texto(v: unknown, campo: string, { requerido = true, max = 500 } = {}): string | null {
  if (v == null || v === "") {
    if (requerido) throw new HttpError(400, `El campo "${campo}" es obligatorio.`);
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, `El campo "${campo}" tiene que ser texto.`);
  const t = v.trim();
  if (requerido && t === "") throw new HttpError(400, `El campo "${campo}" no puede estar vacío.`);
  if (t.length > max) throw new HttpError(400, `El campo "${campo}" es demasiado largo (máx. ${max}).`);
  return t === "" ? null : t;
}

/** Entero (por ej. centavos o cantidades). */
export function entero(
  v: unknown,
  campo: string,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {}
): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new HttpError(400, `El campo "${campo}" tiene que ser un número entero.`);
  }
  if (n < min) throw new HttpError(400, `El campo "${campo}" no puede ser menor a ${min}.`);
  if (n > max) throw new HttpError(400, `El campo "${campo}" no puede ser mayor a ${max}.`);
  return n;
}

export function decimalOpt(v: unknown, campo: string): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new HttpError(400, `El campo "${campo}" tiene que ser un número decimal válido.`);
  }
  return n;
}

export function fechaISO(v: unknown, campo: string): string {
  const t = texto(v, campo)!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    throw new HttpError(400, `El campo "${campo}" tiene que ser una fecha (AAAA-MM-DD).`);
  }
  return t;
}

export function enumerado<T extends string>(v: unknown, campo: string, opciones: readonly T[]): T {
  const t = texto(v, campo)!;
  if (!opciones.includes(t as T)) {
    throw new HttpError(400, `El campo "${campo}" debe ser uno de: ${opciones.join(", ")}.`);
  }
  return t as T;
}

export function boolOpt(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida un UUID (id minteado en el dispositivo: venta, pago, o clave de idempotencia). */
export function uuid(v: unknown, campo: string): string {
  const t = texto(v, campo, { max: 64 })!;
  if (!UUID_RE.test(t)) {
    throw new HttpError(400, `El campo "${campo}" tiene que ser un UUID válido.`);
  }
  return t.toLowerCase();
}

/** Igual que uuid(), pero opcional (para ids que el servidor puede generar si no vienen). */
export function uuidOpt(v: unknown, campo: string): string | null {
  if (v == null || v === "") return null;
  return uuid(v, campo);
}

/**
 * Normaliza para buscar: sin acentos y en minúscula.
 *
 * SQLite con COLLATE NOCASE sólo ignora mayúsculas en ASCII, no los acentos,
 * así que "perez" no encontraba a "Pérez" — y nadie escribe los acentos
 * cuando busca. Por eso el filtro por nombre se hace acá y no en el WHERE.
 */
export function normalizarBusqueda(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
