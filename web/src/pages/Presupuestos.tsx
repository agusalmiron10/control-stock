import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { PresupuestoPDF } from "../components/PresupuestoPDF";
import { navegar } from "../lib/router";

const ESTADOS = ["pendiente", "aceptado", "rechazado", "vencido"] as const;

export function Presupuestos() {
  const [estado, setEstado] = useState("");
  const [pdfId, setPdfId] = useState<number | null>(null);
  const [eliminar, setEliminar] = useState<any | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (estado) qs.set("estado", estado);
  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/presupuestos?${qs}`), [estado]);

  async function hacerEliminar() {
    if (!eliminar) return;
    try {
      await api.del(`/api/presupuestos/${eliminar.id}`);
      setAviso(`Presupuesto #${eliminar.numero} eliminado.`);
      setEliminar(null);
      recargar();
    } catch (err: any) {
      setAviso(err.message);
      setEliminar(null);
    }
  }

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Presupuestos</h1>
        <button className="btn primario" onClick={() => navegar("/presupuestos/nuevo")}>+ Nuevo presupuesto</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

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
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => navegar(`/presupuestos/${p.id}`)}>Ver</button>
                        <button className="btn chico" onClick={() => setPdfId(p.id)}>PDF</button>
                        {!p.venta_id && (
                          <button className="btn chico peligro" onClick={() => setEliminar(p)}>Eliminar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pdfId && <PresupuestoPDF presupuestoId={pdfId} onCerrar={() => setPdfId(null)} />}
      {eliminar && (
        <Confirmar
          mensaje={`¿Eliminar el presupuesto #${eliminar.numero} de ${eliminar.cliente_nombre} por ${pesos(eliminar.total)}? Esta acción no se puede deshacer.`}
          textoConfirmar="Eliminar"
          peligro
          onSi={hacerEliminar}
          onNo={() => setEliminar(null)}
        />
      )}
    </div>
  );
}
