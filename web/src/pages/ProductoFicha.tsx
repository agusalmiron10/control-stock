import { api } from "../api";
import { pesos, numero, fecha } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";
import { useRol, esDueno } from "../lib/rol";

const TIPO_MOV: Record<string, string> = {
  alta: "Alta", produccion: "Producción", venta: "Venta", ajuste: "Ajuste", anulacion: "Anulación",
};

export function ProductoFicha({ id }: { id: string }) {
  const rol = useRol();
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/herramientas/${id}/ficha`), [id]);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data) return null;
  const h = data.herramienta;
  const bajo = h.stock <= h.stock_minimo;
  const cero = h.stock <= 0;

  return (
    <div>
      <div className="encabezado-seccion">
        <div>
          <a href="#/herramientas">← Herramientas</a>
          <h1 style={{ marginTop: 4 }}>{h.codigo} — {h.nombre} {!h.activo && <span className="mut">(archivada)</span>}</h1>
        </div>
      </div>

      <div className="grid-kpi">
        <div className="kpi"><div className="rot">Stock</div>
          <div className={`val ${cero ? "debe" : bajo ? "stock-bajo" : ""}`}>{numero(h.stock)}</div>
          <div className="mut">mínimo {numero(h.stock_minimo)}</div></div>
        <div className="kpi"><div className="rot">Minorista</div><div className="val">{pesos(h.precio)}</div></div>
        <div className="kpi"><div className="rot">Mayorista</div><div className="val">{pesos(h.precio_mayor)}</div></div>
        <div className="kpi"><div className="rot">Unidades vendidas</div><div className="val">{numero(data.unidades_vendidas)}</div>
          <div className="mut">{pesos(data.total_vendido)} facturado</div></div>
        {esDueno(rol) && (
          <>
            <div className="kpi"><div className="rot">Ganancia estimada</div><div className="val saldado">{pesos(data.ganancia_estimada)}</div></div>
            <div className="kpi"><div className="rot">Stock a costo</div><div className="val">{pesos(data.valor_stock_costo)}</div></div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Datos</h2>
        <div className="card-body">
          <dl className="dt-list">
            <dt>Rubro</dt><dd>{h.rubro ?? "—"}</dd>
            {esDueno(rol) && <><dt>Costo</dt><dd>{pesos(h.costo)}</dd></>}
            <dt>Notas</dt><dd>{h.notas ?? "—"}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <h2>Quiénes lo compraron</h2>
        <div className="tabla-wrap solo-escritorio">
          {data.compradores.length === 0 ? (
            <Vacio mensaje="Todavía no se vendió este producto." />
          ) : (
            <table className="tabla">
              <thead><tr><th>Cliente</th><th className="num">Unidades</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.compradores.map((c: any) => (
                  <tr key={c.cliente_id}>
                    <td><a href={`#/clientes/${c.cliente_id}`}>{c.nombre}</a></td>
                    <td className="num">{numero(c.unidades)}</td>
                    <td className="num">{pesos(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {data.compradores.length === 0 ? (
          <div className="solo-movil"><Vacio mensaje="Todavía no se vendió este producto." /></div>
        ) : (
          <div className="card-body solo-movil lista-tarjetas">
            {data.compradores.map((c: any) => (
              <div className="tarjeta-fila" key={c.cliente_id}>
                <div className="tf-titulo"><a href={`#/clientes/${c.cliente_id}`}>{c.nombre}</a></div>
                <div className="tf-datos">
                  <span>{numero(c.unidades)} unidades</span>
                  <span className="num">{pesos(c.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Historial de precios</h2>
        <div className="tabla-wrap solo-escritorio">
          {data.historial_precios.length === 0 ? (
            <Vacio mensaje="Sin cambios de precio registrados." />
          ) : (
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Lista</th><th className="num">Antes</th><th className="num">Ahora</th><th>Motivo</th></tr></thead>
              <tbody>
                {data.historial_precios.map((p: any) => (
                  <tr key={p.id}>
                    <td className="num">{fecha(p.fecha)}</td>
                    <td>{p.tipo_precio}</td>
                    <td className="num">{pesos(p.precio_anterior)}</td>
                    <td className="num">{pesos(p.precio_nuevo)}</td>
                    <td>{p.motivo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {data.historial_precios.length === 0 ? (
          <div className="solo-movil"><Vacio mensaje="Sin cambios de precio registrados." /></div>
        ) : (
          <div className="card-body solo-movil lista-tarjetas">
            {data.historial_precios.map((p: any) => (
              <div className="tarjeta-fila" key={p.id}>
                <div className="tf-titulo">{p.tipo_precio} <span className="mut" style={{ fontWeight: 400 }}>· {fecha(p.fecha)}</span></div>
                <div className="tf-datos">
                  <span className="num">{pesos(p.precio_anterior)} → {pesos(p.precio_nuevo)}</span>
                  {p.motivo && <span className="mut">{p.motivo}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Movimientos de stock</h2>
        <div className="tabla-wrap solo-escritorio">
          {data.movimientos.length === 0 ? (
            <Vacio mensaje="Sin movimientos de stock." />
          ) : (
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cant.</th><th className="num">Stock</th><th>Motivo / Ref.</th></tr></thead>
              <tbody>
                {data.movimientos.map((m: any) => (
                  <tr key={m.id}>
                    <td className="num">{fecha(m.fecha)}</td>
                    <td>{TIPO_MOV[m.tipo] ?? m.tipo}</td>
                    <td className={`num ${m.cantidad < 0 ? "debe" : "saldado"}`}>{m.cantidad > 0 ? "+" : ""}{numero(m.cantidad)}</td>
                    <td className="num">{numero(m.stock_resultante)}</td>
                    <td>{m.venta_numero ? `Venta #${m.venta_numero}` : m.motivo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {data.movimientos.length === 0 ? (
          <div className="solo-movil"><Vacio mensaje="Sin movimientos de stock." /></div>
        ) : (
          <div className="card-body solo-movil lista-tarjetas">
            {data.movimientos.map((m: any) => (
              <div className="tarjeta-fila" key={m.id}>
                <div className="tf-titulo">{TIPO_MOV[m.tipo] ?? m.tipo} <span className="mut" style={{ fontWeight: 400 }}>· {fecha(m.fecha)}</span></div>
                <div className="tf-datos">
                  <span className={`num ${m.cantidad < 0 ? "debe" : "saldado"}`}>{m.cantidad > 0 ? "+" : ""}{numero(m.cantidad)}</span>
                  <span className="num">Stock: {numero(m.stock_resultante)}</span>
                  <span className="mut">{m.venta_numero ? `Venta #${m.venta_numero}` : m.motivo ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
