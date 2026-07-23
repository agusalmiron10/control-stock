import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { Comprobante } from "../components/Comprobante";
import { DetalleVentaModal } from "../components/DetalleVentaModal";
import { ReporteVentasPDF } from "../components/ReporteVentasPDF";
import { navegar } from "../lib/router";

export function Ventas() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [anular, setAnular] = useState<any | null>(null);
  const [comprobante, setComprobante] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<number | null>(null);
  const [mostrarPDF, setMostrarPDF] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);
  if (clienteId) qs.set("cliente_id", clienteId);

  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/ventas?${qs}`), [desde, hasta, clienteId]);
  const clientesQ = useCarga<any>(() => api.get("/api/clientes"), []);
  const clienteNombre = clienteId ? clientesQ.data?.clientes.find((c: any) => String(c.id) === clienteId)?.nombre : undefined;

  async function hacerAnular() {
    if (!anular) return;
    try {
      await api.post(`/api/ventas/${anular.id}/anular`);
      setAnular(null);
      setAviso(`Venta #${anular.numero} anulada.`);
      recargar();
    } catch (err: any) { setAviso(err.message); setAnular(null); }
  }

  const hayFiltro = desde || hasta || clienteId;

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Ventas</h1>
        <div className="btn-grupo">
          <button className="btn" onClick={() => setMostrarPDF(true)}>⬇ Descargar PDF</button>
          <button className="btn primario" onClick={() => navegar("/ventas/nueva")}>+ Nueva venta</button>
        </div>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="barra-filtros">
        <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <div className="campo" style={{ minWidth: 200 }}>
          <label>Cliente</label>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Todos</option>
            {(clientesQ.data?.clientes ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        {hayFiltro && <button className="btn" onClick={() => { setDesde(""); setHasta(""); setClienteId(""); }}>Limpiar</button>}
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
                        <button className="btn chico" onClick={() => setDetalle(v.id)}>Detalle</button>
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

      {detalle && <DetalleVentaModal ventaId={detalle} onCerrar={() => setDetalle(null)} />}
      {comprobante && <Comprobante ventaId={comprobante} onCerrar={() => setComprobante(null)} />}
      {mostrarPDF && (
        <ReporteVentasPDF
          desde={desde}
          hasta={hasta}
          clienteId={clienteId || undefined}
          clienteNombre={clienteNombre}
          onCerrar={() => setMostrarPDF(false)}
        />
      )}
      {anular && (
        <Confirmar mensaje={`¿Anular la venta #${anular.numero} de ${anular.cliente_nombre} por ${pesos(anular.total)}? Devuelve el stock y libera los pagos.`}
          textoConfirmar="Anular venta" peligro onSi={hacerAnular} onNo={() => setAnular(null)} />
      )}
    </div>
  );
}
