import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { NEGOCIO } from "../lib/negocio";
import { Cargando, Error, useCarga } from "./ui";

/**
 * PDF (vía impresión del navegador) con lo que se vendió y a quién, en un
 * rango de fechas. Reutiliza el filtro de cliente/fecha que ya está activo
 * en la pantalla de Ventas.
 */
export function ReporteVentasPDF({
  desde,
  hasta,
  clienteId,
  clienteNombre,
  onCerrar,
}: {
  desde: string;
  hasta: string;
  clienteId?: string;
  clienteNombre?: string;
  onCerrar: () => void;
}) {
  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);
  if (clienteId) qs.set("cliente_id", clienteId);
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/reportes/ventas-detalle?${qs}`), [desde, hasta, clienteId]);

  const rango = desde && hasta ? `${fecha(desde)} al ${fecha(hasta)}` : desde ? `desde el ${fecha(desde)}` : hasta ? `hasta el ${fecha(hasta)}` : "todas las fechas";

  return (
    <div className="comprobante-overlay" onMouseDown={onCerrar}>
      <div className="comprobante-caja" onMouseDown={(e) => e.stopPropagation()}>
        <div className="no-print comprobante-barra">
          <button className="btn" onClick={onCerrar}>Cerrar</button>
          <button className="btn primario" onClick={() => window.print()} disabled={!data || data.items.length === 0}>
            🖨 Imprimir / Guardar PDF
          </button>
        </div>

        {cargando && <Cargando />}
        {error && <Error msg={error} />}

        {data && (
          <div className="comprobante reporte-imprimible">
            <div className="comp-header">
              <div>
                <div className="comp-marca">{NEGOCIO.nombre}</div>
                <div className="comp-sub">{NEGOCIO.rubro}</div>
              </div>
              <div className="comp-doc">
                <div className="comp-doc-tit">VENTAS</div>
                <div className="comp-sub">{rango}</div>
                {clienteNombre && <div className="comp-sub">Cliente: {clienteNombre}</div>}
              </div>
            </div>

            {data.items.length === 0 ? (
              <p className="mut">No hay ventas en este período.</p>
            ) : (
              <>
                <table className="comp-tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Cliente</th><th>Producto</th>
                      <th className="num">Cant.</th><th className="num">P. unit.</th><th className="num">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it: any, i: number) => (
                      <tr key={i}>
                        <td>{fecha(it.fecha)}</td>
                        <td>{it.cliente_nombre}</td>
                        <td>{it.producto}</td>
                        <td className="num">{numero(it.cantidad)}</td>
                        <td className="num">{pesos(it.precio_unitario)}</td>
                        <td className="num">{pesos(it.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="comp-totales">
                  <div><span>Ventas</span><span className="num">{numero(data.cantidad_ventas)}</span></div>
                  <div className="comp-total"><span>TOTAL VENDIDO</span><span className="num">{pesos(data.total_vendido)}</span></div>
                </div>
              </>
            )}

            <div className="comp-pie">Generado el {fecha(new Date().toISOString().slice(0, 10))} — {NEGOCIO.nombre}</div>
          </div>
        )}
      </div>
    </div>
  );
}
