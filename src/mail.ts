/**
 * Envío real de mails (server a server, vía Resend) en nombre de cada
 * negocio — a diferencia del "mailto:" del frontend (que sólo abre el
 * cliente de correo de quien lo aprieta), esto lo manda el sistema solo,
 * sin que nadie tenga que tocar "Enviar".
 *
 * El remitente técnico es siempre un dominio de ChauPapel (el único
 * verificado en Resend); lo que cambia por negocio es el NOMBRE visible:
 * el cliente ve "ARBELL <notificaciones@chaupapel.com>", no "ChauPapel".
 * Mismo patrón que ya usa el resumen diario de stock bajo (scheduled.ts),
 * sólo que ahí el remitente es fijo porque el destinatario es el dueño.
 */
import type { Env } from "./types";

const fmtPesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

/** Centavos (entero) → "$ 125.400,50". Copia de web/src/format.ts: la base
 *  guarda centavos, y acá no hay forma de compartir código con el frontend. */
export function pesos(centavos: number): string {
  return fmtPesos.format((centavos ?? 0) / 100);
}

/** Fecha de hoy en hora argentina, "dd/mm/aaaa". */
export function fechaHoy(): string {
  return new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}

/** Saca lo que podría inyectar headers (\r\n) o romper el "Nombre <mail>". */
function remitente(nombreNegocio: string): string {
  const limpio = nombreNegocio.replace(/[\r\n"<>]/g, "").trim() || "ChauPapel";
  return `${limpio} <notificaciones@chaupapel.com>`;
}

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export interface AdjuntoMail {
  nombre: string;
  /** Texto plano (CSV, por ejemplo) — esta función se encarga de codificarlo. */
  contenidoTexto: string;
}

/**
 * Manda un mail real en nombre de un negocio. Nunca lanza: devuelve `null`
 * si salió bien, o un mensaje de error legible para mostrarle a quien lo
 * pidió (por ejemplo, "todavía no está activado"). Quien llama decide qué
 * hacer con ese mensaje — típicamente, mostrar un aviso y ofrecer el
 * "mailto:" de siempre como alternativa.
 */
export async function enviarMailNegocio(
  env: Env,
  negocioNombre: string,
  destino: string,
  asunto: string,
  textoPlano: string,
  adjunto?: AdjuntoMail
): Promise<string | null> {
  if (!env.RESEND_API_KEY) {
    return "El envío de mails directo todavía no está activado en este sistema.";
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: remitente(negocioNombre),
      to: [destino],
      subject: asunto,
      text: textoPlano,
      ...(adjunto
        ? { attachments: [{ filename: adjunto.nombre, content: base64Utf8(adjunto.contenidoTexto) }] }
        : {}),
    }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    console.error(`Resend devolvió ${res.status}: ${detalle}`);
    return "No se pudo enviar el mail. Probá de nuevo en un rato.";
  }
  return null;
}
