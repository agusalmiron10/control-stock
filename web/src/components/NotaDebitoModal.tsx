import { useState } from "react";
import { api } from "../api";
import { Modal, Error, Campo } from "./ui";
import { aCentavos } from "../format";
import { useCapacidades } from "../lib/config";

interface Props {
  ventaId: string;
  /** Letra de la factura original (A/B/C): la ND sale con la misma letra. */
  letra: string;
  onCerrar: (mensaje?: string) => void;
}

/**
 * Cobrar algo MÁS sobre una venta ya facturada: un interés, un ajuste, un
 * flete que se cobra aparte. A diferencia de anular, esto no toca la venta
 * original — queda como está, con su factura y su stock intactos.
 */
export function NotaDebitoModal({ ventaId, letra, onCerrar }: Props) {
  const capacidades = useCapacidades();
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [concepto, setConcepto] = useState<string | null>(null);
  const [servDesde, setServDesde] = useState("");
  const [servHasta, setServHasta] = useState("");
  const [vtoPago, setVtoPago] = useState("");
  const [fecha, setFecha] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<{ numero: number; cae: string; caeVencimiento: string } | null>(null);

  const conceptoElegido = concepto ?? capacidades.concepto_default;
  const pideFechasServicio = conceptoElegido !== "productos";

  async function emitir() {
    setError(null);
    const centavos = aCentavos(monto || "0");
    if (centavos <= 0) { setError("Cargá un monto mayor a cero."); return; }
    setEmitiendo(true);
    try {
      const cuerpo: any = {
        monto: centavos,
        motivo: motivo || undefined,
        concepto: conceptoElegido,
        fecha: fecha || undefined,
      };
      if (pideFechasServicio) {
        cuerpo.fch_serv_desde = servDesde || undefined;
        cuerpo.fch_serv_hasta = servHasta || undefined;
        cuerpo.fch_vto_pago = vtoPago || undefined;
      }
      const r = await api.post<{ numero: number; cae: string; caeVencimiento: string }>(
        `/api/facturacion/ventas/${ventaId}/nota-debito`,
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
    const listo = `Nota de Débito ${letra} emitida con CAE ${resultado.cae}.`;
    return (
      <Modal titulo="Nota de Débito emitida" onCerrar={() => onCerrar(listo)}>
        <p className="ok-box">
          Nota de Débito {letra} N° {resultado.numero} emitida.<br />
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
    <Modal titulo={`Nota de Débito ${letra}`} onCerrar={() => onCerrar()}>
      <Error msg={error} />
      <p className="mut" style={{ marginTop: 0 }}>
        Para cobrar algo más sobre esta venta ya facturada (un interés, un ajuste). No anula ni
        modifica la factura original.
      </p>

      <div className="fila">
        <Campo label="Monto a debitar ($)">
          <input className="num" type="number" step="0.01" min={0} value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
        </Campo>
        <Campo label="Motivo (opcional)">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: interés por mora" maxLength={200} />
        </Campo>
      </div>

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
      )}

      <Campo label="Fecha del comprobante">
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Campo>
      <p className="mut" style={{ marginTop: -4 }}>
        Si la dejás vacía se emite con la fecha de hoy.
      </p>

      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={emitiendo} onClick={emitir}>
          {emitiendo ? "Emitiendo…" : "Emitir Nota de Débito"}
        </button>
      </div>
    </Modal>
  );
}
