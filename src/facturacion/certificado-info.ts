/**
 * Lee del propio certificado cuándo vence — no hay que llevar la cuenta a
 * mano en ningún lado.
 *
 * Es UN SOLO certificado para toda la instalación (modelo de delegación, ver
 * el comentario grande en wsaa.ts): el día que venza, dejan de facturar TODOS
 * los negocios a la vez. Por eso esto es más crítico que un vencimiento por
 * cliente, no menos.
 */
import forge from "node-forge";

export interface EstadoCertificado {
  vigente: boolean;
  vencidoEl: string | null; // ISO, sólo si vigente
  diasParaVencer: number | null;
  titular: string | null; // CN del certificado, para confirmar que es el correcto
  severidad: "ok" | "avisar" | "urgente" | "vencido";
}

/** Umbrales de aviso. A 60 días hay tiempo de sobra para renovar sin apuro. */
const AVISO_DIAS = 60;
const URGENTE_DIAS = 7;

export function leerCertificado(certPem: string | undefined): EstadoCertificado | null {
  if (!certPem) return null;
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    // Un PEM roto es tan grave como uno vencido: nadie puede facturar.
    return { vigente: false, vencidoEl: null, diasParaVencer: null, titular: null, severidad: "vencido" };
  }

  const vencidoEl = cert.validity.notAfter;
  const diasParaVencer = Math.floor((vencidoEl.getTime() - Date.now()) / 86400000);
  const titular = cert.subject.getField("CN")?.value ?? null;

  const severidad: EstadoCertificado["severidad"] =
    diasParaVencer < 0 ? "vencido" : diasParaVencer <= URGENTE_DIAS ? "urgente" : diasParaVencer <= AVISO_DIAS ? "avisar" : "ok";

  return {
    vigente: diasParaVencer >= 0,
    vencidoEl: vencidoEl.toISOString(),
    diasParaVencer,
    titular,
    severidad,
  };
}
