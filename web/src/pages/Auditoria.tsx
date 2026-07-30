import { api } from "../api";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";

const ACCION_LABEL: Record<string, string> = {
  anular_venta: "Anuló la venta",
  confirmar_venta: "Confirmó la venta",
  borrar_pago: "Borró un pago",
  cambiar_precio: "Cambió el precio de",
  ajustar_stock: "Ajustó el stock de",
  archivar_cliente: "Archivó al cliente",
  reactivar_cliente: "Reactivó al cliente",
  archivar_herramienta: "Archivó la herramienta",
  reactivar_herramienta: "Reactivó la herramienta",
};

const ENTIDAD_LABEL: Record<string, string> = {
  venta: "venta", pago: "pago", cliente: "cliente", herramienta: "herramienta",
};

function fechaHora(iso: string): string {
  // creado_en viene como "YYYY-MM-DD HH:MM:SS" (UTC, datetime('now') de SQLite).
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function Auditoria() {
  const { data, error, cargando } = useCarga<any>(() => api.get("/api/auditoria"), []);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;

  const eventos: any[] = data?.eventos ?? [];

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Auditoría</h1>
        <span className="mut">Últimos {eventos.length} eventos</span>
      </div>

      {eventos.length === 0 ? (
        <Vacio mensaje="Todavía no hay eventos registrados." />
      ) : (
        <div className="card">
          <div className="card-body lista-tarjetas">
            {eventos.map((e) => (
              <div className="tarjeta-fila" key={e.id}>
                <div className="tf-titulo">
                  <b>{e.usuario}</b> — {ACCION_LABEL[e.accion] ?? e.accion} {e.entidad_id ? `(${ENTIDAD_LABEL[e.entidad] ?? e.entidad} ${e.entidad_id.slice(0, 8)})` : ""}
                </div>
                <div className="tf-datos">
                  <span className="mut">{fechaHora(e.creado_en)}</span>
                  {e.detalle && <span className="mut">{e.detalle}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
