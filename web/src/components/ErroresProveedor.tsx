import { api } from "../api";
import { Cargando, Error, useCarga } from "./ui";

interface ErrorSistema {
  id: string; negocio_id: string | null; negocio_nombre: string | null;
  metodo: string; ruta: string; mensaje: string; creado_en: string;
}

function cuando(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Errores no controlados (500) de cualquier negocio, en un solo lugar. Antes
 * esto sólo se veía en vivo con `wrangler tail` — si no estabas mirando en
 * ese momento, no había forma de enterarse de que algo se rompió.
 */
export function ErroresProveedor() {
  const { data, error, cargando, recargar } = useCarga<{ errores: ErrorSistema[] }>(
    () => api.get("/api/super/errores"),
    []
  );

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  const errores = data?.errores ?? [];

  if (errores.length === 0) {
    return <p className="mut" style={{ marginTop: 0 }}>Ningún error registrado en los últimos 30 días. 🎉</p>;
  }

  return (
    <>
      <div className="tf-datos" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <p className="mut" style={{ margin: 0 }}>
          {errores.length} error{errores.length === 1 ? "" : "es"} en los últimos 30 días (se borran solos después).
        </p>
        <button className="btn chico" onClick={() => recargar()}>Actualizar</button>
      </div>
      <div className="tabla-wrap">
        <table className="tabla">
          <thead>
            <tr><th>Cuándo</th><th>Cliente</th><th>Dónde</th><th>Qué pasó</th></tr>
          </thead>
          <tbody>
            {errores.map((e) => (
              <tr key={e.id}>
                <td>{cuando(e.creado_en)}</td>
                <td>{e.negocio_nombre ?? <span className="mut">—</span>}</td>
                <td className="mono" style={{ fontSize: 12.5 }}>{e.metodo} {e.ruta}</td>
                <td className="mut" style={{ maxWidth: 360 }}>{e.mensaje}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
