import { api } from "../api";
import { pesos } from "../format";
import { negocio } from "../lib/negocio";
import { Cargando, Error, useCarga } from "./ui";

/** PDF (vía impresión del navegador) con el listado completo de clientes. */
export function ClientesPDF({ onCerrar }: { onCerrar: () => void }) {
  const { data, error, cargando } = useCarga<any>(() => api.get("/api/clientes"), []);

  return (
    <div className="comprobante-overlay" onMouseDown={onCerrar}>
      <div className="comprobante-caja" onMouseDown={(e) => e.stopPropagation()}>
        <div className="no-print comprobante-barra">
          <button className="btn" onClick={onCerrar}>Cerrar</button>
          <button className="btn primario" onClick={() => window.print()} disabled={!data || data.clientes.length === 0}>
            🖨 Imprimir / Guardar PDF
          </button>
        </div>

        {cargando && <Cargando />}
        {error && <Error msg={error} />}

        {data && (
          <div className="comprobante reporte-imprimible">
            <div className="comp-header">
              <div>
                <div className="comp-marca">{negocio().nombre}</div>
                <div className="comp-sub">{negocio().rubro}</div>
              </div>
              <div className="comp-doc">
                <div className="comp-doc-tit">CLIENTES</div>
                <div className="comp-sub">{data.clientes.length} en total</div>
              </div>
            </div>

            {data.clientes.length === 0 ? (
              <p className="mut">No hay clientes cargados.</p>
            ) : (
              <table className="comp-tabla">
                <thead>
                  <tr>
                    <th>Nombre</th><th>Localidad</th><th>Teléfono</th>
                    <th className="num">Comprado</th><th className="num">Pagado</th><th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clientes.map((c: any) => (
                    <tr key={c.id}>
                      <td>{c.nombre}</td>
                      <td>{c.localidad ?? "—"}</td>
                      <td>{c.telefono ?? "—"}</td>
                      <td className="num">{pesos(c.total_comprado)}</td>
                      <td className="num">{pesos(c.total_pagado)}</td>
                      <td className="num">{c.saldo < 0 ? `${pesos(-c.saldo)} a favor` : pesos(c.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="comp-pie">Generado el {new Date().toLocaleDateString("es-AR")} — {negocio().nombre}</div>
          </div>
        )}
      </div>
    </div>
  );
}
