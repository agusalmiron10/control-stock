import { useState } from "react";
import { api } from "../api";
import { Modal, Error, Cargando, Campo, useCarga } from "./ui";
import { pesos } from "../format";
import { navegar } from "../lib/router";
import { useRol, esDueno } from "../lib/rol";
import { useCapacidades } from "../lib/config";

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
  const capacidades = useCapacidades();
  const [letra, setLetra] = useState<string | null>(null);
  const [concepto, setConcepto] = useState<string | null>(null);
  const [servDesde, setServDesde] = useState("");
  const [servHasta, setServHasta] = useState("");
  const [vtoPago, setVtoPago] = useState("");
  const [condVenta, setCondVenta] = useState("");
  const [fecha, setFecha] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<{ letra: string; numero: number; cae: string; caeVencimiento: string } | null>(null);

  const puedeConfigurar = esDueno(useRol());
  const previo = useCarga<any>(() => api.get(`/api/facturacion/ventas/${ventaId}/previo`), [ventaId]);
  const p = previo.data;
  // Hasta que el usuario toque algo, va la que sugiere el sistema.
  const elegida = letra ?? p?.sugerida ?? null;
  // El default sale del rubro (una fumigadora factura Servicios), pero se
  // puede cambiar comprobante por comprobante.
  const conceptoElegido = concepto ?? capacidades.concepto_default;
  const pideFechasServicio = conceptoElegido !== "productos";
  const opcionElegida = p?.opciones?.find((o: any) => o.letra === elegida);

  async function emitir() {
    setError(null);
    setEmitiendo(true);
    try {
      const cuerpo: any = { tipo: elegida, concepto: conceptoElegido, condicion_venta: condVenta || undefined, fecha: fecha || undefined };
      if (conceptoElegido !== "productos") {
        cuerpo.fch_serv_desde = servDesde || undefined;
        cuerpo.fch_serv_hasta = servHasta || undefined;
        cuerpo.fch_vto_pago = vtoPago || undefined;
      }
      const r = await api.post<{ letra: string; numero: number; cae: string; caeVencimiento: string }>(
        `/api/facturacion/ventas/${ventaId}/emitir`,
        cuerpo
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

          <hr />
          <Campo label="Concepto">
            <div className="btn-grupo">
              {[["productos", "Productos"], ["servicios", "Servicios"], ["ambos", "Productos y Servicios"]].map(([id, txt]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn chico ${conceptoElegido === id ? "primario" : ""}`}
                  onClick={() => setConcepto(id)}
                >
                  {txt}
                </button>
              ))}
            </div>
          </Campo>

          {pideFechasServicio && (
            <>
              <p className="mut" style={{ marginTop: 6, marginBottom: 6 }}>
                Para Servicios, ARCA pide el período y el vencimiento del pago. Si los dejás
                vacíos se usa la fecha de la venta.
              </p>
              <div className="fila">
                <Campo label="Servicio desde">
                  <input type="date" value={servDesde} onChange={(e) => setServDesde(e.target.value)} />
                </Campo>
                <Campo label="Servicio hasta">
                  <input type="date" value={servHasta} onChange={(e) => setServHasta(e.target.value)} />
                </Campo>
                <Campo label="Vence el pago">
                  <input type="date" value={vtoPago} onChange={(e) => setVtoPago(e.target.value)} />
                </Campo>
              </div>
            </>
          )}

          <div className="fila">
            <Campo label="Condición de venta">
              <select value={condVenta} onChange={(e) => setCondVenta(e.target.value)}>
                <option value="">Según la venta (contado o cuenta corriente)</option>
                {["Contado", "Tarjeta de Débito", "Tarjeta de Crédito", "Cuenta Corriente",
                  "Cheque", "Transferencia Bancaria", "Otra"].map((cv) => (
                  <option key={cv} value={cv}>{cv}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Fecha del comprobante">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>
          </div>
          <p className="mut" style={{ marginTop: -4 }}>
            Si dejás la fecha vacía se usa la de la venta, salvo que ARCA ya no la acepte
            (admite hasta {pideFechasServicio ? 10 : 5} días).
          </p>

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
