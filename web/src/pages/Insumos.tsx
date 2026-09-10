// Insumos = materiales de taller (cuero, hilo, hebillas…), stock aparte del
// catálogo de venta. Se usan para armar la lista de materiales (BOM) de un
// presupuesto a medida — ver NuevoPresupuesto.tsx y PresupuestoDetalle.tsx.
import { useState } from "react";
import { api } from "../api";
import { pesos, aCentavos, aPesos } from "../format";
import { Cargando, Error, Vacio, Modal, Campo, Confirmar, useCarga } from "../components/ui";

interface Insumo {
  id: string;
  nombre: string;
  unidad_medida: string;
  costo_unitario: number;
  stock_actual: number;
  activo: number;
}

export function Insumos() {
  const [buscar, setBuscar] = useState("");
  const [verArchivados, setVerArchivados] = useState(false);
  const [editando, setEditando] = useState<Insumo | "nuevo" | null>(null);
  const [archivar, setArchivar] = useState<Insumo | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (buscar) qs.set("buscar", buscar);
  if (verArchivados) qs.set("incluirArchivados", "1");
  const { data, error: errCarga, cargando, recargar } = useCarga<{ insumos: Insumo[] }>(
    () => api.get(`/api/insumos?${qs}`),
    [buscar, verArchivados]
  );

  async function hacerArchivar() {
    if (!archivar) return;
    try {
      await api.post(`/api/insumos/${archivar.id}/archivar`, { activar: !archivar.activo });
      setAviso(archivar.activo ? `${archivar.nombre} archivado.` : `${archivar.nombre} reactivado.`);
      setArchivar(null);
      recargar();
    } catch (err: any) {
      setError(err.message);
      setArchivar(null);
    }
  }

  const lista = data?.insumos ?? [];

  return (
    <div>
      <div className="encabezado-seccion">
        <div>
          <h1>Insumos</h1>
          <p className="mut" style={{ marginTop: 2 }}>Materiales de taller para armar presupuestos a medida.</p>
        </div>
        <button className="btn primario" onClick={() => setEditando("nuevo")}>+ Nuevo insumo</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      <Error msg={error ?? errCarga} />

      <div className="barra-filtros">
        <div className="campo">
          <label>Buscar</label>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre del insumo" />
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
          icono="🧵"
          titulo="Los materiales que consumís al fabricar"
          mensaje="Cargá acá el cuero, el hilo, las hebillas o lo que sea que uses para armar un
                   producto a medida. Después los elegís al hacer un presupuesto, y el sistema
                   descuenta el stock solo cuando lo aprobás."
          accion={<button className="btn primario" onClick={() => setEditando("nuevo")}>Cargar el primer insumo</button>}
        />
      ) : (
        <div className="card">
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Insumo</th><th>Unidad</th><th className="num">Costo unit.</th>
                  <th className="num">Stock</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((i) => (
                  <tr key={i.id} className={i.activo ? "" : "mut"}>
                    <td>
                      <b>{i.nombre}</b>
                      {!i.activo && <span className="badge anulada" style={{ marginLeft: 6 }}>archivado</span>}
                    </td>
                    <td>{i.unidad_medida}</td>
                    <td className="num">{pesos(i.costo_unitario)}</td>
                    <td className="num">
                      <span className={i.stock_actual <= 0 ? "stock-cero" : ""}>{i.stock_actual} {i.unidad_medida}</span>
                    </td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setEditando(i)}>Editar</button>
                        <button className="btn chico" onClick={() => setArchivar(i)}>
                          {i.activo ? "Archivar" : "Reactivar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-body solo-movil lista-tarjetas">
            {lista.map((i) => (
              <div className="tarjeta-fila" key={i.id}>
                <div className="tf-titulo">
                  {i.nombre}
                  {!i.activo && <span className="badge anulada" style={{ marginLeft: 6 }}>archivado</span>}
                </div>
                <div className="mut">
                  {pesos(i.costo_unitario)} / {i.unidad_medida}
                </div>
                <div className="tf-datos">
                  <span className={i.stock_actual <= 0 ? "stock-cero" : ""}>Stock: {i.stock_actual} {i.unidad_medida}</span>
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico" onClick={() => setEditando(i)}>Editar</button>
                  <button className="btn chico" onClick={() => setArchivar(i)}>
                    {i.activo ? "Archivar" : "Reactivar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editando && (
        <FormInsumo
          insumo={editando === "nuevo" ? null : editando}
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
              ? `¿Archivar "${archivar.nombre}"? No se borra: los presupuestos que ya lo usan lo siguen nombrando, pero deja de aparecer al armar uno nuevo.`
              : `¿Reactivar "${archivar.nombre}"?`
          }
          textoConfirmar={archivar.activo ? "Archivar" : "Reactivar"}
          onSi={hacerArchivar}
          onNo={() => setArchivar(null)}
        />
      )}
    </div>
  );
}

function FormInsumo({ insumo, onCerrar }: { insumo: Insumo | null; onCerrar: (mensaje?: string) => void }) {
  const [nombre, setNombre] = useState(insumo?.nombre ?? "");
  const [unidad, setUnidad] = useState(insumo?.unidad_medida ?? "unidad");
  const [costo, setCosto] = useState(insumo ? String(aPesos(insumo.costo_unitario)) : "");
  const [stock, setStock] = useState(insumo ? String(insumo.stock_actual) : "0");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!nombre.trim()) { setError("Poné el nombre del insumo."); return; }
    setError(null);
    setGuardando(true);
    const body = {
      nombre,
      unidad_medida: unidad || "unidad",
      costo_unitario: aCentavos(costo || "0"),
      stock_actual: Number(stock) || 0,
    };
    try {
      if (insumo) await api.put(`/api/insumos/${insumo.id}`, body);
      else await api.post("/api/insumos", body);
      onCerrar(insumo ? `${nombre} actualizado.` : `${nombre} agregado.`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={insumo ? "Editar insumo" : "Nuevo insumo"} onCerrar={() => onCerrar()}>
      <Error msg={error} />
      <Campo label="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></Campo>
      <div className="fila">
        <Campo label="Unidad de medida">
          <select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="unidad">Unidad</option>
            <option value="metro">Metro</option>
            <option value="kg">Kilogramo</option>
            <option value="litro">Litro</option>
            <option value="par">Par</option>
          </select>
        </Campo>
        <Campo label="Costo por unidad ($)">
          <input className="num" type="number" step="0.01" min={0} value={costo} onChange={(e) => setCosto(e.target.value)} />
        </Campo>
      </div>
      <Campo label={`Stock actual (${unidad})`}>
        <input className="num" type="number" step="0.001" min={0} value={stock} onChange={(e) => setStock(e.target.value)} />
      </Campo>
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Modal>
  );
}
