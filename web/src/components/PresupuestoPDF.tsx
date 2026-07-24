import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { NEGOCIO } from "../lib/negocio";
import { Cargando, Error, useCarga } from "./ui";
import { QRCode } from "./QRCode";

/** Comprobante / presupuesto imprimible. Botón imprime → "Guardar como PDF". */
export function PresupuestoPDF({ presupuestoId, onCerrar }: { presupuestoId: number; onCerrar: () => void }) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/presupuestos/${presupuestoId}`), [presupuestoId]);

  return (
    <div className="comprobante-overlay" onMouseDown={onCerrar}>
      <div className="comprobante-caja" onMouseDown={(e) => e.stopPropagation()}>
        <div className="no-print comprobante-barra">
          <button className="btn" onClick={onCerrar}>Cerrar</button>
          <button className="btn primario" onClick={() => window.print()}>🖨 Imprimir / Guardar PDF</button>
        </div>

        {cargando && <Cargando />}
        {error && <Error msg={error} />}

        {data && (
          <div className="comprobante">
            <div className="comp-header">
              <div>
                <div className="comp-marca">{NEGOCIO.nombre}</div>
                <div className="comp-sub">{NEGOCIO.rubro}</div>
                <div className="comp-sub">Tel: {NEGOCIO.telefono} · {NEGOCIO.instagram}</div>
              </div>
              <div className="comp-doc">
                <div className="comp-doc-tit">PRESUPUESTO</div>
                <div className="comp-doc-num">N° {String(data.presupuesto.numero).padStart(6, "0")}</div>
                <div className="comp-sub">{fecha(data.presupuesto.fecha)}</div>
              </div>
            </div>

            <div className="comp-cliente">
              <b>Cliente:</b> {data.presupuesto.cliente_nombre}
            </div>

            {data.presupuesto.valido_hasta && (
              <div className="comp-cliente">
                <b>Válido hasta:</b> {fecha(data.presupuesto.valido_hasta)}
              </div>
            )}

            <table className="comp-tabla">
              <thead>
                <tr>
                  <th>Cant.</th><th>Detalle</th><th className="num">P. unit.</th><th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it: any) => (
                  <tr key={it.id}>
                    <td className="num">{numero(it.cantidad)}</td>
                    <td>{it.nombre_herramienta}</td>
                    <td className="num">{pesos(it.precio_unitario)}</td>
                    <td className="num">{pesos(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="comp-totales">
              <div><span>Subtotal</span><span className="num">{pesos(data.presupuesto.subtotal)}</span></div>
              {data.presupuesto.descuento > 0 && (
                <div><span>Descuento</span><span className="num">− {pesos(data.presupuesto.descuento)}</span></div>
              )}
              <div className="comp-total"><span>TOTAL</span><span className="num">{pesos(data.presupuesto.total)}</span></div>
            </div>

            {data.presupuesto.nota && <div className="comp-nota"><b>Nota:</b> {data.presupuesto.nota}</div>}

            <div className="comp-qr">
              <QRCode value={`${window.location.origin}/#/presupuestos/${data.presupuesto.id}`} />
              <div className="comp-qr-txt">Escaneá para<br />ver este presupuesto<br />en el sistema</div>
            </div>

            <div className="comp-pie">
              Presupuesto sujeto a cambios de precio sin previo aviso — {NEGOCIO.nombre}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
