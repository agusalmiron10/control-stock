import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { Comprobante } from "../components/Comprobante";
import { navegar } from "../lib/router";

export function Ventas() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [anular, setAnular] = useState<any | null>(null);
  const [comprobante, setComprobante] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);

  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/ventas?${qs}`), [desde, hasta]);

  async function hacerAnular() {
    if (!anular) return;
    try {
      await api.post(`/api/ventas/${anular.id}/anular`);
      setAnular(null);
      setAviso(`Venta #${anular.numero} anulada.`);
      recargar();
    } catch (err: any) { setAviso(err.message); setAnular(null); }
  }

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Ventas</h1>
        <button className="btn primario" onClick={() => navegar("/ventas/nueva")}>+ Nueva venta</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="barra-filtros">
        <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        {(desde || hasta) && <button className="btn" onClick={() => { setDesde(""); setHasta(""); }}>Limpiar</button>}
      </div>

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : data?.ventas.length === 0 ? (
        <Vacio mensaje="No hay ventas en este período."
          accion={<button className="btn primario" onClick={() => navegar("/ventas/nueva")}>Cargar la primera venta</button>} />
      ) : (
        <div className="card">
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr><th className="num">N°</th><th>Fecha</th><th>Cliente</th>
                  <th className="num">Total</th><th className="num">Pagado</th><th className="num">Saldo</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {data.ventas.map((v: any) => (
                  <tr key={v.id} className={v.estado === "anulada" ? "archivado" : ""}>
                    <td className="num">{v.numero}</td>
                    <td className="num">{fecha(v.fecha)}</td>
                    <td><a href={`#/clientes/${v.cliente_id}`}>{v.cliente_nombre}</a></td>
                    <td className="num">{pesos(v.total)}</td>
                    <td className="num">{pesos(v.pagado)}</td>
                    <td className={`num ${v.saldo > 0 ? "debe" : ""}`}>{pesos(v.saldo)}</td>
                    <td><span className={`badge ${v.estado}`}>{v.estado}</span></td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setComprobante(v.id)}>Comprobante</button>
                        {v.estado !== "anulada" && <button className="btn chico peligro" onClick={() => setAnular(v)}>Anular</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {comprobante && <Comprobante ventaId={comprobante} onCerrar={() => setComprobante(null)} />}
      {anular && (
        <Confirmar mensaje={`¿Anular la venta #${anular.numero} de ${anular.cliente_nombre} por ${pesos(anular.total)}? Devuelve el stock y libera los pagos.`}
          textoConfirmar="Anular venta" peligro onSi={hacerAnular} onNo={() => setAnular(null)} />
      )}
    </div>
  );
}
