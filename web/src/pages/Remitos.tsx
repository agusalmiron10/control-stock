import { useState } from "react";
import { api } from "../api";
import { fecha, numero } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";
import { FiltroComprobantes, FILTROS_VACIOS, comoQuery, type Filtros } from "../components/FiltroComprobantes";
import { RemitoDetalle } from "../components/RemitoDetalle";
import { NuevoRemito } from "../components/NuevoRemito";
import { RemitoImprimible } from "../components/RemitoImprimible";

const ESTADOS = ["pendiente", "entregado", "anulado"] as const;

const BADGE: Record<string, string> = {
  entregado: "pagada",
  pendiente: "parcial",
  anulado: "anulada",
};

/** Verde entregado, ámbar en camino, gris anulado. */
function franja(estado: string): string {
  if (estado === "entregado") return "ok";
  if (estado === "anulado") return "falla";
  return "duda";
}

export function Remitos() {
  const [estado, setEstado] = useState("");
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [imprimir, setImprimir] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = comoQuery(filtros, { estado });
  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/remitos?${qs}`), [qs]);

  const lista = data?.remitos ?? [];
  const hayFiltro = qs !== "";

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Remitos</h1>
        <button className="btn primario" onClick={() => setNuevo(true)}>+ Nuevo remito</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <FiltroComprobantes valor={filtros} onCambiar={setFiltros} placeholder="Nombre del cliente o N° de remito">
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
          {lista.length} remito{lista.length === 1 ? "" : "s"}
          {" · "}
          {lista.filter((r: any) => r.estado === "pendiente").length} sin entregar
        </p>
      )}

      {cargando ? (
        <Cargando />
      ) : lista.length === 0 ? (
        <Vacio
          icono={hayFiltro ? undefined : "🧾"}
          titulo={hayFiltro ? undefined : "El papel que acompaña a la mercadería"}
          mensaje={
            hayFiltro
              ? "Ningún remito coincide con la búsqueda."
              : "Se arma desde una venta ya confirmada y permite entregas parciales: si vendiste 10 " +
                "bolsas y entregás 4 hoy, el sistema lleva la cuenta de las 6 que faltan. No toca el " +
                "stock, porque ya se descontó al vender."
          }
          accion={
            hayFiltro ? (
              <button className="btn" onClick={() => { setFiltros(FILTROS_VACIOS); setEstado(""); }}>Limpiar filtros</button>
            ) : (
              <button className="btn primario" onClick={() => setNuevo(true)}>Hacer el primero</button>
            )
          }
        />
      ) : (
        <div className="grid-comprobantes">
          {lista.map((r: any) => (
            <button key={r.id} className={`comp-card ${franja(r.estado)}`} onClick={() => setDetalle(r.id)}>
              <div className="comp-card-top">
                <div>
                  <div className="comp-card-tipo">Remito #{r.numero}</div>
                  <div className="comp-card-nro">{fecha(r.fecha)} · Venta #{r.venta_numero}</div>
                </div>
                <span className={`badge ${BADGE[r.estado] ?? ""}`}>{r.estado}</span>
              </div>

              <div className="comp-card-cliente">{r.cliente_nombre}</div>

              {r.transporte && (
                <div className="mut" style={{ fontSize: 12.5 }}>Transporte: {r.transporte}</div>
              )}

              <div className="comp-card-pie">
                <span className="comp-card-total">
                  {numero(r.bultos)} <span style={{ fontSize: 13, fontWeight: 500 }}>
                    unidad{r.bultos === 1 ? "" : "es"}
                  </span>
                </span>
                <span className="comp-card-fecha">
                  {r.renglones} producto{r.renglones === 1 ? "" : "s"}
                  {r.recibido_por ? ` · Recibió ${r.recibido_por}` : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detalle && (
        <RemitoDetalle
          id={detalle}
          onCerrar={() => setDetalle(null)}
          onCambio={(mensaje) => { setDetalle(null); setAviso(mensaje); recargar(); }}
          onImprimir={(id) => { setDetalle(null); setImprimir(id); }}
        />
      )}
      {nuevo && (
        <NuevoRemito onCerrar={(mensaje) => { setNuevo(false); if (mensaje) { setAviso(mensaje); recargar(); } }} />
      )}
      {imprimir && <RemitoImprimible remitoId={imprimir} onCerrar={() => setImprimir(null)} />}
    </div>
  );
}
