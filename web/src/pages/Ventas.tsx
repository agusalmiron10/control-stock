import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { Comprobante } from "../components/Comprobante";
import { ComprobanteFiscal } from "../components/ComprobanteFiscal";
import { EmitirFacturaModal } from "../components/EmitirFacturaModal";
import { DetalleVentaModal } from "../components/DetalleVentaModal";
import { ReporteVentasPDF } from "../components/ReporteVentasPDF";
import { navegar } from "../lib/router";
import { useFacturacionLista } from "../lib/facturacion";

const LETRA_POR_TIPO: Record<number, string> = { 1: "A", 6: "B", 11: "C" };

export function Ventas() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [anular, setAnular] = useState<any | null>(null);
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [comprobanteFiscal, setComprobanteFiscal] = useState<string | null>(null);
  const [emitirFactura, setEmitirFactura] = useState<string | null>(null);
  const [notaCredito, setNotaCredito] = useState<any | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [mostrarPDF, setMostrarPDF] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // El módulo prendido no alcanza: sin certificado cargado no se puede
  // facturar, así que el botón no se ofrece.
  const tieneFacturacion = useFacturacionLista().listo;

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

  async function hacerNotaCredito() {
    if (!notaCredito) return;
    try {
      const r = await api.post<{ cae: string }>(`/api/facturacion/ventas/${notaCredito.id}/nota-credito`);
      setNotaCredito(null);
      setAviso(`Venta #${notaCredito.numero} anulada con Nota de Crédito (CAE ${r.cae}).`);
      recargar();
    } catch (err: any) { setAviso(err.message); setNotaCredito(null); }
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
          <div className="tabla-wrap solo-escritorio">
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
                        {v.factura_estado === "autorizada" ? (
                          <>
                            <span className="badge pagada">Fact. {LETRA_POR_TIPO[v.factura_tipo] ?? ""}</span>
                            <button className="btn chico" onClick={() => setComprobanteFiscal(v.id)}>Factura</button>
                          </>
                        ) : (
                          <button className="btn chico" onClick={() => setComprobante(v.id)}>Comprobante</button>
                        )}
                        {tieneFacturacion && v.estado !== "anulada" && v.factura_estado !== "autorizada" && (
                          <button className="btn chico" onClick={() => setEmitirFactura(v.id)}>Facturar</button>
                        )}
                        {v.estado !== "anulada" && (
                          v.factura_estado === "autorizada" ? (
                            <button className="btn chico peligro" onClick={() => setNotaCredito(v)}>Anular (NC)</button>
                          ) : (
                            <button className="btn chico peligro" onClick={() => setAnular(v)}>Anular</button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-body solo-movil lista-tarjetas">
            {data.ventas.map((v: any) => (
              <div className="tarjeta-fila" key={v.id}>
                <div className="tf-titulo">
                  #{v.numero} — <a href={`#/clientes/${v.cliente_id}`}>{v.cliente_nombre}</a>
                  <span className="mut" style={{ fontWeight: 400 }}> · {fecha(v.fecha)}</span>
                </div>
                <div className="tf-datos">
                  <span className="num">{pesos(v.total)}</span>
                  <span className={`badge ${v.estado}`}>{v.estado}</span>
                  {v.saldo > 0 && <span className="num debe">Debe {pesos(v.saldo)}</span>}
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico" onClick={() => setDetalle(v.id)}>Detalle</button>
                  {v.factura_estado === "autorizada" ? (
                    <button className="btn chico" onClick={() => setComprobanteFiscal(v.id)}>Factura {LETRA_POR_TIPO[v.factura_tipo] ?? ""}</button>
                  ) : (
                    <button className="btn chico" onClick={() => setComprobante(v.id)}>Comprobante</button>
                  )}
                  {tieneFacturacion && v.estado !== "anulada" && v.factura_estado !== "autorizada" && (
                    <button className="btn chico" onClick={() => setEmitirFactura(v.id)}>Facturar</button>
                  )}
                  {v.estado !== "anulada" && (
                    v.factura_estado === "autorizada" ? (
                      <button className="btn chico peligro" onClick={() => setNotaCredito(v)}>Anular (NC)</button>
                    ) : (
                      <button className="btn chico peligro" onClick={() => setAnular(v)}>Anular</button>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {detalle && <DetalleVentaModal ventaId={detalle} onCerrar={() => setDetalle(null)} />}
      {comprobante && <Comprobante ventaId={comprobante} onCerrar={() => setComprobante(null)} />}
      {comprobanteFiscal && <ComprobanteFiscal ventaId={comprobanteFiscal} onCerrar={() => setComprobanteFiscal(null)} />}
      {emitirFactura && (
        <EmitirFacturaModal
          ventaId={emitirFactura}
          onCerrar={(mensaje) => { setEmitirFactura(null); if (mensaje) { setAviso(mensaje); recargar(); } }}
        />
      )}
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
      {notaCredito && (
        <Confirmar
          mensaje={`La venta #${notaCredito.numero} de ${notaCredito.cliente_nombre} ya tiene una factura con CAE. Para anularla se emite una Nota de Crédito por ${pesos(notaCredito.total)} y recién después se devuelve el stock y se liberan los pagos. ¿Confirmás?`}
          textoConfirmar="Emitir Nota de Crédito y anular" peligro onSi={hacerNotaCredito} onNo={() => setNotaCredito(null)}
        />
      )}
    </div>
  );
}
