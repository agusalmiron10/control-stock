import { useState } from "react";
import { api } from "../api";
import { fecha } from "../format";
import { Cargando, Error, useCarga } from "./ui";

interface Copia { fecha: string; tamano: number }
interface NegocioCopias { id: string; nombre: string; copias: Copia[]; total: number }

function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Las copias diarias de todos los clientes, para el proveedor.
 *
 * El ferretero no las ve en su pantalla: si necesita recuperar un día, se la
 * entregás vos desde acá.
 */
export function CopiasProveedor() {
  const [abierto, setAbierto] = useState<string | null>(null);
  const { data, error, cargando } = useCarga<{ negocios: NegocioCopias[]; disponible: boolean; ocupado: number }>(
    () => api.get("/api/super/copias"),
    []
  );

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data?.disponible) return <p className="mut">No hay un bucket de copias configurado.</p>;

  const negocios = data.negocios ?? [];
  const hoy = new Date().toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  if (negocios.length === 0) {
    return <p className="mut">Todavía no hay ninguna copia. La primera se genera esta madrugada.</p>;
  }

  return (
    <>
      <p className="mut" style={{ marginTop: 0 }}>
        Una copia por cliente y por día, de los últimos 30 días. Ocupan {peso(data.ocupado)} en R2,
        que es almacenamiento aparte: no usan nada de la base de datos.
      </p>

      <div className="lista-tarjetas">
        {negocios.map((n) => {
          const ultima = n.copias[0]?.fecha;
          // Si la última copia no es de hoy ni de ayer, algo falló y hay que verlo.
          const alDia = ultima === hoy || ultima === ayer;
          return (
            <div key={n.id} className="tarjeta-fila">
              <div className="tf-titulo">
                <strong>{n.nombre}</strong>
                <span className={`badge ${alDia ? "pagada" : "impaga"}`}>
                  {alDia
                    ? `Al día · ${n.copias.length} ${n.copias.length === 1 ? "copia" : "copias"}`
                    : `Última: ${ultima ? fecha(ultima) : "ninguna"}`}
                </span>
              </div>
              <div className="tf-datos">
                <span className="mut">{peso(n.total)} en total</span>
              </div>
              <div className="btn-grupo">
                <button className="btn chico" onClick={() => setAbierto(abierto === n.id ? null : n.id)}>
                  {abierto === n.id ? "Ocultar" : "Ver las copias"}
                </button>
                {ultima && (
                  <a className="btn chico primario" href={`/api/super/copias/${n.id}/${ultima}`}>
                    Bajar la última
                  </a>
                )}
              </div>

              {abierto === n.id && (
                <div className="tabla-wrap" style={{ marginTop: 10 }}>
                  <table className="tabla">
                    <thead><tr><th>Día</th><th className="num">Tamaño</th><th></th></tr></thead>
                    <tbody>
                      {n.copias.map((c) => (
                        <tr key={c.fecha}>
                          <td>{fecha(c.fecha)}</td>
                          <td className="num">{peso(c.tamano)}</td>
                          <td className="acc">
                            <a className="btn chico" href={`/api/super/copias/${n.id}/${c.fecha}`}>Descargar</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
