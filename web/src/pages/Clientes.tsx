import { useState } from "react";
import { api } from "../api";
import { pesos } from "../format";
import { Cargando, Error, Vacio, Modal, Campo, useCarga } from "../components/ui";
import { navegar } from "../lib/router";

export function Clientes() {
  const [buscar, setBuscar] = useState("");
  const [localidad, setLocalidad] = useState("");
  const [soloDeben, setSoloDeben] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (buscar) qs.set("buscar", buscar);
  if (localidad) qs.set("localidad", localidad);
  if (soloDeben) qs.set("soloDeben", "1");

  const { data, error, cargando, recargar } = useCarga<any>(
    () => api.get(`/api/clientes?${qs}`),
    [buscar, localidad, soloDeben]
  );
  const locs = useCarga<any>(() => api.get("/api/clientes/localidades"), []);

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Clientes</h1>
        <button className="btn primario" onClick={() => setNuevo(true)}>+ Nuevo cliente</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="barra-filtros">
        <div className="campo" style={{ flex: 2 }}>
          <label>Buscar por nombre</label>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre del cliente" />
        </div>
        <div className="campo">
          <label>Localidad</label>
          <select value={localidad} onChange={(e) => setLocalidad(e.target.value)}>
            <option value="">Todas</option>
            {(locs.data?.localidades ?? []).map((l: string) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <label className="campo check">
          <input type="checkbox" checked={soloDeben} onChange={(e) => setSoloDeben(e.target.checked)} />
          Solo los que deben
        </label>
      </div>

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : data?.clientes.length === 0 ? (
        <Vacio
          mensaje="No hay clientes que coincidan."
          accion={<button className="btn primario" onClick={() => setNuevo(true)}>Crear el primero</button>}
        />
      ) : (
        <div className="card">
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Nombre</th><th>Localidad</th><th>Teléfono</th>
                  <th className="num">Comprado</th><th className="num">Pagado</th><th className="num">Saldo</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.clientes.map((c: any) => (
                  <tr key={c.id}>
                    <td><a href={`#/clientes/${c.id}`}>{c.nombre}</a></td>
                    <td>{c.localidad ?? "—"}</td>
                    <td>{c.telefono ?? "—"}</td>
                    <td className="num">{pesos(c.total_comprado)}</td>
                    <td className="num">{pesos(c.total_pagado)}</td>
                    <td className={`num ${c.saldo > 0 ? "debe" : c.saldo < 0 ? "afavor" : ""}`}>
                      {c.saldo < 0 ? `${pesos(-c.saldo)} a favor` : pesos(c.saldo)}
                    </td>
                    <td className="acc">
                      <button className="btn chico" onClick={() => navegar(`/clientes/${c.id}`)}>Ver ficha</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {nuevo && (
        <FormCliente
          onCerrar={(msg) => { setNuevo(false); if (msg) setAviso(msg); recargar(); }}
        />
      )}
    </div>
  );
}

export function FormCliente({ cliente, onCerrar }: { cliente?: any; onCerrar: (m?: string) => void }) {
  const editar = !!cliente;
  const [f, setF] = useState({
    nombre: cliente?.nombre ?? "", localidad: cliente?.localidad ?? "",
    direccion: cliente?.direccion ?? "", telefono: cliente?.telefono ?? "",
    email: cliente?.email ?? "", notas: cliente?.notas ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editar) await api.put(`/api/clientes/${cliente.id}`, f);
      else await api.post("/api/clientes", f);
      onCerrar(editar ? "Cliente actualizado." : "Cliente creado.");
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal titulo={editar ? "Editar cliente" : "Nuevo cliente"} onCerrar={() => onCerrar()}
      pie={<><button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" form="fc">Guardar</button></>}>
      <form id="fc" onSubmit={guardar}>
        <Error msg={error} />
        <Campo label="Nombre"><input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} autoFocus /></Campo>
        <div className="fila">
          <Campo label="Localidad"><input value={f.localidad} onChange={(e) => set("localidad", e.target.value)} /></Campo>
          <Campo label="Teléfono"><input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} /></Campo>
        </div>
        <Campo label="Dirección"><input value={f.direccion} onChange={(e) => set("direccion", e.target.value)} /></Campo>
        <Campo label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} /></Campo>
        <Campo label="Notas"><textarea rows={2} value={f.notas} onChange={(e) => set("notas", e.target.value)} /></Campo>
      </form>
    </Modal>
  );
}
