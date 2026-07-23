import { api } from "../api";
import { pesos, numero, fecha } from "../format";
import { Cargando, Error, useCarga } from "../components/ui";
import { navegar } from "../lib/router";
import { waResumenDiario } from "../lib/whatsapp";

export function Panel() {
  const { data, error, cargando } = useCarga<any>(() => api.get("/api/panel"), []);
  const resumenQ = useCarga<any>(() => api.get("/api/reportes/resumen-diario"), []);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data) return null;

  const tipoMov: Record<string, string> = {
    alta: "Alta", produccion: "Producción", venta: "Venta", ajuste: "Ajuste", anulacion: "Anulación",
  };
  const r = resumenQ.data?.resumen;

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Panel</h1>
        <span className="mut">Mes en curso: {data.mes}</span>
      </div>

      {r && (
        <div className="pill-alerta" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, background: "#eef2ff", borderColor: "#c7d2fe", color: "#3730a3" }}>
          <div>
            <b>Resumen de ayer ({fecha(r.fecha)}):</b> vendiste {pesos(r.ventas_total)} ({r.ventas_cant}) y cobraste {pesos(r.cobranzas_total)} ({r.cobranzas_cant}).
            {r.stock_bajo_cant > 0 && <> {r.stock_bajo_cant} producto(s) con stock bajo.</>}
          </div>
          <button className="btn chico wa" onClick={() => waResumenDiario(r)}>Compartir</button>
        </div>
      )}

      <div className="grid-kpi">
        <div className="kpi">
          <div className="rot">Total a cobrar</div>
          <div className="val debe">{pesos(data.total_a_cobrar)}</div>
        </div>
        <div className="kpi">
          <div className="rot">Clientes con deuda</div>
          <div className="val">{numero(data.clientes_con_deuda)}</div>
        </div>
        <div className="kpi">
          <div className="rot">Ventas del mes</div>
          <div className="val">{pesos(data.ventas_mes.total)}</div>
          <div className="mut">{numero(data.ventas_mes.cant)} ventas</div>
        </div>
        <div className="kpi">
          <div className="rot">Cobranzas del mes</div>
          <div className="val saldado">{pesos(data.cobranzas_mes.total)}</div>
          <div className="mut">{numero(data.cobranzas_mes.cant)} pagos</div>
        </div>
      </div>

      <div className="card">
        <h2>Los que más deben</h2>
        <div className="tabla-wrap">
          {data.ranking_deudores.length === 0 ? (
            <div className="vacio"><p>Nadie te debe plata. 🎉</p></div>
          ) : (
            <table className="tabla">
              <thead>
                <tr><th>Cliente</th><th className="num">Saldo</th><th></th></tr>
              </thead>
              <tbody>
                {data.ranking_deudores.map((d: any) => (
                  <tr key={d.id}>
                    <td>{d.nombre}</td>
                    <td className="num debe">{pesos(d.saldo)}</td>
                    <td className="acc">
                      <button className="btn chico" onClick={() => navegar(`/clientes/${d.id}`)}>Ver ficha</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Stock bajo o en cero</h2>
        <div className="tabla-wrap">
          {data.herramientas_alerta.length === 0 ? (
            <div className="vacio"><p>Todo el stock está por encima del mínimo.</p></div>
          ) : (
            <table className="tabla">
              <thead>
                <tr><th>Código</th><th>Herramienta</th><th className="num">Stock</th><th className="num">Mínimo</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {data.herramientas_alerta.map((h: any) => (
                  <tr key={h.id}>
                    <td className="num">{h.codigo}</td>
                    <td>{h.nombre}</td>
                    <td className={`num ${h.estado_stock === "cero" ? "stock-cero" : "stock-bajo"}`}>{numero(h.stock)}</td>
                    <td className="num">{numero(h.stock_minimo)}</td>
                    <td>
                      <span className={`badge ${h.estado_stock === "cero" ? "impaga" : "parcial"}`}>
                        {h.estado_stock === "cero" ? "Sin stock" : "Stock bajo"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Últimos movimientos de stock</h2>
        <div className="tabla-wrap">
          {data.ultimos_movimientos.length === 0 ? (
            <div className="vacio"><p>Todavía no hay movimientos.</p></div>
          ) : (
            <table className="tabla">
              <thead>
                <tr><th>Fecha</th><th>Herramienta</th><th>Tipo</th><th className="num">Cant.</th><th className="num">Stock</th></tr>
              </thead>
              <tbody>
                {data.ultimos_movimientos.map((m: any) => (
                  <tr key={m.id}>
                    <td className="num">{fecha(m.fecha)}</td>
                    <td>{m.herramienta_nombre}</td>
                    <td>{tipoMov[m.tipo] ?? m.tipo}</td>
                    <td className={`num ${m.cantidad < 0 ? "debe" : "saldado"}`}>{m.cantidad > 0 ? "+" : ""}{numero(m.cantidad)}</td>
                    <td className="num">{numero(m.stock_resultante)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
