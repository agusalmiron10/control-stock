// Formateo argentino: $ 125.400,50 y fechas dd/mm/aaaa. La base guarda centavos.

const fmtPesos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
});

const fmtNum = new Intl.NumberFormat("es-AR");

/** Centavos (entero) → "$ 125.400,50". */
export function pesos(centavos: number): string {
  return fmtPesos.format((centavos ?? 0) / 100);
}

/** Número entero con separador de miles. */
export function numero(n: number): string {
  return fmtNum.format(n ?? 0);
}

/** ISO "YYYY-MM-DD" → "dd/mm/aaaa". */
export function fecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Pesos ingresados por el usuario (ej. 12500.5) → centavos (1250050). */
export function aCentavos(pesosValor: number | string): number {
  const n = typeof pesosValor === "string" ? Number(pesosValor.replace(",", ".")) : pesosValor;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Centavos → número en pesos para precargar inputs (1250050 → 12500.5). */
export function aPesos(centavos: number): number {
  return (centavos ?? 0) / 100;
}

/** Fecha de hoy en ISO YYYY-MM-DD (hora local). */
export function hoyISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/** Nombre de archivo con fecha, ej. "control-stock-general-2026-07-22.xlsx". */
export function nombreArchivo(prefijo: string): string {
  return `${prefijo}-${hoyISO()}.xlsx`;
}
