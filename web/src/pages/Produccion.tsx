import { useState } from "react";
import { api } from "../api";
import { numero, fecha } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";
import { FormProduccion } from "../components/FormProduccion";

/**
 * Qué conviene fabricar: cruza stock actual + mínimo con la velocidad de
 * venta de los últimos 30/60 días y sugiere una cantidad para volver a
 * tener ~1 mes de stock por delante.
 */
export function Produccion() {
  const { data, error, cargando, recargar } = useCarga<any>(() => api.get("/api/reportes/produccion"), []);
  const [producir, setProducir] = useState<any | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function cerrar(msg?: string) {
    setProducir(null);
    if (msg) setAviso(msg);
    recargar();
  }

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Producción sugerida</h1>
        {data && <span className="mut">Actualizado {fecha(data.generado)}</span>}
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      {error && <Error msg={error} />}

      {cargando ? (
        <Cargando />
      ) : data?.sugeridos.length === 0 ? (
        <Vacio mensaje="No hace falta fabricar nada por ahora: el stock cubre la demanda reciente." />
      ) : (
        <div className="card">
          <h2>Qué conviene fabricar</h2>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Herramienta</th><th>Rubro</th>
                  <th className="num">Stock</th><th className="num">Mínimo</th>
                  <th className="num">Vendido 30d</th><th className="num">Vendido 60d</th>
                  <th className="num">Sugerido</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.sugeridos.map((s: any) => (
                  <tr key={s.id}>
                    <td><a href={`#/herramientas/${s.id}`}>{s.nombre}</a></td>
                    <td>{s.rubro || "—"}</td>
                    <td className={`num ${s.urgente ? "stock-cero" : "stock-bajo"}`}>{numero(s.stock)}</td>
                    <td className="num">{numero(s.stock_minimo)}</td>
                    <td className="num">{numero(s.vendidas_30d)}</td>
                    <td className="num">{numero(s.vendidas_60d)}</td>
                    <td className="num"><b>{numero(s.cantidad_sugerida)}</b></td>
                    <td className="acc">
                      <button className="btn chico primario" onClick={() => setProducir(s)}>Producir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {producir && (
        <FormProduccion
          h={{ id: producir.id, nombre: producir.nombre, stock: producir.stock, costo: producir.costo }}
          onCerrar={cerrar}
        />
      )}
    </div>
  );
}
