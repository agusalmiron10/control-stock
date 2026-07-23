import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { Cargando, Error, Modal, useCarga } from "./ui";

/** Ventana emergente liviana: qué compró un cliente en una venta puntual. */
export function DetalleVentaModal({ ventaId, onCerrar }: { ventaId: number; onCerrar: () => void }) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/ventas/${ventaId}`), [ventaId]);

  return (
    <Modal
      titulo={data ? `Venta #${data.venta.numero} — ${data.venta.cliente_nombre}` : "Detalle de la venta"}
      onCerrar={onCerrar}
      pie={<button className="btn" onClick={onCerrar}>Cerrar</button>}
    >
      {cargando && <Cargando />}
      {error && <Error msg={error} />}
      {data && (
        <div>
          <p className="mut" style={{ marginTop: 0 }}>
            Fecha: <b>{fecha(data.venta.fecha)}</b>
            {data.venta.estado === "anulada" && <span className="comp-anulada"> — ANULADA</span>}
          </p>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr><th>Producto</th><th className="num">Cantidad</th><th className="num">Precio unit.</th><th className="num">Subtotal</th></tr>
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
          <dl className="dt-list" style={{ gridTemplateColumns: "auto auto", marginLeft: "auto", width: 240, marginTop: 12 }}>
            {data.venta.descuento > 0 && <><dt>Subtotal</dt><dd>{pesos(data.venta.subtotal)}</dd></>}
            {data.venta.descuento > 0 && <><dt>Descuento</dt><dd>{pesos(data.venta.descuento)}</dd></>}
            <dt><b>Total</b></dt><dd><b>{pesos(data.venta.total)}</b></dd>
            <dt>Pagado</dt><dd>{pesos(data.venta.pagado)}</dd>
            <dt>Saldo</dt><dd className={data.venta.saldo > 0 ? "debe" : "saldado"}>{pesos(data.venta.saldo)}</dd>
          </dl>
          {data.venta.nota && <p className="mut" style={{ marginTop: 12 }}><b>Nota:</b> {data.venta.nota}</p>}
        </div>
      )}
    </Modal>
  );
}
