import { api } from "../api";
import { numero, fecha } from "../format";
import { Cargando, Error, useCarga } from "./ui";

interface Metrica {
  negocio_id: string; negocio_nombre: string; fecha: string; al_dia: boolean;
  filas: number; bytes_estimados: number; ventas: number; facturas: number; remitos: number;
  variacion_filas: number | null;
}

function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Cuánto pesa cada negocio. La estimación sale gratis del volcado que ya se
 * arma todas las noches para la copia de cada uno (no es una consulta
 * nueva), así que sirve para comparar negocios entre sí — no es el tamaño
 * exacto que D1 reporta para la base completa.
 */
export function MetricasProveedor() {
  const { data, error, cargando } = useCarga<{
    negocios: Metrica[]; total_filas: number; total_bytes_estimados: number;
  }>(() => api.get("/api/super/metricas"), []);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  const negocios = data?.negocios ?? [];

  if (negocios.length === 0) {
    return (
      <p className="mut" style={{ marginTop: 0 }}>
        Todavía no hay datos de uso. Se completan solos con la copia diaria de cada negocio.
      </p>
    );
  }

  return (
    <>
      <p className="mut" style={{ marginTop: 0 }}>
        {numero(negocios.length)} negocio{negocios.length === 1 ? "" : "s"} · {numero(data!.total_filas)} filas en
        total · {peso(data!.total_bytes_estimados)} estimados. La base entera pesa hoy una fracción mínima del
        límite de D1 (500 MB): esto es para ver quién crece, no una alerta de límite.
      </p>
      <div className="tabla-wrap">
        <table className="tabla">
          <thead>
            <tr>
              <th>Cliente</th><th className="num">Filas</th><th className="num">Tamaño</th>
              <th className="num">Tendencia (7 días)</th>
              <th className="num">Ventas</th><th className="num">Facturas</th><th className="num">Remitos</th>
              <th>Dato</th>
            </tr>
          </thead>
          <tbody>
            {negocios.map((n) => (
              <tr key={n.negocio_id}>
                <td>{n.negocio_nombre}</td>
                <td className="num">{numero(n.filas)}</td>
                <td className="num">{peso(n.bytes_estimados)}</td>
                <td className="num">
                  {n.variacion_filas == null ? (
                    <span className="mut">sin historia</span>
                  ) : n.variacion_filas === 0 ? (
                    <span className="mut">sin cambios</span>
                  ) : n.variacion_filas > 0 ? (
                    <span style={{ color: "var(--verde)" }}>▲ +{numero(n.variacion_filas)}</span>
                  ) : (
                    <span className="mut">▼ {numero(n.variacion_filas)}</span>
                  )}
                </td>
                <td className="num">{numero(n.ventas)}</td>
                <td className="num">{numero(n.facturas)}</td>
                <td className="num">{numero(n.remitos)}</td>
                <td>
                  {n.al_dia
                    ? <span className="mut">Hoy</span>
                    : <span className="badge parcial">Del {fecha(n.fecha)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
