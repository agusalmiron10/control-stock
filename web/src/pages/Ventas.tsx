import { useState } from "react";
import { api } from "../api";
import { pesos, fecha, numero, hoyISO, diaISO } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { Comprobante } from "../components/Comprobante";
import { ComprobanteFiscal } from "../components/ComprobanteFiscal";
import { EmitirFacturaModal } from "../components/EmitirFacturaModal";
import { DetalleVentaModal } from "../components/DetalleVentaModal";
import { ReporteVentasPDF } from "../components/ReporteVentasPDF";
import { exportarVentasLista } from "../excel";
import { navegar } from "../lib/router";
import { useFacturacionLista } from "../lib/facturacion";
import { useCapacidades } from "../lib/config";

const LETRA_POR_TIPO: Record<number, string> = { 1: "A", 6: "B", 11: "C" };

/** "▲ 20% vs. ayer" — mismo lenguaje visual que ya usa el panel para el mes. */
function VariacionDia({ actual, anterior }: { actual: number; anterior: number }) {
  if (!anterior) return null;
  const pct = Math.round(((actual - anterior) / anterior) * 1000) / 10;
  const sube = pct >= 0;
  return (
    <span className={sube ? "saldado" : "debe"} style={{ fontSize: 12, fontWeight: 600 }}>
      {sube ? "▲" : "▼"} {Math.abs(pct)}% vs. ayer
    </span>
  );
}

type ColumnaOrden = "total" | "saldo";
const ESTADOS_PAGO = [
  { id: "", label: "Todas" },
  { id: "pagada", label: "Pagadas" },
  { id: "debe", label: "Con saldo" },
] as const;

export function Ventas() {
  // Por defecto, hoy — no todo el historial. Se ve altiro lo que importa
  // (lo que se vendió hoy), y ver otra fecha es tocar el campo, no una
  // acción aparte.
  const hoyDefault = hoyISO();
  const [desde, setDesde] = useState(hoyDefault);
  const [hasta, setHasta] = useState(hoyDefault);
  const [clienteId, setClienteId] = useState("");
  const [estadoPago, setEstadoPago] = useState<"" | "pagada" | "debe">("");
  const [orden, setOrden] = useState<{ col: ColumnaOrden; dir: "asc" | "desc" } | null>(null);
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
  const { requiere_numero_serie } = useCapacidades();
  const [buscarSerie, setBuscarSerie] = useState("");

  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);
  if (clienteId) qs.set("cliente_id", clienteId);

  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/ventas?${qs}`), [desde, hasta, clienteId]);
  const clientesQ = useCarga<any>(() => api.get("/api/clientes"), []);
  // Independiente de los filtros de arriba: "hoy" y "ayer" siempre son hoy y
  // ayer, sin importar qué rango de fechas esté mirando el usuario en la
  // tabla. Un solo pedido para los dos días (en vez de dos) para comparar.
  const hoy = hoyISO();
  const ayer = diaISO(-1);
  const hoyQ = useCarga<any>(() => api.get(`/api/ventas?desde=${ayer}&hasta=${hoy}`), [hoy]);
  const activa = (v: any) => v.estado === "sincronizada" || v.estado === "confirmada";
  const ventasHoy = (hoyQ.data?.ventas ?? []).filter((v: any) => v.fecha === hoy && activa(v));
  const ventasAyer = (hoyQ.data?.ventas ?? []).filter((v: any) => v.fecha === ayer && activa(v));
  const totalHoy = ventasHoy.reduce((acc: number, v: any) => acc + v.total, 0);
  const totalAyer = ventasAyer.reduce((acc: number, v: any) => acc + v.total, 0);
  const clienteNombre = clienteId ? clientesQ.data?.clientes.find((c: any) => String(c.id) === clienteId)?.nombre : undefined;

  // Estado de pago: se filtra en el navegador (ya viene calculado por fila
  // desde el back), y el orden por columna se aplica sobre ese resultado ya
  // filtrado — así Excel y pantalla siempre muestran exactamente lo mismo.
  let ventasVista: any[] = data?.ventas ?? [];
  if (estadoPago === "pagada") ventasVista = ventasVista.filter((v) => v.estado_pago === "pagada");
  else if (estadoPago === "debe") ventasVista = ventasVista.filter((v) => v.estado_pago === "parcial" || v.estado_pago === "impaga");
  if (orden) {
    const { col, dir } = orden;
    ventasVista = [...ventasVista].sort((a, b) => (dir === "asc" ? a[col] - b[col] : b[col] - a[col]));
  }

  function ordenarPor(col: ColumnaOrden) {
    setOrden((o) => (o?.col === col ? { col, dir: o.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }));
  }
  function flechaOrden(col: ColumnaOrden): string {
    if (orden?.col !== col) return "";
    return orden.dir === "desc" ? " ▼" : " ▲";
  }

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

  // "Hay filtro" ahora es "distinto del default (hoy)", no "hay algo
  // cargado" — si no, el botón Limpiar aparecería siempre, hasta apenas
  // entrar a la pantalla.
  const hayFiltro = desde !== hoyDefault || hasta !== hoyDefault || clienteId || estadoPago;

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Ventas</h1>
        <div className="btn-grupo">
          <button className="btn" disabled={!ventasVista.length}
            onClick={() => exportarVentasLista(ventasVista, { desde, hasta, cliente: clienteNombre })}>
            ⬇ Descargar Excel
          </button>
          <button className="btn" onClick={() => setMostrarPDF(true)}>⬇ Descargar PDF</button>
          <button className="btn primario" onClick={() => navegar("/ventas/nueva")}>+ Nueva venta</button>
        </div>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="grid-kpi" style={{ gridTemplateColumns: "minmax(190px, 220px)" }}>
        <div className="kpi">
          <div className="rot">Ventas de hoy</div>
          <div className="val">{numero(ventasHoy.length)}</div>
          <div className="mut">{pesos(totalHoy)}</div>
          <VariacionDia actual={totalHoy} anterior={totalAyer} />
        </div>
      </div>

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
        <div className="campo">
          <label>Estado de pago</label>
          <select value={estadoPago} onChange={(e) => setEstadoPago(e.target.value as any)}>
            {ESTADOS_PAGO.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
        {(desde || hasta) && (
          <button type="button" className="btn" onClick={() => { setDesde(""); setHasta(""); }}>
            Ver todas las fechas
          </button>
        )}
        {hayFiltro && (
          <button className="btn" onClick={() => { setDesde(hoyDefault); setHasta(hoyDefault); setClienteId(""); setEstadoPago(""); }}>
            Volver a hoy
          </button>
        )}
      </div>

      {requiere_numero_serie && (
        <BuscarPorSerie valor={buscarSerie} onCambiar={setBuscarSerie} />
      )}

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : data?.ventas.length === 0 ? (
        <Vacio mensaje="No hay ventas en este período."
          accion={<button className="btn primario" onClick={() => navegar("/ventas/nueva")}>Cargar la primera venta</button>} />
      ) : ventasVista.length === 0 ? (
        <Vacio mensaje="Ninguna venta de este período coincide con ese estado de pago." />
      ) : (
        <div className="card">
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead>
                <tr><th className="num">N°</th><th>Fecha</th><th>Cliente</th>
                  <th className="num ord" onClick={() => ordenarPor("total")} style={{ cursor: "pointer" }}>Total{flechaOrden("total")}</th>
                  <th className="num">Pagado</th>
                  <th className="num ord" onClick={() => ordenarPor("saldo")} style={{ cursor: "pointer" }}>Saldo{flechaOrden("saldo")}</th>
                  <th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {ventasVista.map((v: any) => (
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
            {ventasVista.map((v: any) => (
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


/**
 * "Vino uno con este aparato en la mano": buscar a quién y cuándo se le
 * vendió una serie. Es la única razón por la que se cargan las series.
 */
function BuscarPorSerie({ valor, onCambiar }: { valor: string; onCambiar: (v: string) => void }) {
  const [resultados, setResultados] = useState<any[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buscar() {
    if (valor.trim().length < 3) { setError("Escribí al menos 3 caracteres."); return; }
    setError(null);
    setBuscando(true);
    try {
      const r = await api.get<{ resultados: any[] }>(`/api/ventas/serie/${encodeURIComponent(valor.trim())}`);
      setResultados(r.resultados);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="card">
      <div className="card-body">
        <div className="tf-datos" style={{ gap: 8 }}>
          <input
            value={valor}
            onChange={(e) => onCambiar(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") buscar(); }}
            placeholder="Buscar por número de serie…"
            style={{ maxWidth: 280 }}
          />
          <button className="btn" disabled={buscando} onClick={buscar}>
            {buscando ? "Buscando…" : "Buscar serie"}
          </button>
          {resultados && (
            <button className="btn chico" onClick={() => { setResultados(null); onCambiar(""); }}>Limpiar</button>
          )}
        </div>
        <Error msg={error} />

        {resultados && (resultados.length === 0 ? (
          <p className="mut" style={{ marginBottom: 0 }}>Ninguna venta con esa serie.</p>
        ) : (
          <div className="tabla-wrap" style={{ marginTop: 10 }}>
            <table className="tabla">
              <thead>
                <tr><th>Serie</th><th>Producto</th><th>Cliente</th><th>Venta</th><th>Fecha</th></tr>
              </thead>
              <tbody>
                {resultados.map((r, i) => (
                  <tr key={i} className={r.estado === "anulada" ? "archivado" : ""}>
                    <td className="mono">{r.serie}</td>
                    <td>{r.producto}</td>
                    <td><a href={`#/clientes/${r.cliente_id}`}>{r.cliente_nombre}</a></td>
                    <td className="num">
                      #{r.venta_numero}
                      {r.estado === "anulada" && <span className="badge anulada" style={{ marginLeft: 6 }}>anulada</span>}
                    </td>
                    <td className="num">{fecha(r.fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
