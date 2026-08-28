import { api } from "../api";
import { fecha, numero } from "../format";
import { negocio } from "../lib/negocio";
import { Cargando, Error, useCarga } from "./ui";

/**
 * Remito imprimible. Es el papel que viaja con la mercadería, así que no
 * lleva precios: el que recibe firma que le entregaron las cantidades, no
 * discute plata. Por eso también tiene dos firmas al pie.
 *
 * Va como documento aparte y no como el modal de detalle porque la impresión
 * oculta todo salvo `.comprobante` — un modal impreso sale en blanco.
 */
export function RemitoImprimible({ remitoId, onCerrar }: { remitoId: string; onCerrar: () => void }) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/remitos/${remitoId}`), [remitoId]);
  const r = data?.remito;

  return (
    <div className="comprobante-overlay" onMouseDown={onCerrar}>
      <div className="comprobante-caja" onMouseDown={(e) => e.stopPropagation()}>
        <div className="no-print comprobante-barra">
          <button className="btn" onClick={onCerrar}>Cerrar</button>
          <button className="btn primario" onClick={() => window.print()}>🖨 Imprimir / Guardar PDF</button>
        </div>

        {cargando && <Cargando />}
        {error && <Error msg={error} />}

        {r && (
          <div className="comprobante">
            <div className="comp-header">
              <div>
                <div className="comp-marca">{negocio().nombre}</div>
                <div className="comp-sub">{negocio().rubro}</div>
                <div className="comp-sub">Tel: {negocio().telefono} · {negocio().instagram}</div>
              </div>
              <div className="comp-doc">
                <div className="comp-doc-tit">REMITO</div>
                <div className="comp-doc-num">N° {String(r.numero).padStart(6, "0")}</div>
                <div className="comp-sub">{fecha(r.fecha)}</div>
              </div>
            </div>

            <div className="comp-cliente">
              <b>Cliente:</b> {r.cliente_nombre}
              {r.estado === "anulado" && <span className="comp-anulada"> — ANULADO</span>}
              {r.domicilio && <div><b>Entregar en:</b> {r.domicilio}</div>}
              {r.transporte && <div><b>Transporte:</b> {r.transporte}</div>}
              <div className="comp-sub">Corresponde a la venta N° {r.venta_numero}</div>
            </div>

            <table className="comp-tabla">
              <thead>
                <tr><th>Cant.</th><th>Detalle</th></tr>
              </thead>
              <tbody>
                {data.items.map((it: any) => (
                  <tr key={it.id}>
                    <td className="num">{numero(it.cantidad)}</td>
                    <td>{it.nombre_herramienta}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {r.nota && <p className="comp-sub" style={{ marginTop: 12 }}>{r.nota}</p>}

            <p className="comp-sub" style={{ marginTop: 16 }}>
              Documento no válido como factura. Sirve para acompañar la mercadería.
            </p>

            {/* Dos firmas: la del que entrega y la del que recibe. Es lo que
                convierte al papel en constancia de la entrega. */}
            <div className="comp-firmas">
              <div className="comp-firma">
                <div className="comp-firma-linea" />
                Firma y aclaración de quien entrega
              </div>
              <div className="comp-firma">
                <div className="comp-firma-linea" />
                {r.recibido_por ? `Recibió: ${r.recibido_por}` : "Firma y aclaración de quien recibe"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
