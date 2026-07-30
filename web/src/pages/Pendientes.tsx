import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { DetalleVentaModal } from "../components/DetalleVentaModal";

/** Ventas que llegaron del celular sin revisar, o que se marcaron para
 * revisar (por ejemplo, se vendieron con stock insuficiente). El dueño las
 * repasa acá antes de que cuenten como confirmadas. */
export function Pendientes() {
  const { data, error, cargando, recargar } = useCarga<any>(() => api.get("/api/ventas/pendientes"), []);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [anular, setAnular] = useState<any | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function confirmar(id: string, numero: number) {
    setConfirmando(id);
    try {
      await api.post(`/api/ventas/${id}/confirmar`);
      setAviso(`Venta #${numero} confirmada.`);
      recargar();
    } catch (err: any) {
      setAviso(err.message);
    } finally {
      setConfirmando(null);
    }
  }

  async function hacerAnular() {
    if (!anular) return;
    try {
      await api.post(`/api/ventas/${anular.id}/anular`);
      setAviso(`Venta #${anular.numero} anulada.`);
      setAnular(null);
      recargar();
    } catch (err: any) {
      setAviso(err.message);
      setAnular(null);
    }
  }

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;

  const ventas: any[] = data?.ventas ?? [];

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Pendientes de revisar</h1>
      </div>
      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      {ventas.length === 0 ? (
        <Vacio mensaje="No hay ventas pendientes de revisar." />
      ) : (
        <div className="card">
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Fecha</th><th className="num">N°</th><th>Cliente</th>
                  <th className="num">Total</th><th>Origen</th><th>Motivo</th><th></th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} className={v.necesita_revision ? "" : "mut"}>
                    <td className="num">{fecha(v.fecha)}</td>
                    <td className="num">{v.numero}</td>
                    <td>{v.cliente_nombre}</td>
                    <td className="num">{pesos(v.total)}</td>
                    <td>{v.origen === "celular" ? "📱 Celular" : "🖥 Escritorio"}</td>
                    <td>{v.motivo_revision ? <span className="stock-bajo">{v.motivo_revision}</span> : <span className="mut">—</span>}</td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setDetalle(v.id)}>Detalle</button>
                        <button className="btn chico primario" disabled={confirmando === v.id} onClick={() => confirmar(v.id, v.numero)}>
                          {confirmando === v.id ? "Confirmando…" : "Confirmar"}
                        </button>
                        <button className="btn chico peligro" onClick={() => setAnular(v)}>Anular</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-body solo-movil lista-tarjetas">
            {ventas.map((v) => (
              <div className="tarjeta-fila" key={v.id}>
                <div className="tf-titulo">
                  #{v.numero} — {v.cliente_nombre}
                  <span className="mut" style={{ fontWeight: 400 }}> · {fecha(v.fecha)}</span>
                </div>
                <div className="tf-datos">
                  <span className="num">{pesos(v.total)}</span>
                  <span>{v.origen === "celular" ? "📱 Celular" : "🖥 Escritorio"}</span>
                  {v.motivo_revision && <span className="stock-bajo">{v.motivo_revision}</span>}
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico" onClick={() => setDetalle(v.id)}>Detalle</button>
                  <button className="btn chico primario" disabled={confirmando === v.id} onClick={() => confirmar(v.id, v.numero)}>
                    {confirmando === v.id ? "Confirmando…" : "Confirmar"}
                  </button>
                  <button className="btn chico peligro" onClick={() => setAnular(v)}>Anular</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {detalle && <DetalleVentaModal ventaId={detalle} onCerrar={() => setDetalle(null)} />}
      {anular && (
        <Confirmar mensaje={`¿Anular la venta #${anular.numero} de ${anular.cliente_nombre} por ${pesos(anular.total)}? Devuelve el stock y libera los pagos.`}
          textoConfirmar="Anular venta" peligro onSi={hacerAnular} onNo={() => setAnular(null)} />
      )}
    </div>
  );
}
