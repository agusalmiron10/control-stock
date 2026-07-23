import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { FormPago } from "../components/FormPago";

export function Pagos() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [editar, setEditar] = useState<any | null>(null);
  const [borrar, setBorrar] = useState<any | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);

  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/pagos?${qs}`), [desde, hasta]);

  function actualizar(msg?: string) { if (msg) setAviso(msg); recargar(); }

  async function hacerBorrar() {
    if (!borrar) return;
    await api.del(`/api/pagos/${borrar.id}`);
    setBorrar(null);
    actualizar("Pago eliminado. Se recalculó la cuenta.");
  }

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Pagos</h1>
        <button className="btn primario" onClick={() => setNuevo(true)}>+ Registrar pago</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="barra-filtros">
        <div className="campo"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="campo"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        {(desde || hasta) && <button className="btn" onClick={() => { setDesde(""); setHasta(""); }}>Limpiar</button>}
      </div>

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : data?.pagos.length === 0 ? (
        <Vacio mensaje="No hay pagos en este período."
          accion={<button className="btn primario" onClick={() => setNuevo(true)}>Registrar el primero</button>} />
      ) : (
        <div className="card">
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr><th>Fecha</th><th>Cliente</th><th className="num">Monto</th><th>Medio</th><th>Aplicado a</th><th>Nota</th><th></th></tr>
              </thead>
              <tbody>
                {data.pagos.map((p: any) => (
                  <tr key={p.id}>
                    <td className="num">{fecha(p.fecha)}</td>
                    <td><a href={`#/clientes/${p.cliente_id}`}>{p.cliente_nombre}</a></td>
                    <td className="num saldado">{pesos(p.monto)}</td>
                    <td>{p.medio}</td>
                    <td>{p.venta_numero ? `Venta #${p.venta_numero}` : <span className="mut">A cuenta</span>}</td>
                    <td>{p.nota ?? "—"}</td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setEditar(p)}>Editar</button>
                        <button className="btn chico peligro" onClick={() => setBorrar(p)}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {nuevo && <FormPago onCerrar={(m) => { setNuevo(false); actualizar(m); }} />}
      {editar && <FormPago pago={editar} onCerrar={(m) => { setEditar(null); actualizar(m); }} />}
      {borrar && (
        <Confirmar mensaje={`¿Borrar el pago de ${pesos(borrar.monto)} de ${borrar.cliente_nombre}? Se recalcula toda la cuenta.`}
          textoConfirmar="Borrar" peligro onSi={hacerBorrar} onNo={() => setBorrar(null)} />
      )}
    </div>
  );
}
