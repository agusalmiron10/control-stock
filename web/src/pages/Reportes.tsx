import { useState } from "react";
import { api } from "../api";
import { pesos, pesosCompacto, numero, fecha, mesCorto, hoyISO } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";
import { BarChart } from "../components/BarChart";
import { useRol, esDueno } from "../lib/rol";

const TABS = [
  ["rentabilidad", "Rentabilidad", true],
  ["evolucion", "Evolución", false],
  ["caja", "Caja del día", false],
] as const;

export function Reportes() {
  const rol = useRol();
  const [tab, setTab] = useState<string>(esDueno(rol) ? "rentabilidad" : "evolucion");
  const tabs = TABS.filter(([, , soloDueno]) => !soloDueno || esDueno(rol));

  return (
    <div>
      <div className="encabezado-seccion"><h1>Reportes</h1></div>

      <div className="btn-grupo" style={{ marginBottom: 16 }}>
        {tabs.map(([key, label]) => (
          <button key={key} className={`btn ${tab === key ? "primario" : ""}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === "rentabilidad" && esDueno(rol) && <Rentabilidad />}
      {tab === "evolucion" && <Evolucion />}
      {tab === "caja" && <CajaDia />}
    </div>
  );
}

function Rentabilidad() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/reportes/rentabilidad?${qs}`), [desde, hasta]);

  const r = data?.resumen;
  const productos: any[] = data?.productos ?? [];
  const conVentas = productos.filter((p) => p.unidades_vendidas > 0);
  const maxGanancia = Math.max(1, ...conVentas.map((p) => p.ganancia));

  return (
    <div>
      <div className="barra-filtros">
        <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        {(desde || hasta) && <button className="btn" onClick={() => { setDesde(""); setHasta(""); }}>Limpiar</button>}
      </div>

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : !r ? null : (
        <>
          <div className="grid-kpi">
            <div className="kpi"><div className="rot">Vendido (período)</div><div className="val">{pesos(r.total_vendido)}</div></div>
            <div className="kpi"><div className="rot">Costo estimado</div><div className="val">{pesos(r.costo_estimado)}</div></div>
            <div className="kpi"><div className="rot">Ganancia estimada</div><div className="val saldado">{pesos(r.ganancia_estimada)}</div>
              <div className="mut">margen {r.margen_pct}%</div></div>
            <div className="kpi"><div className="rot">Stock (a costo)</div><div className="val">{pesos(r.valor_stock_costo)}</div>
              <div className="mut">a precio venta {pesos(r.valor_stock_venta)}</div></div>
          </div>

          <p className="mut" style={{ marginTop: -6 }}>
            La ganancia es <b>estimada</b>: usa el costo actual de cada herramienta por las unidades vendidas.
          </p>

          {conVentas.length === 0 ? (
            <Vacio mensaje="Todavía no hay ventas en el período para calcular rentabilidad." />
          ) : (
            <div className="card">
              <h2>Por producto (más ganancia primero)</h2>
              <div className="tabla-wrap">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Producto</th><th>Rubro</th><th className="num">U. vend.</th>
                      <th className="num">Vendido</th><th className="num">Costo</th>
                      <th className="num">Ganancia</th><th className="num">Margen</th><th style={{ width: 140 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {conVentas.map((p) => (
                      <tr key={p.id}>
                        <td>{p.nombre}</td>
                        <td>{p.rubro || "—"}</td>
                        <td className="num">{numero(p.unidades_vendidas)}</td>
                        <td className="num">{pesos(p.vendido)}</td>
                        <td className="num">{pesos(p.costo_estimado)}</td>
                        <td className={`num ${p.ganancia >= 0 ? "saldado" : "debe"}`}>{pesos(p.ganancia)}</td>
                        <td className="num">{p.margen_pct}%</td>
                        <td>
                          <div className="barra-mini">
                            <div className="barra-mini-fill" style={{ width: `${Math.max(2, (p.ganancia / maxGanancia) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Evolucion() {
  const { data, error, cargando } = useCarga<any>(() => api.get("/api/reportes/evolucion?meses=6"), []);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data) return null;

  const ventas = data.evolucion.map((e: any) => ({ label: mesCorto(e.mes), valor: e.ventas_total }));
  const cobranzas = data.evolucion.map((e: any) => ({ label: mesCorto(e.mes), valor: e.cobranzas_total }));
  const deuda = (data.deuda_diaria ?? []).map((d: any) => ({ label: fecha(d.fecha).slice(0, 5), valor: d.saldo_pendiente }));

  return (
    <div>
      <div className="card">
        <h2>Ventas por mes (últimos 6)</h2>
        <div className="card-body">
          <BarChart datos={ventas} color="var(--acento)" formato={pesos} formatoEtiqueta={pesosCompacto} />
        </div>
      </div>
      <div className="card">
        <h2>Cobranzas por mes (últimos 6)</h2>
        <div className="card-body">
          <BarChart datos={cobranzas} color="var(--verde)" formato={pesos} formatoEtiqueta={pesosCompacto} />
        </div>
      </div>
      {deuda.length > 1 && (
        <div className="card">
          <h2>Deuda total pendiente (últimos días)</h2>
          <div className="card-body">
            <BarChart datos={deuda} color="var(--rojo)" formato={pesos} formatoEtiqueta={pesosCompacto} />
            <p className="mut" style={{ marginTop: 8 }}>
              Se arma solo con el resumen automático de cada madrugada — va a tener más historial con el correr de los días.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const MEDIO_LABEL: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", cheque: "Cheque", otro: "Otro",
};

function CajaDia() {
  const [fechaSel, setFechaSel] = useState(hoyISO());
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/reportes/caja?fecha=${fechaSel}`), [fechaSel]);

  return (
    <div>
      <div className="barra-filtros">
        <div className="campo"><label>Fecha</label><input type="date" value={fechaSel} onChange={(e) => setFechaSel(e.target.value)} /></div>
        {fechaSel !== hoyISO() && <button className="btn" onClick={() => setFechaSel(hoyISO())}>Hoy</button>}
      </div>

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : !data ? null : (
        <>
          <div className="grid-kpi">
            <div className="kpi"><div className="rot">Ventas del día</div><div className="val">{pesos(data.ventas_total)}</div>
              <div className="mut">{numero(data.ventas_cant)} ventas</div></div>
            <div className="kpi"><div className="rot">Cobrado del día</div><div className="val saldado">{pesos(data.cobrado_total)}</div></div>
            {data.por_medio.map((m: any) => (
              <div className="kpi" key={m.medio}>
                <div className="rot">{MEDIO_LABEL[m.medio] ?? m.medio}</div>
                <div className="val">{pesos(m.total)}</div>
                <div className="mut">{numero(m.cant)} pagos</div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Pagos del día</h2>
            <div className="tabla-wrap">
              {data.pagos.length === 0 ? (
                <Vacio mensaje="No hay pagos registrados este día." />
              ) : (
                <table className="tabla">
                  <thead><tr><th>Cliente</th><th className="num">Monto</th><th>Medio</th><th>Aplicado a</th></tr></thead>
                  <tbody>
                    {data.pagos.map((p: any) => (
                      <tr key={p.id}>
                        <td><a href={`#/clientes/${p.cliente_id}`}>{p.cliente_nombre}</a></td>
                        <td className="num saldado">{pesos(p.monto)}</td>
                        <td>{MEDIO_LABEL[p.medio] ?? p.medio}</td>
                        <td>{p.venta_numero ? `Venta #${p.venta_numero}` : <span className="mut">A cuenta</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
