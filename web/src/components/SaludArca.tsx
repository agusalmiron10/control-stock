import { api } from "../api";
import { fecha } from "../format";
import { Cargando, Error, useCarga } from "./ui";

interface Certificado {
  vigente: boolean; vencidoEl: string | null; diasParaVencer: number | null;
  titular: string | null; severidad: "ok" | "avisar" | "urgente" | "vencido";
}
interface ClienteArca {
  negocio_id: string; negocio_nombre: string; cuit: string; ambiente: string;
  delegacion_verificada_en: string | null;
  autorizadas_30d: number; con_problema_30d: number; huerfanas: number;
  ultimo_error: string | null; ultimo_error_en: string | null;
}

const TEXTO_SEVERIDAD: Record<Certificado["severidad"], string> = {
  ok: "Vigente",
  avisar: "Vence pronto",
  urgente: "Vence ya",
  vencido: "Vencido",
};
const CLASE_SEVERIDAD: Record<Certificado["severidad"], string> = {
  ok: "pagada", avisar: "parcial", urgente: "impaga", vencido: "impaga",
};

/**
 * Salud de facturación electrónica: un solo certificado para toda la
 * instalación (modelo de delegación), así que su vencimiento es lo primero
 * que se muestra — el día que caiga, dejan de facturar todos los clientes
 * a la vez, no sólo uno.
 */
export function SaludArca() {
  const { data, error, cargando } = useCarga<{ certificado: Certificado | null; clientes: ClienteArca[] }>(
    () => api.get("/api/super/arca"),
    []
  );

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  const cert = data?.certificado;
  const clientes = data?.clientes ?? [];

  return (
    <>
      {!cert ? (
        <p className="mut" style={{ marginTop: 0 }}>
          Todavía no está cargado el certificado de ARCA del sistema. Sin él, ningún cliente puede
          facturar electrónicamente.
        </p>
      ) : (
        <div className={`pill-alerta ${cert.severidad === "ok" ? "pill-ok" : cert.severidad === "vencido" || cert.severidad === "urgente" ? "roja" : ""}`} style={{ marginBottom: 16 }}>
          <b>Certificado del sistema:</b>{" "}
          <span className={`badge ${CLASE_SEVERIDAD[cert.severidad]}`}>{TEXTO_SEVERIDAD[cert.severidad]}</span>
          {cert.vencidoEl && (
            <>
              {" — "}
              {cert.severidad === "vencido"
                ? `venció el ${fecha(cert.vencidoEl.slice(0, 10))}`
                : `vence el ${fecha(cert.vencidoEl.slice(0, 10))} (${cert.diasParaVencer} días)`}
            </>
          )}
          {cert.titular && <div className="mut" style={{ marginTop: 4 }}>Titular: {cert.titular}</div>}
          {cert.severidad !== "ok" && (
            <div style={{ marginTop: 6 }}>
              Es un solo certificado para toda la instalación: el día que venza, <b>dejan de facturar
              todos los clientes a la vez</b>, no sólo uno.
            </div>
          )}
        </div>
      )}

      {clientes.length === 0 ? (
        <p className="mut">Ningún cliente tiene la facturación electrónica activada todavía.</p>
      ) : (
        <div className="tabla-wrap">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cliente</th><th>CUIT</th><th>Ambiente</th><th>Delegación</th>
                <th className="num">CAE (30d)</th><th>Último problema</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((cl) => (
                <tr key={cl.negocio_id}>
                  <td>{cl.negocio_nombre}</td>
                  <td className="mono">{cl.cuit}</td>
                  <td>
                    <span className={`badge ${cl.ambiente === "produccion" ? "pagada" : "parcial"}`}>
                      {cl.ambiente === "produccion" ? "Producción" : "Prueba"}
                    </span>
                  </td>
                  <td>
                    {cl.delegacion_verificada_en
                      ? <span className="mut">Verificada {fecha(cl.delegacion_verificada_en.slice(0, 10))}</span>
                      : <span className="badge impaga">Sin verificar</span>}
                  </td>
                  <td className="num">
                    {cl.autorizadas_30d}
                    {cl.con_problema_30d > 0 && <span className="debe"> · {cl.con_problema_30d} con error</span>}
                    {cl.huerfanas > 0 && <span className="debe"> · {cl.huerfanas} sin confirmar</span>}
                  </td>
                  <td className="mut" style={{ maxWidth: 260 }}>
                    {cl.ultimo_error
                      ? `${cl.ultimo_error.slice(0, 80)}${cl.ultimo_error.length > 80 ? "…" : ""}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
