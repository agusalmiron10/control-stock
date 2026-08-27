import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { PresupuestoPDF } from "../components/PresupuestoPDF";
import { PresupuestoDetalleModal } from "../components/PresupuestoDetalleModal";
import { FiltroComprobantes, FILTROS_VACIOS, comoQuery, type Filtros } from "../components/FiltroComprobantes";
import { navegar } from "../lib/router";

const ESTADOS = ["pendiente", "aceptado", "rechazado", "vencido"] as const;

const BADGE: Record<string, string> = {
  aceptado: "pagada",
  rechazado: "impaga",
  vencido: "anulada",
  pendiente: "parcial",
};

/** Color de la franja lateral: verde lo aceptado, rojo lo perdido, ámbar lo que sigue abierto. */
function franja(estado: string): string {
  if (estado === "aceptado") return "ok";
  if (estado === "rechazado" || estado === "vencido") return "falla";
  return "duda";
}

export function Presupuestos() {
  const [estado, setEstado] = useState("");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [pdfId, setPdfId] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<number | null>(null);
  const [eliminar, setEliminar] = useState<any | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = comoQuery(filtros, { estado });
  const { data, error, cargando, recargar } = useCarga<any>(
    () => api.get(`/api/presupuestos?${qs}`),
    [qs]
  );

  async function hacerEliminar() {
    if (!eliminar) return;
    try {
      await api.del(`/api/presupuestos/${eliminar.id}`);
      setAviso(`Presupuesto #${eliminar.numero} eliminado.`);
      setEliminar(null);
      recargar();
    } catch (err: any) {
      setAviso(err.message);
      setEliminar(null);
    }
  }

  const lista = data?.presupuestos ?? [];
  const hayFiltro = qs !== "";
  const totalListado = lista.reduce((s: number, p: any) => s + p.total, 0);

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Presupuestos</h1>
        <button className="btn primario" onClick={() => navegar("/presupuestos/nuevo")}>+ Nuevo presupuesto</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <FiltroComprobantes valor={filtros} onCambiar={setFiltros} placeholder="Nombre del cliente o N° de presupuesto">
        <div className="campo">
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>
      </FiltroComprobantes>

      {error && <Error msg={error} />}

      {lista.length > 0 && (
        <p className="mut" style={{ marginTop: -4 }}>
          {lista.length} presupuesto{lista.length === 1 ? "" : "s"} · {pesos(totalListado)} en total
        </p>
      )}

      {cargando ? (
        <Cargando />
      ) : lista.length === 0 ? (
        <Vacio
          mensaje={hayFiltro ? "Ningún presupuesto coincide con la búsqueda." : "No hay presupuestos todavía."}
          accion={
            hayFiltro ? (
              <button className="btn" onClick={() => { setFiltros(FILTROS_VACIOS); setEstado(""); }}>Limpiar filtros</button>
            ) : (
              <button className="btn primario" onClick={() => navegar("/presupuestos/nuevo")}>Crear el primero</button>
            )
          }
        />
      ) : (
        <div className="grid-comprobantes">
          {lista.map((p: any) => (
            <button key={p.id} className={`comp-card ${franja(p.estado)}`} onClick={() => setDetalle(p.id)}>
              <div className="comp-card-top">
                <div>
                  <div className="comp-card-tipo">Presupuesto #{p.numero}</div>
                  <div className="comp-card-nro">{fecha(p.fecha)}</div>
                </div>
                <span className={`badge ${BADGE[p.estado] ?? ""}`}>{p.estado}</span>
              </div>

              <div className="comp-card-cliente">{p.cliente_nombre}</div>

              {p.venta_id && (
                <div className="mut" style={{ fontSize: 12.5 }}>Ya convertido en venta</div>
              )}

              <div className="comp-card-pie">
                <span className="comp-card-total">{pesos(p.total)}</span>
                <span className="comp-card-fecha">
                  {p.validez_hasta ? `Vale hasta ${fecha(p.validez_hasta)}` : "Sin vencimiento"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detalle != null && (
        <PresupuestoDetalleModal
          id={detalle}
          onCerrar={() => setDetalle(null)}
          onPdf={(id) => { setDetalle(null); setPdfId(id); }}
          onAbrirCompleto={(id) => { setDetalle(null); navegar(`/presupuestos/${id}`); }}
        />
      )}
      {pdfId && <PresupuestoPDF presupuestoId={pdfId} onCerrar={() => setPdfId(null)} />}
      {eliminar && (
        <Confirmar
          mensaje={`¿Eliminar el presupuesto #${eliminar.numero} de ${eliminar.cliente_nombre} por ${pesos(eliminar.total)}? Esta acción no se puede deshacer.`}
          textoConfirmar="Eliminar"
          peligro
          onSi={hacerEliminar}
          onNo={() => setEliminar(null)}
        />
      )}
    </div>
  );
}
