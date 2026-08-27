/**
 * WSAA — autenticación de ARCA. Firma un LoginTicketRequest como CMS/PKCS#7
 * (ver pkcs7.ts) y lo canjea por un token+sign válido ~12hs.
 *
 * Modelo de delegación: se firma con el certificado del PROVEEDOR del sistema
 * (uno solo, en secrets) y cada negocio delega el servicio a ese CUIT desde el
 * Administrador de Relaciones de ARCA.
 *
 * El ticket es GLOBAL, no por negocio: el LoginTicketRequest sólo lleva
 * uniqueId, tiempos y el servicio — el CUIT representado no aparece. O sea que
 * queda atado al certificado y uno solo sirve para todos los negocios. Pedir
 * uno por negocio serían N logins idénticos, y WSAA rechaza pedir otro
 * mientras el anterior siga vigente.
 */
import { XMLParser } from "fast-xml-parser";
import type { Env } from "../types";
import { HttpError } from "../validate";
import { firmarCMS } from "./pkcs7";

const URL_WSAA = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
} as const;

/** Margen de seguridad antes del vencimiento real: si falta menos de esto, se pide uno nuevo. */
const MARGEN_MS = 10 * 60 * 1000;

interface TicketAcceso {
  token: string;
  sign: string;
  expiraEn: string; // ISO
}

function armarLTR(servicio: string): string {
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - MARGEN_MS);
  const hasta = new Date(ahora.getTime() + MARGEN_MS);
  const uniqueId = Math.floor(ahora.getTime() / 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${desde.toISOString()}</generationTime>
    <expirationTime>${hasta.toISOString()}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

function armarSobreSoap(cmsBase64: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
}

async function pedirTicketNuevo(
  ambiente: "homologacion" | "produccion",
  certPem: string,
  clavePem: string
): Promise<TicketAcceso> {
  const ltr = armarLTR("wsfe");
  const cms = firmarCMS(ltr, certPem, clavePem);
  const sobre = armarSobreSoap(cms);

  const res = await fetch(URL_WSAA[ambiente], {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "",
    },
    body: sobre,
  });
  const textoRespuesta = await res.text();
  if (!res.ok) {
    throw new HttpError(502, `WSAA respondió ${res.status}: ${textoRespuesta.slice(0, 300)}`);
  }

  const parser = new XMLParser({ ignoreAttributes: false });
  const sobreParseado = parser.parse(textoRespuesta);
  // La respuesta trae el loginTicketResponse como STRING dentro del SOAP —
  // hay que parsearlo una segunda vez.
  const cuerpoInterno: string | undefined =
    sobreParseado?.["soapenv:Envelope"]?.["soapenv:Body"]?.["loginCmsResponse"]?.["loginCmsReturn"] ??
    sobreParseado?.["soap:Envelope"]?.["soap:Body"]?.["loginCmsResponse"]?.["loginCmsReturn"];

  if (!cuerpoInterno) {
    // Un fault de WSAA (cert vencido, CUIT sin relación, etc.) viene como texto plano acá.
    throw new HttpError(502, `WSAA no devolvió un ticket. Respuesta: ${textoRespuesta.slice(0, 500)}`);
  }

  const ticket = parser.parse(cuerpoInterno);
  const token = ticket?.loginTicketResponse?.credentials?.token;
  const sign = ticket?.loginTicketResponse?.credentials?.sign;
  const expiraEn = ticket?.loginTicketResponse?.header?.expirationTime;
  if (!token || !sign) {
    throw new HttpError(502, "WSAA devolvió una respuesta sin token/sign.");
  }
  return { token, sign, expiraEn };
}

/** ¿Está cargado el certificado del proveedor? Sin esto no factura nadie. */
export function hayCertificadoDelProveedor(env: Env): boolean {
  return !!env.ARCA_CERT_PEM && !!env.ARCA_CLAVE_PEM;
}

/**
 * Ticket de acceso vigente. Es uno solo para toda la instalación (ver el
 * comentario de arriba): se cachea por ambiente en `arca_proveedor`, no en
 * memoria, porque Workers recicla isolates y WSAA penaliza los logins de más.
 */
export async function obtenerTicketAcceso(
  env: Env,
  ambiente: "homologacion" | "produccion"
): Promise<TicketAcceso> {
  const guardado = await env.DB
    .prepare(`SELECT wsaa_token, wsaa_sign, wsaa_expira_en FROM arca_proveedor WHERE ambiente = ?`)
    .bind(ambiente)
    .first<{ wsaa_token: string | null; wsaa_sign: string | null; wsaa_expira_en: string | null }>();

  if (guardado?.wsaa_token && guardado.wsaa_sign && guardado.wsaa_expira_en) {
    const vencimiento = new Date(guardado.wsaa_expira_en).getTime();
    if (vencimiento - Date.now() > MARGEN_MS) {
      return { token: guardado.wsaa_token, sign: guardado.wsaa_sign, expiraEn: guardado.wsaa_expira_en };
    }
  }

  if (!hayCertificadoDelProveedor(env)) {
    throw new HttpError(
      409,
      "Todavía no está cargado el certificado de ARCA del sistema. Lo carga el proveedor una sola vez, para todos los negocios."
    );
  }

  const ticket = await pedirTicketNuevo(ambiente, env.ARCA_CERT_PEM, env.ARCA_CLAVE_PEM);

  await env.DB.prepare(
    `UPDATE arca_proveedor SET wsaa_token=?, wsaa_sign=?, wsaa_expira_en=?, actualizado_en=datetime('now')
     WHERE ambiente=?`
  )
    .bind(ticket.token, ticket.sign, ticket.expiraEn, ambiente)
    .run();

  return ticket;
}
