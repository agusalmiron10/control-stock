import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { NEGOCIO } from "../lib/negocio";
import { Cargando, Error, useCarga } from "./ui";
import { QRCode } from "./QRCode";

/** Comprobante / remito imprimible de una venta. Botón imprime → "Guardar como PDF". */
export function Comprobante({ ventaId, onCerrar }: { ventaId: number; onCerrar: () => void }) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/ventas/${ventaId}`), [ventaId]);

  const estados: Record<string, string> = {
    pagada: "PAGADA", parcial: "PAGO PARCIAL", impaga: "IMPAGA", anulada: "ANULADA",
  };

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
                <div className="comp-doc-tit">COMPROBANTE</div>
                <div className="comp-doc-num">N° {String(data.venta.numero).padStart(6, "0")}</div>
                <div className="comp-sub">{fecha(data.venta.fecha)}</div>
              </div>
            </div>

            <div className="comp-cliente">
              <b>Cliente:</b> {data.venta.cliente_nombre}
              {data.venta.estado === "anulada" && <span className="comp-anulada"> — ANULADA</span>}
            </div>

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
              <div><span>Subtotal</span><span className="num">{pesos(data.venta.subtotal)}</span></div>
              {data.venta.descuento > 0 && (
                <div><span>Descuento</span><span className="num">− {pesos(data.venta.descuento)}</span></div>
              )}
              <div className="comp-total"><span>TOTAL</span><span className="num">{pesos(data.venta.total)}</span></div>
              <div><span>Pagado</span><span className="num">{pesos(data.venta.pagado)}</span></div>
              <div className="comp-saldo">
                <span>Saldo</span>
                <span className="num">{pesos(data.venta.saldo)} — {estados[data.venta.estado] ?? data.venta.estado}</span>
              </div>
            </div>

            {data.venta.nota && <div className="comp-nota"><b>Nota:</b> {data.venta.nota}</div>}

            <div className="comp-qr">
              <QRCode value={`${window.location.origin}/#/ventas/${data.venta.id}`} />
              <div className="comp-qr-txt">Escaneá para<br />ver esta venta<br />en el sistema</div>
            </div>

            <div className="comp-pie">¡Gracias por su compra! — {NEGOCIO.nombre}</div>
          </div>
        )}
      </div>
    </div>
  );
}
