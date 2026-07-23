import { useState } from "react";
import { api } from "../api";
import { pesos, numero } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";

export function Reportes() {
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
      <div className="encabezado-seccion"><h1>Rentabilidad</h1></div>

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
