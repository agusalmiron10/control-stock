import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";
import { navegar } from "../lib/router";

const ESTADOS = ["pendiente", "aceptado", "rechazado", "vencido"] as const;

export function Presupuestos() {
  const [estado, setEstado] = useState("");
  const qs = new URLSearchParams();
  if (estado) qs.set("estado", estado);
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/presupuestos?${qs}`), [estado]);

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Presupuestos</h1>
        <button className="btn primario" onClick={() => navegar("/presupuestos/nuevo")}>+ Nuevo presupuesto</button>
      </div>

      <div className="barra-filtros">
        <div className="campo">
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </div>

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : data?.presupuestos.length === 0 ? (
        <Vacio mensaje="No hay presupuestos todavía."
          accion={<button className="btn primario" onClick={() => navegar("/presupuestos/nuevo")}>Crear el primero</button>} />
      ) : (
        <div className="card">
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr><th className="num">N°</th><th>Fecha</th><th>Cliente</th><th className="num">Total</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {data.presupuestos.map((p: any) => (
                  <tr key={p.id}>
                    <td className="num">{p.numero}</td>
                    <td className="num">{fecha(p.fecha)}</td>
                    <td><a href={`#/clientes/${p.cliente_id}`}>{p.cliente_nombre}</a></td>
                    <td className="num">{pesos(p.total)}</td>
                    <td><span className={`badge ${p.estado === "aceptado" ? "pagada" : p.estado === "rechazado" ? "impaga" : p.estado === "vencido" ? "anulada" : "parcial"}`}>{p.estado}</span></td>
                    <td className="acc">
                      <button className="btn chico" onClick={() => navegar(`/presupuestos/${p.id}`)}>Ver</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
