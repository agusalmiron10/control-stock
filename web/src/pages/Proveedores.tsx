import { useState } from "react";
import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { Cargando, Error, Vacio, Modal, Campo, Confirmar, useCarga } from "../components/ui";

interface Proveedor {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  cuit: string | null;
  notas: string | null;
  activo: number;
  compras_hechas: number;
  total_comprado: number;
  ultima_compra: string | null;
}

export function Proveedores() {
  const [buscar, setBuscar] = useState("");
  const [verArchivados, setVerArchivados] = useState(false);
  const [editando, setEditando] = useState<Proveedor | "nuevo" | null>(null);
  const [archivar, setArchivar] = useState<Proveedor | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (buscar) qs.set("buscar", buscar);
  if (verArchivados) qs.set("incluirArchivados", "1");
  const { data, error: errCarga, cargando, recargar } = useCarga<{ proveedores: Proveedor[] }>(
    () => api.get(`/api/compras/proveedores?${qs}`),
    [buscar, verArchivados]
  );

  async function hacerArchivar() {
    if (!archivar) return;
    try {
      await api.post(`/api/compras/proveedores/${archivar.id}/archivar`, { activar: !archivar.activo });
      setAviso(archivar.activo ? `${archivar.nombre} archivado.` : `${archivar.nombre} reactivado.`);
      setArchivar(null);
      recargar();
    } catch (err: any) {
      setError(err.message);
      setArchivar(null);
    }
  }

  const lista = data?.proveedores ?? [];

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Proveedores</h1>
        <button className="btn primario" onClick={() => setEditando("nuevo")}>+ Nuevo proveedor</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      <Error msg={error ?? errCarga} />

      <div className="barra-filtros">
        <div className="campo">
          <label>Buscar</label>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre del proveedor" />
        </div>
        <div className="campo">
          <label>&nbsp;</label>
          <button className={`btn ${verArchivados ? "primario" : ""}`} onClick={() => setVerArchivados(!verArchivados)}>
            {verArchivados ? "Ocultar archivados" : "Ver archivados"}
          </button>
        </div>
      </div>

      {cargando ? (
        <Cargando />
      ) : lista.length === 0 ? (
        <Vacio
          icono="🚚"
          titulo="A quién le comprás la mercadería"
          mensaje="Cargando tus proveedores podés registrar las compras que les hacés y ver de un
                   vistazo cuánto le compraste a cada uno y cuándo fue la última vez."
          accion={<button className="btn primario" onClick={() => setEditando("nuevo")}>Cargar el primer proveedor</button>}
        />
      ) : (
        <div className="card">
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th><th>Teléfono</th><th className="num">Compras</th>
                  <th className="num">Total comprado</th><th>Última</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id} className={p.activo ? "" : "mut"}>
                    <td>
                      <b>{p.nombre}</b>
                      {!p.activo && <span className="badge anulada" style={{ marginLeft: 6 }}>archivado</span>}
                      {p.cuit && <div className="mut">CUIT {p.cuit}</div>}
                    </td>
                    <td>{p.telefono ?? "—"}</td>
                    <td className="num">{numero(p.compras_hechas)}</td>
                    <td className="num">{pesos(p.total_comprado)}</td>
                    <td className="num">{p.ultima_compra ? fecha(p.ultima_compra) : "—"}</td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setEditando(p)}>Editar</button>
                        <button className="btn chico" onClick={() => setArchivar(p)}>
                          {p.activo ? "Archivar" : "Reactivar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-body solo-movil lista-tarjetas">
            {lista.map((p) => (
              <div className="tarjeta-fila" key={p.id}>
                <div className="tf-titulo">
                  {p.nombre}
                  {!p.activo && <span className="badge anulada" style={{ marginLeft: 6 }}>archivado</span>}
                </div>
                <div className="mut">
                  {p.telefono ?? "sin teléfono"}
                  {p.cuit && ` · CUIT ${p.cuit}`}
                </div>
                <div className="tf-datos">
                  <span>{numero(p.compras_hechas)} compras</span>
                  <span className="num">{pesos(p.total_comprado)}</span>
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico" onClick={() => setEditando(p)}>Editar</button>
                  <button className="btn chico" onClick={() => setArchivar(p)}>
                    {p.activo ? "Archivar" : "Reactivar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editando && (
        <FormProveedor
          proveedor={editando === "nuevo" ? null : editando}
          onCerrar={(mensaje) => {
            setEditando(null);
            if (mensaje) { setAviso(mensaje); recargar(); }
          }}
        />
      )}

      {archivar && (
        <Confirmar
          mensaje={
            archivar.activo
              ? `¿Archivar a ${archivar.nombre}? No se borra: las compras que ya le hiciste lo siguen nombrando, pero deja de aparecer al cargar una compra nueva.`
              : `¿Reactivar a ${archivar.nombre}?`
          }
          textoConfirmar={archivar.activo ? "Archivar" : "Reactivar"}
          onSi={hacerArchivar}
          onNo={() => setArchivar(null)}
        />
      )}
    </div>
  );
}

function FormProveedor({ proveedor, onCerrar }: { proveedor: Proveedor | null; onCerrar: (mensaje?: string) => void }) {
  const [f, setF] = useState({
    nombre: proveedor?.nombre ?? "",
    telefono: proveedor?.telefono ?? "",
    email: proveedor?.email ?? "",
    direccion: proveedor?.direccion ?? "",
    cuit: proveedor?.cuit ?? "",
    notas: proveedor?.notas ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    if (!f.nombre.trim()) { setError("Poné el nombre del proveedor."); return; }
    setError(null);
    setGuardando(true);
    try {
      if (proveedor) await api.put(`/api/compras/proveedores/${proveedor.id}`, f);
      else await api.post("/api/compras/proveedores", f);
      onCerrar(proveedor ? `${f.nombre} actualizado.` : `${f.nombre} agregado.`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={proveedor ? "Editar proveedor" : "Nuevo proveedor"} onCerrar={() => onCerrar()}>
      <Error msg={error} />
      <Campo label="Nombre"><input value={f.nombre} onChange={set("nombre")} autoFocus /></Campo>
      <div className="fila">
        <Campo label="Teléfono"><input value={f.telefono} onChange={set("telefono")} /></Campo>
        <Campo label="CUIT"><input value={f.cuit} onChange={set("cuit")} /></Campo>
      </div>
      <Campo label="Email"><input value={f.email} onChange={set("email")} /></Campo>
      <Campo label="Dirección"><input value={f.direccion} onChange={set("direccion")} /></Campo>
      <Campo label="Notas"><textarea value={f.notas} onChange={set("notas")} rows={2} /></Campo>
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}
