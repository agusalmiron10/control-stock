import { useState } from "react";
import { api } from "../api";
import { Modal, Error, Cargando, useCarga } from "./ui";
import { pesos } from "../format";
import { navegar } from "../lib/router";
import { useRol, esDueno } from "../lib/rol";

const DESCRIPCION: Record<string, string> = {
  A: "Factura A — a Responsable Inscripto con CUIT",
  B: "Factura B — a consumidor final o monotributista",
  C: "Factura C — emisor Monotributista",
};

interface Props {
  ventaId: string;
  onCerrar: (mensaje?: string) => void;
}

/** Emitir la factura de una venta: muestra qué se va a emitir, avisa si falta
 *  algún dato del cliente, y recién ahí pide el CAE a ARCA. */
export function EmitirFacturaModal({ ventaId, onCerrar }: Props) {
  const [letra, setLetra] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<{ letra: string; numero: number; cae: string; caeVencimiento: string } | null>(null);

  const puedeConfigurar = esDueno(useRol());
  const previo = useCarga<any>(() => api.get(`/api/facturacion/ventas/${ventaId}/previo`), [ventaId]);
  const p = previo.data;
  // Hasta que el usuario toque algo, va la que sugiere el sistema.
  const elegida = letra ?? p?.sugerida ?? null;
  const opcionElegida = p?.opciones?.find((o: any) => o.letra === elegida);

  async function emitir() {
    setError(null);
    setEmitiendo(true);
    try {
      const r = await api.post<{ letra: string; numero: number; cae: string; caeVencimiento: string }>(
        `/api/facturacion/ventas/${ventaId}/emitir`,
        elegida ? { tipo: elegida } : {}
      );
      setResultado(r);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEmitiendo(false);
    }
  }

  if (resultado) {
    const listo = `Factura ${resultado.letra} emitida con CAE ${resultado.cae}.`;
    return (
      <Modal titulo="Factura emitida" onCerrar={() => onCerrar(listo)}>
        <p className="ok-box">
          Factura {resultado.letra} N° {resultado.numero} emitida.<br />
          CAE: <b>{resultado.cae}</b><br />
          Vencimiento del CAE: {resultado.caeVencimiento}
        </p>
        <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn primario" onClick={() => onCerrar(listo)}>Listo</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo="Emitir factura" onCerrar={() => onCerrar()}>
      {/* Si todavía no se puede facturar, no tiene sentido mostrar el error
          pelado: hay que decir qué falta y quién lo puede resolver. */}
      {!previo.cargando && !p && previo.error ? (
        <div className="pill-alerta">
          <p style={{ marginTop: 0 }}><b>Todavía no se puede facturar.</b></p>
          <p>{previo.error}</p>
          <p className="mut" style={{ marginBottom: 0 }}>
            {puedeConfigurar
              ? "Cargá el certificado de ARCA y los datos fiscales en Ajustes → Facturación."
              : "Esto lo tiene que resolver el dueño desde Ajustes → Facturación. Mientras tanto la venta queda guardada y se puede facturar después."}
          </p>
        </div>
      ) : (
        <Error msg={error} />
      )}

      {previo.cargando ? (
        <Cargando />
      ) : !p ? null : (
        <>
          <div className="resumen-factura">
            <div>
              <span className="mut">Cliente</span>
              <strong>{p.cliente.nombre}</strong>
              <span className="mut">
                {p.cliente.doc_tipo && p.cliente.doc_numero
                  ? ` · ${p.cliente.doc_tipo} ${p.cliente.doc_numero}`
                  : " · sin documento cargado"}
              </span>
            </div>
            <div>
              <span className="mut">Venta #{p.venta.numero}</span>
              <strong>{pesos(p.venta.total)}</strong>
              <span className="mut"> · Neto {pesos(p.neto)} + IVA {pesos(p.iva)}</span>
            </div>
          </div>

          {p.opciones.map((o: any) => (
            <label
              key={o.letra}
              className={`tarjeta-fila modulo-fila ${o.disponible ? "" : "opcion-no"}`}
            >
              <input
                type="radio"
                name="letra"
                checked={elegida === o.letra}
                disabled={!o.disponible}
                onChange={() => setLetra(o.letra)}
              />
              <span>
                {DESCRIPCION[o.letra]}
                {o.letra === p.sugerida && <span className="badge pagada" style={{ marginLeft: 8 }}>Sugerida</span>}
                {o.motivo && <div className="mut" style={{ marginTop: 2 }}>{o.motivo}</div>}
              </span>
            </label>
          ))}

          {/* Atajo para el caso más común: falta el CUIT y hay que ir a cargarlo. */}
          {!p.opciones.find((o: any) => o.letra === "A")?.disponible &&
            p.cliente.doc_tipo !== "CUIT" &&
            p.sugerida !== "C" && (
              <button
                className="btn"
                style={{ marginTop: 8 }}
                onClick={() => { onCerrar(); navegar(`/clientes/${p.cliente.id}`); }}
              >
                Cargarle el CUIT a {p.cliente.nombre}
              </button>
            )}

          <p className="mut" style={{ marginTop: 12 }}>
            Se pide el CAE a ARCA. No se puede deshacer — si te equivocás, después se anula con Nota de Crédito.
          </p>
        </>
      )}

      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onCerrar()}>{p ? "Cancelar" : "Entendido"}</button>
        {p && (
          <button
            className="btn primario"
            disabled={emitiendo || !opcionElegida?.disponible}
            onClick={emitir}
          >
            {emitiendo ? "Emitiendo…" : `Emitir Factura ${elegida ?? ""}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
