import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { Modal, Error, Cargando, useCarga } from "./ui";

const BADGE: Record<string, string> = {
  aceptado: "pagada",
  rechazado: "impaga",
  vencido: "anulada",
  pendiente: "parcial",
};

interface Props {
  id: number;
  onCerrar: () => void;
  onPdf?: (id: number) => void;
  onAbrirCompleto?: (id: number) => void;
}

/** Ficha de un presupuesto: a quién, qué se cotizó y en qué estado quedó. */
export function PresupuestoDetalleModal({ id, onCerrar, onPdf, onAbrirCompleto }: Props) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/presupuestos/${id}`), [id]);
  const p = data?.presupuesto;

  return (
    <Modal titulo={p ? `Presupuesto #${p.numero}` : "Presupuesto"} ancho onCerrar={onCerrar}>
      <Error msg={error} />
      {cargando ? (
        <Cargando />
      ) : !p ? null : (
        <>
          <div className="tf-datos" style={{ marginBottom: 14 }}>
            <span className={`badge ${BADGE[p.estado] ?? ""}`}>{p.estado}</span>
            {p.venta_numero && <span className="badge pagada">Convertido en venta #{p.venta_numero}</span>}
          </div>

          <h3 style={{ marginBottom: 4 }}>Cliente</h3>
          <dl className="detalle-filas">
            <div className="detalle-fila"><dt>Nombre</dt><dd>{p.cliente_nombre}</dd></div>
            {p.cliente_telefono && (
              <div className="detalle-fila"><dt>Teléfono</dt><dd>{p.cliente_telefono}</dd></div>
            )}
            <div className="detalle-fila"><dt>Fecha</dt><dd>{fecha(p.fecha)}</dd></div>
            {p.validez_hasta && (
              <div className="detalle-fila"><dt>Válido hasta</dt><dd>{fecha(p.validez_hasta)}</dd></div>
            )}
          </dl>

          <h3 style={{ marginBottom: 4, marginTop: 18 }}>Qué se cotizó</h3>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Detalle</th><th className="num">Cant.</th>
                  <th className="num">Precio</th><th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it: any) => (
                  <tr key={it.id}>
                    <td>{it.nombre_herramienta}</td>
                    <td className="num">{numero(it.cantidad)}</td>
                    <td className="num">{pesos(it.precio_unitario)}</td>
                    <td className="num">{pesos(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginBottom: 4, marginTop: 18 }}>Importes</h3>
          <dl className="detalle-filas">
            <div className="detalle-fila"><dt>Subtotal</dt><dd>{pesos(p.subtotal)}</dd></div>
            {p.descuento > 0 && (
              <div className="detalle-fila"><dt>Descuento</dt><dd>-{pesos(p.descuento)}</dd></div>
            )}
            <div className="detalle-fila fuerte"><dt>Total</dt><dd>{pesos(p.total)}</dd></div>
          </dl>

          {p.nota && (
            <>
              <h3 style={{ marginBottom: 4, marginTop: 18 }}>Nota</h3>
              <p className="mut" style={{ marginTop: 0 }}>{p.nota}</p>
            </>
          )}

          <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" onClick={onCerrar}>Cerrar</button>
            {onPdf && <button className="btn" onClick={() => onPdf(p.id)}>PDF</button>}
            {onAbrirCompleto && (
              <button className="btn primario" onClick={() => onAbrirCompleto(p.id)}>Abrir</button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
