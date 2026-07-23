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
