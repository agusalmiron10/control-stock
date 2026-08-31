import { useMemo, useState } from "react";
import { api } from "../api";
import { pesos, fecha, aCentavos, hoyISO, numero } from "../format";
import { Cargando, Error, Vacio, Modal, Campo, Confirmar, useCarga } from "../components/ui";
import { useVocab } from "../lib/config";

interface Compra {
  id: string;
  numero: number;
  proveedor_id: string;
  proveedor_nombre: string;
  fecha: string;
  comprobante: string | null;
  total: number;
  nota: string | null;
  estado: "registrada" | "anulada";
  renglones: number;
}

export function Compras() {
  const [nueva, setNueva] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [anular, setAnular] = useState<Compra | null>(null);
  const [borrar, setBorrar] = useState<Compra | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, error: errCarga, cargando, recargar } = useCarga<{ compras: Compra[]; total_periodo: number }>(
    () => api.get("/api/compras"),
    []
  );

  async function hacerAnular() {
    if (!anular) return;
    try {
      await api.post(`/api/compras/${anular.id}/anular`);
      setAviso(`Compra #${anular.numero} anulada. El stock volvió atrás.`);
      setAnular(null);
      recargar();
    } catch (err: any) {
      setError(err.message);
      setAnular(null);
    }
  }

  async function hacerBorrar() {
    if (!borrar) return;
    try {
      await api.del(`/api/compras/${borrar.id}`);
      setAviso(`Compra #${borrar.numero} borrada.`);
      setBorrar(null);
      recargar();
    } catch (err: any) {
      setError(err.message);
      setBorrar(null);
    }
  }

  const lista = data?.compras ?? [];

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Compras</h1>
        <button className="btn primario" onClick={() => setNueva(true)}>+ Nueva compra</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      <Error msg={error ?? errCarga} />

      {data && lista.length > 0 && (
        <div className="grid-kpi">
          <div className="kpi">
            <div className="rot">Total comprado</div>
            <div className="val">{pesos(data.total_periodo)}</div>
            <div className="mut">{numero(lista.filter((c) => c.estado === "registrada").length)} compras</div>
          </div>
        </div>
      )}

      {cargando ? (
        <Cargando />
      ) : lista.length === 0 ? (
        <Vacio
          icono="📦"
          titulo="Acá registrás lo que le comprás a tus proveedores"
          mensaje="Al cargar una compra, el stock de cada producto sube solo y su costo se recalcula
                   mezclando lo que ya tenías con lo que entra. Eso es lo que después te deja saber
                   cuánto ganás de verdad en cada venta."
          accion={<button className="btn primario" onClick={() => setNueva(true)}>Registrar la primera compra</button>}
        />
      ) : (
        <div className="card">
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead>
                <tr>
                  <th className="num">N°</th><th>Fecha</th><th>Proveedor</th>
                  <th>Comprobante</th><th className="num">Total</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((co) => (
                  <tr key={co.id}>
                    <td className="num">{co.numero}</td>
                    <td className="num">{fecha(co.fecha)}</td>
                    <td>
                      {co.proveedor_nombre}
                      {co.estado === "anulada" && <span className="badge anulada" style={{ marginLeft: 6 }}>anulada</span>}
                    </td>
                    <td>{co.comprobante ?? "—"}</td>
                    <td className="num">{pesos(co.total)}</td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setDetalle(co.id)}>Ver</button>
                        {co.estado === "registrada" ? (
                          <button className="btn chico peligro" onClick={() => setAnular(co)}>Anular</button>
                        ) : (
                          <button className="btn chico peligro" onClick={() => setBorrar(co)}>Borrar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card-body solo-movil lista-tarjetas">
            {lista.map((co) => (
              <div className="tarjeta-fila" key={co.id}>
                <div className="tf-titulo">
                  #{co.numero} — {co.proveedor_nombre}
                  <span className="mut" style={{ fontWeight: 400 }}> · {fecha(co.fecha)}</span>
                </div>
                <div className="tf-datos">
                  <span className="num">{pesos(co.total)}</span>
                  {co.estado === "anulada" && <span className="badge anulada">anulada</span>}
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico" onClick={() => setDetalle(co.id)}>Ver</button>
                  {co.estado === "registrada" ? (
                    <button className="btn chico peligro" onClick={() => setAnular(co)}>Anular</button>
                  ) : (
                    <button className="btn chico peligro" onClick={() => setBorrar(co)}>Borrar</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {nueva && (
        <NuevaCompra onCerrar={(mensaje) => { setNueva(false); if (mensaje) { setAviso(mensaje); recargar(); } }} />
      )}
      {detalle && <DetalleCompra id={detalle} onCerrar={() => setDetalle(null)} />}
      {borrar && (
        <Confirmar
          mensaje={`¿Borrar la compra #${borrar.numero} de la lista? Ya está anulada, así que el stock no cambia — sólo desaparece del historial. No se puede deshacer.`}
          textoConfirmar="Borrar"
          peligro
          onSi={hacerBorrar}
          onNo={() => setBorrar(null)}
        />
      )}
      {anular && (
        <Confirmar
          mensaje={`¿Anular la compra #${anular.numero} a ${anular.proveedor_nombre} por ${pesos(anular.total)}? El stock que había entrado se va a descontar.`}
          textoConfirmar="Anular"
          peligro
          onSi={hacerAnular}
          onNo={() => setAnular(null)}
        />
      )}
    </div>
  );
}

interface Reng { herramienta_id: string; cantidad: string; costo: string }

function NuevaCompra({ onCerrar }: { onCerrar: (mensaje?: string) => void }) {
  const vocab = useVocab();
  const provQ = useCarga<any>(() => api.get("/api/compras/proveedores"), []);
  const herrQ = useCarga<any>(() => api.get("/api/herramientas"), []);
  const herramientas = herrQ.data?.herramientas ?? [];

  const [proveedorId, setProveedorId] = useState("");
  const [fechaC, setFechaC] = useState(hoyISO());
  const [comprobante, setComprobante] = useState("");
  const [nota, setNota] = useState("");
  const [items, setItems] = useState<Reng[]>([{ herramienta_id: "", cantidad: "1", costo: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const total = useMemo(
    () => items.reduce((s, it) => s + (Number(it.cantidad) || 0) * aCentavos(it.costo || "0"), 0),
    [items]
  );

  function cambiar(i: number, campo: keyof Reng, valor: string) {
    setItems((arr) => {
      const copia = [...arr];
      copia[i] = { ...copia[i], [campo]: valor };
      // Al elegir un producto, se propone el último costo conocido.
      if (campo === "herramienta_id" && !copia[i].costo) {
        const h = herramientas.find((x: any) => x.id === valor);
        if (h?.costo) copia[i].costo = String(h.costo / 100);
      }
      return copia;
    });
  }

  async function guardar() {
    const renglones = items.filter((it) => it.herramienta_id && Number(it.cantidad) > 0);
    if (!proveedorId) { setError("Elegí a qué proveedor le compraste."); return; }
    if (renglones.length === 0) { setError("Cargá al menos un producto."); return; }
    setError(null);
    setGuardando(true);
    try {
      const r = await api.post<{ numero: number }>("/api/compras", {
        proveedor_id: proveedorId,
        fecha: fechaC,
        comprobante,
        nota,
        items: renglones.map((it) => ({
          herramienta_id: it.herramienta_id,
          cantidad: Number(it.cantidad),
          costo_unitario: aCentavos(it.costo || "0"),
        })),
      });
      onCerrar(`Compra #${r.numero} registrada. El stock ya subió.`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  const proveedores = (provQ.data?.proveedores ?? []).filter((p: any) => p.activo);

  return (
    <Modal titulo="Nueva compra" ancho onCerrar={() => onCerrar()}>
      <Error msg={error} />
      {provQ.cargando || herrQ.cargando ? (
        <Cargando />
      ) : proveedores.length === 0 ? (
        <p>Primero cargá un proveedor en la pantalla de Proveedores.</p>
      ) : (
        <>
          <div className="fila">
            <Campo label="Proveedor">
              <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                <option value="">Elegí…</option>
                {proveedores.map((p: any) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            <Campo label="Fecha">
              <input type="date" value={fechaC} onChange={(e) => setFechaC(e.target.value)} />
            </Campo>
          </div>
          <Campo label="N° de factura del proveedor (opcional)">
            <input value={comprobante} onChange={(e) => setComprobante(e.target.value)} placeholder="0001-00001234" />
          </Campo>

          <h3 style={{ marginBottom: 8 }}>Qué compraste</h3>
          {items.map((it, i) => (
            <div className="fila" key={i} style={{ alignItems: "flex-end" }}>
              <Campo label={i === 0 ? vocab.singular : ""}>
                <select value={it.herramienta_id} onChange={(e) => cambiar(i, "herramienta_id", e.target.value)}>
                  <option value="">Elegí…</option>
                  {herramientas.map((h: any) => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                </select>
              </Campo>
              <Campo label={i === 0 ? "Cantidad" : ""}>
                <input type="number" min="1" value={it.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} />
              </Campo>
              <Campo label={i === 0 ? "Costo c/u" : ""}>
                <input type="number" step="0.01" min="0" value={it.costo} onChange={(e) => cambiar(i, "costo", e.target.value)} />
              </Campo>
              <button
                className="btn chico"
                style={{ marginBottom: 12 }}
                onClick={() => setItems((arr) => (arr.length === 1 ? arr : arr.filter((_, j) => j !== i)))}
              >
                Quitar
              </button>
            </div>
          ))}
          <button className="btn chico" onClick={() => setItems((arr) => [...arr, { herramienta_id: "", cantidad: "1", costo: "" }])}>
            + Agregar renglón
          </button>

          <Campo label="Nota (opcional)">
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} />
          </Campo>

          <p className="mut">
            Al guardar, el stock de cada {vocab.singular.toLowerCase()} sube y su costo se recalcula como promedio
            entre lo que ya tenías y lo que entra.
          </p>

          <div className="totales-envio">
            <div className="dt-list" style={{ gridTemplateColumns: "auto auto" }}>
              <dt><b>Total de la compra</b></dt><dd><b>{pesos(total)}</b></dd>
            </div>
            <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
              <button className="btn primario" disabled={guardando} onClick={guardar}>
                {guardando ? "Guardando…" : "Registrar compra"}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function DetalleCompra({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/compras/${id}`), [id]);

  return (
    <Modal titulo={data ? `Compra #${data.compra.numero}` : "Compra"} onCerrar={onCerrar}>
      <Error msg={error} />
      {cargando ? (
        <Cargando />
      ) : !data ? null : (
        <>
          <div className="dt-list">
            <dt>Proveedor</dt><dd>{data.compra.proveedor_nombre}</dd>
            <dt>Fecha</dt><dd>{fecha(data.compra.fecha)}</dd>
            {data.compra.comprobante && (<><dt>Comprobante</dt><dd>{data.compra.comprobante}</dd></>)}
            {data.compra.estado === "anulada" && (<><dt>Estado</dt><dd><span className="badge anulada">anulada</span></dd></>)}
          </div>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr><th>Producto</th><th className="num">Cant.</th><th className="num">Costo c/u</th><th className="num">Subtotal</th></tr>
              </thead>
              <tbody>
                {data.items.map((it: any) => (
                  <tr key={it.id}>
                    <td>{it.nombre_herramienta}</td>
                    <td className="num">{numero(it.cantidad)}</td>
                    <td className="num">{pesos(it.costo_unitario)}</td>
                    <td className="num">{pesos(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dt-list" style={{ gridTemplateColumns: "auto auto", marginTop: 12 }}>
            <dt><b>Total</b></dt><dd><b>{pesos(data.compra.total)}</b></dd>
          </div>
          {data.compra.nota && <p className="mut">{data.compra.nota}</p>}
        </>
      )}
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn primario" onClick={onCerrar}>Cerrar</button>
      </div>
    </Modal>
  );
}
