import { useState } from "react";
import { api } from "../api";
import { fecha, numero } from "../format";
import { Modal, Error, Cargando, Campo, Confirmar, useCarga } from "./ui";

const BADGE: Record<string, string> = {
  entregado: "pagada",
  pendiente: "parcial",
  anulado: "anulada",
};

interface Props {
  id: string;
  onCerrar: () => void;
  onCambio: (mensaje: string) => void;
  /** Abre el remito imprimible. Va afuera porque imprimir el modal sale en blanco. */
  onImprimir: (id: string) => void;
}

/** Ficha del remito: qué se entregó, a quién, y quién lo recibió. */
export function RemitoDetalle({ id, onCerrar, onCambio, onImprimir }: Props) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/remitos/${id}`), [id]);
  const [recibidoPor, setRecibidoPor] = useState("");
  const [anular, setAnular] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const r = data?.remito;

  async function marcarEntregado() {
    setErr(null);
    setTrabajando(true);
    try {
      await api.post(`/api/remitos/${id}/estado`, { estado: "entregado", recibido_por: recibidoPor || null });
      onCambio(`Remito #${r.numero} marcado como entregado.`);
    } catch (e: any) {
      setErr(e.message);
      setTrabajando(false);
    }
  }

  async function hacerAnular() {
    setErr(null);
    setTrabajando(true);
    try {
      await api.post(`/api/remitos/${id}/anular`);
      onCambio(`Remito #${r.numero} anulado. Lo que llevaba vuelve a quedar pendiente de entrega.`);
    } catch (e: any) {
      setErr(e.message);
      setAnular(false);
      setTrabajando(false);
    }
  }

  return (
    <Modal titulo={r ? `Remito #${r.numero}` : "Remito"} ancho onCerrar={onCerrar}>
      <Error msg={err ?? error} />
      {cargando ? (
        <Cargando />
      ) : !r ? null : (
        <>
          <div className="tf-datos" style={{ marginBottom: 14 }}>
            <span className={`badge ${BADGE[r.estado] ?? ""}`}>{r.estado}</span>
            <span className="mut">Venta #{r.venta_numero} del {fecha(r.venta_fecha)}</span>
          </div>

          <h3 style={{ marginBottom: 4 }}>Entrega</h3>
          <dl className="detalle-filas">
            <div className="detalle-fila"><dt>Cliente</dt><dd>{r.cliente_nombre}</dd></div>
            {r.cliente_telefono && (
              <div className="detalle-fila"><dt>Teléfono</dt><dd>{r.cliente_telefono}</dd></div>
            )}
            <div className="detalle-fila"><dt>Fecha</dt><dd>{fecha(r.fecha)}</dd></div>
            {r.domicilio && <div className="detalle-fila"><dt>Domicilio</dt><dd>{r.domicilio}</dd></div>}
            {r.transporte && <div className="detalle-fila"><dt>Transporte</dt><dd>{r.transporte}</dd></div>}
            {r.recibido_por && <div className="detalle-fila"><dt>Recibió</dt><dd>{r.recibido_por}</dd></div>}
            {r.entregado_en && (
              <div className="detalle-fila"><dt>Entregado</dt><dd>{fecha(r.entregado_en.slice(0, 10))}</dd></div>
            )}
          </dl>

          <h3 style={{ marginBottom: 4, marginTop: 18 }}>Qué se entregó</h3>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead><tr><th>Producto</th><th className="num">Cantidad</th></tr></thead>
              <tbody>
                {data.items.map((it: any) => (
                  <tr key={it.id}>
                    <td>{it.nombre_herramienta}</td>
                    <td className="num">{numero(it.cantidad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {r.nota && (
            <>
              <h3 style={{ marginBottom: 4, marginTop: 18 }}>Nota</h3>
              <p className="mut" style={{ marginTop: 0 }}>{r.nota}</p>
            </>
          )}

          {r.estado === "pendiente" && (
            <div style={{ marginTop: 18 }}>
              <Campo label="¿Quién lo recibió? (opcional)">
                <input value={recibidoPor} onChange={(e) => setRecibidoPor(e.target.value)} placeholder="Nombre de quien firmó" />
              </Campo>
            </div>
          )}

          <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" onClick={onCerrar}>Cerrar</button>
            <button className="btn" onClick={() => onImprimir(id)}>Imprimir</button>
            {r.estado !== "anulado" && (
              <button className="btn peligro" disabled={trabajando} onClick={() => setAnular(true)}>Anular</button>
            )}
            {r.estado === "pendiente" && (
              <button className="btn primario" disabled={trabajando} onClick={marcarEntregado}>
                {trabajando ? "Guardando…" : "Marcar entregado"}
              </button>
            )}
          </div>
        </>
      )}

      {anular && (
        <Confirmar
          mensaje={`¿Anular el remito #${r?.numero}? Lo que llevaba vuelve a quedar pendiente de entrega y se puede remitar de nuevo. El stock no se toca.`}
          textoConfirmar="Anular"
          peligro
          onSi={hacerAnular}
          onNo={() => setAnular(false)}
        />
      )}
    </Modal>
  );
}
