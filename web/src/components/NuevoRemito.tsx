import { useState } from "react";
import { api } from "../api";
import { pesos, fecha, hoyISO } from "../format";
import { Modal, Error, Campo, Cargando, useCarga } from "./ui";

interface Props {
  /** Si viene, arranca directo con esa venta (desde la pantalla de Ventas). */
  ventaId?: string;
  onCerrar: (mensaje?: string) => void;
}

/**
 * Arma un remito contra una venta. El paso clave es que propone lo que falta
 * entregar —no lo vendido— así una segunda entrega no repite lo que ya salió.
 */
export function NuevoRemito({ ventaId, onCerrar }: Props) {
  const [elegida, setElegida] = useState<string | null>(ventaId ?? null);

  if (!elegida) return <ElegirVenta onElegir={setElegida} onCerrar={onCerrar} />;
  return <ArmarRemito ventaId={elegida} onCerrar={onCerrar} />;
}

/** Paso 1: contra qué venta. Sólo las que tienen algo sin entregar. */
function ElegirVenta({ onElegir, onCerrar }: { onElegir: (id: string) => void; onCerrar: () => void }) {
  const { data, error, cargando } = useCarga<any>(() => api.get("/api/ventas"), []);
  const [buscar, setBuscar] = useState("");

  const ventas = (data?.ventas ?? []).filter(
    (v: any) => v.estado !== "anulada" && v.estado !== "borrador"
  );
  const q = buscar.trim().toLowerCase();
  const filtradas = q
    ? ventas.filter((v: any) => v.cliente_nombre.toLowerCase().includes(q) || String(v.numero) === q)
    : ventas.slice(0, 40);

  return (
    <Modal titulo="¿De qué venta es el remito?" ancho onCerrar={onCerrar}>
      <Error msg={error} />
      <Campo label="Buscar venta">
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Cliente o N° de venta" autoFocus />
      </Campo>
      {cargando ? (
        <Cargando />
      ) : filtradas.length === 0 ? (
        <p className="mut">No hay ventas que coincidan.</p>
      ) : (
        <div className="lista-tarjetas" style={{ maxHeight: 380, overflowY: "auto" }}>
          {filtradas.map((v: any) => (
            <button
              key={v.id}
              className="auth-opcion"
              style={{ marginBottom: 6 }}
              onClick={() => onElegir(v.id)}
            >
              Venta #{v.numero} — {v.cliente_nombre}
              <div className="mut" style={{ fontWeight: 400 }}>{fecha(v.fecha)} · {pesos(v.total)}</div>
            </button>
          ))}
        </div>
      )}
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={onCerrar}>Cancelar</button>
      </div>
    </Modal>
  );
}

/** Paso 2: cuánto de cada cosa se entrega ahora. */
function ArmarRemito({ ventaId, onCerrar }: { ventaId: string; onCerrar: (m?: string) => void }) {
  const { data, error, cargando } = useCarga<any>(
    () => api.get(`/api/remitos/pendiente-de/${ventaId}`),
    [ventaId]
  );
  const [cant, setCant] = useState<Record<string, string>>({});
  const [f, setF] = useState({ fecha: hoyISO(), transporte: "", domicilio: "", nota: "" });
  const [err, setErr] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [inicializado, setInicializado] = useState(false);

  // Al cargar, propone entregar todo lo que falta: es lo más común.
  if (data && !inicializado) {
    const inicial: Record<string, string> = {};
    for (const l of data.lineas) inicial[l.herramienta_id] = String(l.pendiente);
    setCant(inicial);
    setF((x) => ({ ...x, domicilio: data.venta.domicilio ?? "" }));
    setInicializado(true);
  }

  async function guardar() {
    const items = (data?.lineas ?? [])
      .map((l: any) => ({ herramienta_id: l.herramienta_id, cantidad: Number(cant[l.herramienta_id]) || 0 }))
      .filter((it: any) => it.cantidad > 0);
    if (items.length === 0) { setErr("Poné al menos un producto con cantidad."); return; }
    setErr(null);
    setGuardando(true);
    try {
      const r = await api.post<{ numero: number }>("/api/remitos", { venta_id: ventaId, items, ...f });
      onCerrar(`Remito #${r.numero} creado.`);
    } catch (e: any) {
      setErr(e.message);
      setGuardando(false);
    }
  }

  const lineas = data?.lineas ?? [];
  const totalUnidades = lineas.reduce((s: number, l: any) => s + (Number(cant[l.herramienta_id]) || 0), 0);

  return (
    <Modal titulo={data ? `Remito de la venta #${data.venta.numero}` : "Nuevo remito"} ancho onCerrar={() => onCerrar()}>
      <Error msg={err ?? error} />
      {cargando ? (
        <Cargando />
      ) : !data ? null : data.todo_entregado ? (
        <>
          <p>De esta venta ya se entregó todo. No queda nada para remitar.</p>
          <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn primario" onClick={() => onCerrar()}>Entendido</button>
          </div>
        </>
      ) : (
        <>
          <p className="mut" style={{ marginTop: 0 }}>
            <b>{data.venta.cliente_nombre}</b> · Venta #{data.venta.numero} del {fecha(data.venta.fecha)}
          </p>

          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th><th className="num">Vendido</th>
                  <th className="num">Ya entregado</th><th className="num">Entrega ahora</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l: any) => (
                  <tr key={l.herramienta_id} className={l.pendiente === 0 ? "mut" : ""}>
                    <td>{l.nombre_herramienta}</td>
                    <td className="num">{l.vendido}</td>
                    <td className="num">{l.entregado}</td>
                    <td className="num" style={{ width: 120 }}>
                      <input
                        type="number" min="0" max={l.pendiente} className="num"
                        value={cant[l.herramienta_id] ?? ""}
                        disabled={l.pendiente === 0}
                        onChange={(e) => setCant({ ...cant, [l.herramienta_id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="fila" style={{ marginTop: 14 }}>
            <Campo label="Fecha"><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
            <Campo label="Transporte (opcional)">
              <input value={f.transporte} onChange={(e) => setF({ ...f, transporte: e.target.value })} placeholder="Quién lo lleva" />
            </Campo>
          </div>
          <Campo label="Domicilio de entrega">
            <input value={f.domicilio} onChange={(e) => setF({ ...f, domicilio: e.target.value })} />
          </Campo>
          <Campo label="Nota (opcional)">
            <textarea rows={2} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} />
          </Campo>

          <p className="mut">
            El remito no toca el stock: ya se descontó al confirmar la venta. Sólo documenta la entrega.
          </p>

          <div className="totales-envio">
            <div className="dt-list" style={{ gridTemplateColumns: "auto auto" }}>
              <dt><b>Se entregan</b></dt><dd><b>{totalUnidades} unidades</b></dd>
            </div>
            <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
              <button className="btn primario" disabled={guardando || totalUnidades === 0} onClick={guardar}>
                {guardando ? "Guardando…" : "Crear remito"}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
