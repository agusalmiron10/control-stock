import { api } from "../api";
import { fecha } from "../format";
import { Cargando, useCarga } from "./ui";

interface Copia { fecha: string; tamano: number }

function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Las copias que el sistema guarda solo, todas las madrugadas.
 *
 * Se muestran para que el ferretero VEA que existen: un respaldo del que uno
 * no sabe nada no tranquiliza a nadie, y el día que hace falta tampoco se
 * acuerda de pedirlo.
 */
export function CopiasAutomaticas() {
  const { data, error, cargando } = useCarga<{ copias: Copia[]; disponible: boolean }>(
    () => api.get("/api/backup/automaticos"),
    []
  );

  if (cargando) return <Cargando />;
  if (error || !data?.disponible) {
    return <p className="mut">Las copias automáticas no están disponibles en este momento.</p>;
  }

  const copias = data.copias ?? [];
  if (copias.length === 0) {
    return (
      <p className="mut">
        Todavía no hay ninguna copia automática. Se genera la primera esta madrugada.
      </p>
    );
  }

  return (
    <>
      <p className="mut">
        El sistema guarda una copia de tus datos todas las madrugadas y conserva los últimos 30 días.
        Podés bajarte cualquiera.
      </p>
      <div className="tabla-wrap">
        <table className="tabla">
          <thead>
            <tr><th>Día</th><th className="num">Tamaño</th><th></th></tr>
          </thead>
          <tbody>
            {copias.map((c) => (
              <tr key={c.fecha}>
                <td>{fecha(c.fecha)}</td>
                <td className="num">{peso(c.tamano)}</td>
                <td className="acc">
                  <a className="btn chico" href={`/api/backup/automaticos/${c.fecha}`}>Descargar</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
