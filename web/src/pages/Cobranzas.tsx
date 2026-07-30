import { useState } from "react";
import { api } from "../api";
import { pesos, numero, fecha } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";
import { waRecordatorioDeuda } from "../lib/whatsapp";
import { navegar } from "../lib/router";
import { CampanaRecordatorios } from "../components/CampanaRecordatorios";

function claseTramo(tramo: string): string {
  if (tramo === "+90") return "impaga";
  if (tramo === "0-30") return "pagada";
  return "parcial";
}

export function Cobranzas() {
  const { data, error, cargando } = useCarga<any>(() => api.get("/api/reportes/cobranzas"), []);
  const [campana, setCampana] = useState(false);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data) return null;

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Cobranzas</h1>
        {data.clientes.length > 0 && (
          <button className="btn wa" onClick={() => setCampana(true)}>📤 Recordar a todos</button>
        )}
      </div>

      <div className="grid-kpi">
        <div className="kpi"><div className="rot">Total a cobrar</div><div className="val debe">{pesos(data.total_a_cobrar)}</div>
          <div className="mut">{numero(data.cantidad)} clientes</div></div>
        <div className="kpi"><div className="rot">0 a 30 días</div><div className="val">{pesos(data.tramos["0-30"])}</div></div>
        <div className="kpi"><div className="rot">31 a 60 días</div><div className="val stock-bajo">{pesos(data.tramos["31-60"])}</div></div>
        <div className="kpi"><div className="rot">61 a 90 días</div><div className="val stock-bajo">{pesos(data.tramos["61-90"])}</div></div>
        <div className="kpi"><div className="rot">Más de 90 días</div><div className="val debe">{pesos(data.tramos["+90"])}</div></div>
      </div>

      {data.clientes.length === 0 ? (
        <Vacio mensaje="No hay deudas pendientes. ¡Todos al día! 🎉" />
      ) : (
        <div className="card">
          <h2>A quién cobrarle (deuda más vieja primero)</h2>
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cliente</th><th>Localidad</th><th>Debe desde</th>
                  <th className="num">Días</th><th>Antigüedad</th><th className="num">Saldo</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.clientes.map((c: any) => (
                  <tr key={c.cliente_id}>
                    <td><a href={`#/clientes/${c.cliente_id}`}>{c.nombre}</a></td>
                    <td>{c.localidad ?? "—"}</td>
                    <td className="num">{fecha(c.deuda_desde)}</td>
                    <td className="num">{numero(c.dias)}</td>
                    <td><span className={`badge ${claseTramo(c.tramo)}`}>{c.tramo} días</span></td>
                    <td className="num debe">{pesos(c.saldo)}</td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico wa" onClick={() => waRecordatorioDeuda(c, c.saldo)} disabled={!c.telefono}>
                          Recordar
                        </button>
                        <button className="btn chico" onClick={() => navegar(`/clientes/${c.cliente_id}`)}>Ficha</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-body solo-movil lista-tarjetas">
            {data.clientes.map((c: any) => (
              <div className="tarjeta-fila" key={c.cliente_id}>
                <div className="tf-titulo">
                  <a href={`#/clientes/${c.cliente_id}`}>{c.nombre}</a>
                  {c.localidad && <span className="mut" style={{ fontWeight: 400 }}> · {c.localidad}</span>}
                </div>
                <div className="tf-datos">
                  <span className="num debe">{pesos(c.saldo)}</span>
                  <span className={`badge ${claseTramo(c.tramo)}`}>{c.tramo} días</span>
                  <span className="mut">Debe desde {fecha(c.deuda_desde)}</span>
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico wa" onClick={() => waRecordatorioDeuda(c, c.saldo)} disabled={!c.telefono}>
                    Recordar
                  </button>
                  <button className="btn chico" onClick={() => navegar(`/clientes/${c.cliente_id}`)}>Ficha</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {campana && <CampanaRecordatorios deudores={data.clientes} onCerrar={() => setCampana(false)} />}
    </div>
  );
}
