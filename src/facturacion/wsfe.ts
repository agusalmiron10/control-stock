/**
 * WSFEv1 — el servicio de facturación electrónica en sí (FEDummy,
 * FECompUltimoAutorizado, FECAESolicitar). SOAP armado por template strings
 * (payload fijo y conocido, no vale la pena una librería SOAP completa) y
 * parseado con fast-xml-parser.
 *
 * OJO al implementar la Fase 7 (prueba real): revalidar esta lista de campos
 * contra el manual vigente de WSFEv1 en el portal de ARCA — el servicio les
 * agregó campos con el tiempo (ej. CondicionIVAReceptorId por RG 5259/2022).
 */
import { XMLParser } from "fast-xml-parser";
import type { TipoComprobante } from "../types";
import { HttpError } from "../validate";
import { codigoAlicuota } from "./calculo";

const URL_WSFE = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
} as const;

export interface Credenciales {
  token: string;
  sign: string;
  cuit: string;
  ambiente: "homologacion" | "produccion";
}

interface ErrorAfip {
  Code: number;
  Msg: string;
}

async function postSoap(ambiente: "homologacion" | "produccion", soapAction: string, body: string): Promise<any> {
  const res = await fetch(URL_WSFE[ambiente], {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `http://ar.gov.afip.dif.FEV1/${soapAction}`,
    },
    body,
  });
  const texto = await res.text();
  if (!res.ok) throw new HttpError(502, `WSFE respondió ${res.status}: ${texto.slice(0, 300)}`);

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const parsed = parser.parse(texto);
  return parsed?.Envelope?.Body ?? {};
}

function auth({ token, sign, cuit }: Credenciales): string {
  return `<Auth><Token>${token}</Token><Sign>${sign}</Sign><Cuit>${cuit}</Cuit></Auth>`;
}

/** No requiere autenticación: sólo confirma que el servicio está arriba. */
export async function feDummy(ambiente: "homologacion" | "produccion"): Promise<{ appServer: string; dbServer: string; authServer: string }> {
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body><ar:FEDummy/></soapenv:Body>
</soapenv:Envelope>`;
  const body = await postSoap(ambiente, "FEDummy", sobre);
  const r = body?.FEDummyResponse?.FEDummyResult;
  return { appServer: r?.AppServer, dbServer: r?.DbServer, authServer: r?.AuthServer };
}

export async function feCompUltimoAutorizado(
  cred: Credenciales,
  ptoVta: number,
  cbteTipo: TipoComprobante
): Promise<number> {
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      ${auth(cred)}
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>`;
  const body = await postSoap(cred.ambiente, "FECompUltimoAutorizado", sobre);
  const r = body?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult;
  const errores: ErrorAfip[] = arreglar(r?.Errors?.Err);
  if (errores.length > 0) {
    throw new HttpError(502, `ARCA rechazó la consulta: ${errores.map((e) => `${e.Code} ${e.Msg}`).join("; ")}`);
  }
  return Number(r?.CbteNro ?? 0);
}

export interface DetalleComprobante {
  cbteTipo: TipoComprobante;
  concepto?: number; // 1 = productos (default)
  docTipo: number;
  docNro: string;
  cbteFch: string; // yyyyMMdd
  impTotal: number; // centavos
  impNeto: number; // centavos
  impIVA: number; // centavos
  ivaPorcentaje: number; // centésimas de punto (2100 = 21%)
  condicionIVAReceptorId: number;
  /** Sólo para Nota de Crédito: el comprobante que credita. */
  cbteAsoc?: { tipo: TipoComprobante; ptoVta: number; nro: number };
}

export interface ResultadoCAE {
  numero: number;
  cae: string;
  caeVencimiento: string;
  observaciones: string | null;
}

function centavosAPesos(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** fast-xml-parser devuelve un objeto si hay un solo elemento, o un array si hay varios. Normaliza a array. */
function arreglar<T>(x: T | T[] | undefined): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/**
 * Emite el comprobante. El número se recibe de afuera a propósito: quien
 * llama tiene que reservarlo y grabarlo ANTES de pedir el CAE. Si se calculara
 * acá adentro y la conexión se cortara, nos quedaríamos sin saber qué número
 * se mandó — y sin número no se puede consultar después qué pasó.
 */
export async function feCaeSolicitar(
  cred: Credenciales,
  ptoVta: number,
  detalle: DetalleComprobante,
  numero: number
): Promise<ResultadoCAE> {
  const alicuota = codigoAlicuota(detalle.ivaPorcentaje);

  const cbtesAsocXml = detalle.cbteAsoc
    ? `<ar:CbtesAsoc><ar:CbteAsoc>
         <ar:Tipo>${detalle.cbteAsoc.tipo}</ar:Tipo>
         <ar:PtoVta>${detalle.cbteAsoc.ptoVta}</ar:PtoVta>
         <ar:Nro>${detalle.cbteAsoc.nro}</ar:Nro>
       </ar:CbteAsoc></ar:CbtesAsoc>`
    : "";

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECAESolicitar>
      ${auth(cred)}
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${detalle.cbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${detalle.concepto ?? 1}</ar:Concepto>
            <ar:DocTipo>${detalle.docTipo}</ar:DocTipo>
            <ar:DocNro>${detalle.docNro}</ar:DocNro>
            <ar:CbteDesde>${numero}</ar:CbteDesde>
            <ar:CbteHasta>${numero}</ar:CbteHasta>
            <ar:CbteFch>${detalle.cbteFch}</ar:CbteFch>
            <ar:ImpTotal>${centavosAPesos(detalle.impTotal)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${centavosAPesos(detalle.impNeto)}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>${centavosAPesos(detalle.impIVA)}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>${detalle.condicionIVAReceptorId}</ar:CondicionIVAReceptorId>
            ${cbtesAsocXml}
            <ar:Iva>
              <ar:AlicIva>
                <ar:Id>${alicuota}</ar:Id>
                <ar:BaseImp>${centavosAPesos(detalle.impNeto)}</ar:BaseImp>
                <ar:Importe>${centavosAPesos(detalle.impIVA)}</ar:Importe>
              </ar:AlicIva>
            </ar:Iva>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`;

  const body = await postSoap(cred.ambiente, "FECAESolicitar", sobre);
  const r = body?.FECAESolicitarResponse?.FECAESolicitarResult;

  const erroresGenerales: ErrorAfip[] = arreglar(r?.Errors?.Err);
  if (erroresGenerales.length > 0) {
    throw new HttpError(502, `ARCA rechazó la solicitud: ${erroresGenerales.map((e) => `${e.Code} ${e.Msg}`).join("; ")}`);
  }

  const det = arreglar(r?.FeDetResp?.FECAEDetResponse)[0];
  if (!det) throw new HttpError(502, "ARCA no devolvió el detalle del comprobante.");

  const observaciones = arreglar(det?.Observaciones?.Obs)
    .map((o: ErrorAfip) => `${o.Code}: ${o.Msg}`)
    .join(" | ") || null;

  if (det.Resultado !== "A") {
    throw new HttpError(502, `ARCA no autorizó el comprobante (resultado ${det.Resultado}). ${observaciones ?? ""}`);
  }

  return { numero, cae: String(det.CAE), caeVencimiento: String(det.CAEFchVto), observaciones };
}

/**
 * Consulta un comprobante ya emitido. Es la salida para los "huérfanos": si
 * se corta la conexión después de mandar el pedido, no sabemos si ARCA lo
 * autorizó o no — y reintentar a ciegas puede dejar DOS facturas reales para
 * una misma venta. Con esto se pregunta antes de tocar nada.
 *
 * Devuelve null si ARCA no tiene ese comprobante (nunca se llegó a emitir,
 * así que el número se puede reusar).
 */
export async function feCompConsultar(
  cred: Credenciales,
  ptoVta: number,
  cbteTipo: TipoComprobante,
  cbteNro: number
): Promise<ResultadoCAE | null> {
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompConsultar>
      ${auth(cred)}
      <ar:FeCompConsReq>
        <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
        <ar:CbteNro>${cbteNro}</ar:CbteNro>
        <ar:PtoVta>${ptoVta}</ar:PtoVta>
      </ar:FeCompConsReq>
    </ar:FECompConsultar>
  </soapenv:Body>
</soapenv:Envelope>`;
  const body = await postSoap(cred.ambiente, "FECompConsultar", sobre);
  const r = body?.FECompConsultarResponse?.FECompConsultarResult;

  // 602 = "no existe el comprobante consultado". No es un fallo: es la
  // respuesta que confirma que el número quedó libre.
  const errores: ErrorAfip[] = arreglar(r?.Errors?.Err);
  if (errores.some((e) => Number(e.Code) === 602)) return null;
  if (errores.length > 0) {
    throw new HttpError(502, `ARCA rechazó la consulta: ${errores.map((e) => `${e.Code} ${e.Msg}`).join("; ")}`);
  }

  const c = r?.ResultGet;
  if (!c || !c.CodAutorizacion) return null;

  const obs = arreglar<ErrorAfip>(c?.Observaciones?.Obs);
  return {
    numero: Number(c.CbteDesde ?? cbteNro),
    cae: String(c.CodAutorizacion),
    caeVencimiento: String(c.FchVto ?? ""),
    observaciones: obs.length > 0 ? obs.map((o) => `${o.Code} ${o.Msg}`).join("; ") : null,
  };
}

/** Error 600 de ARCA: el CUIT del certificado no figura como representante
 *  del CUIT consultado. O sea: el negocio todavía no hizo la delegación. */
export const ERROR_SIN_DELEGACION = 600;

export class SinDelegacion extends HttpError {
  constructor(cuit: string) {
    super(409, `El CUIT ${cuit} todavía no delegó el servicio de Facturación Electrónica.`);
  }
}

/**
 * Puntos de venta habilitados para web services del CUIT representado.
 *
 * Es la prueba de fuego de la delegación: si el negocio todavía no nos delegó
 * el servicio en el Administrador de Relaciones, ARCA contesta 600 y sabemos
 * exactamente qué le falta hacer. Si contesta la lista, ya está todo listo.
 */
export async function feParamGetPtosVenta(
  cred: Credenciales
): Promise<{ nro: number; tipo: string; bloqueado: boolean }[]> {
  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FEParamGetPtosVenta>
      ${auth(cred)}
    </ar:FEParamGetPtosVenta>
  </soapenv:Body>
</soapenv:Envelope>`;
  const body = await postSoap(cred.ambiente, "FEParamGetPtosVenta", sobre);
  const r = body?.FEParamGetPtosVentaResponse?.FEParamGetPtosVentaResult;

  const errores: ErrorAfip[] = arreglar(r?.Errors?.Err);
  if (errores.some((e) => Number(e.Code) === ERROR_SIN_DELEGACION)) {
    throw new SinDelegacion(cred.cuit);
  }
  if (errores.length > 0) {
    throw new HttpError(502, `ARCA rechazó la consulta: ${errores.map((e) => `${e.Code} ${e.Msg}`).join("; ")}`);
  }

  return arreglar<any>(r?.ResultGet?.PtoVenta).map((p) => ({
    nro: Number(p?.Nro),
    tipo: String(p?.EmisionTipo ?? ""),
    // ARCA manda "S"/"N" como string.
    bloqueado: String(p?.Bloqueado ?? "N").toUpperCase() === "S",
  }));
}
