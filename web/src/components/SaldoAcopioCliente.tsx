import { api } from "../api";
import { numero } from "../format";
import { Cargando, Error, useCarga } from "./ui";

/**
 * La "cuenta corriente de artículos" de un cliente: de lo que compró en
 * acopio, qué se llevó ya y qué le queda pendiente de retirar — sumado por
 * producto, cruzando todas sus ventas de acopio.
 *
 * Sólo se monta si el negocio tiene el módulo activo (lo decide quien use
 * este componente, con useModulo("acopio")), así que acá no hace falta
 * repetir ese chequeo.
 */
export function SaldoAcopioCliente({ clienteId }: { clienteId: string }) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/remitos/acopio/${clienteId}`), [clienteId]);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data || data.resumen.length === 0) return null;

  return (
    <div className="card">
      <h2>Acopio pendiente</h2>
      <div className="tabla-wrap solo-escritorio">
        <table className="tabla">
          <thead>
            <tr><th>Producto</th><th className="num">Comprado</th><th className="num">Retirado</th><th className="num">Pendiente</th></tr>
          </thead>
          <tbody>
            {data.resumen.map((l: any) => (
              <tr key={l.herramienta_id} className={l.pendiente === 0 ? "mut" : ""}>
                <td>{l.nombre_herramienta}</td>
                <td className="num">{numero(l.comprado)}</td>
                <td className="num">{numero(l.entregado)}</td>
                <td className={`num ${l.pendiente > 0 ? "debe" : ""}`}>{numero(l.pendiente)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card-body solo-movil lista-tarjetas">
        {data.resumen.map((l: any) => (
          <div className="tarjeta-fila" key={l.herramienta_id}>
            <div className="tf-titulo">{l.nombre_herramienta}</div>
            <div className="tf-datos">
              <span className="mut">Compró {numero(l.comprado)} · Retiró {numero(l.entregado)}</span>
              {l.pendiente > 0 && <span className="num debe">Pendiente {numero(l.pendiente)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
