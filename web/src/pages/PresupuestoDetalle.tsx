import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Modal, Campo, Confirmar, useCarga } from "../components/ui";
import { waPresupuesto, waRecordatorioPresupuesto } from "../lib/whatsapp";
import { navegar } from "../lib/router";
import { generarPdfPresupuesto } from "../lib/pdf";
import { compartirArchivo, mensajeCompartir } from "../lib/compartirArchivo";

const MEDIOS = ["efectivo", "mercado_pago", "tarjeta", "transferencia", "cheque", "otro"];
const ETIQUETA_MEDIO: Record<string, string> = {
  efectivo: "Efectivo", mercado_pago: "Mercado Pago", tarjeta: "Tarjeta",
  transferencia: "Transferencia", cheque: "Cheque", otro: "Otro",
};

export function PresupuestoDetalle({ id }: { id: number }) {
  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/presupuestos/${id}`), [id]);
  const [convertir, setConvertir] = useState(false);
  const [rechazar, setRechazar] = useState(false);
  const [cancelarInsumos, setCancelarInsumos] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null);
  const [aprobando, setAprobando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);

  async function compartirPdf() {
    setError2(null);
    setGenerandoPdf(true);
    try {
      const blob = await generarPdfPresupuesto(data);
      const p = data.presupuesto;
      const resultado = await compartirArchivo(blob, `presupuesto-${p.numero}.pdf`, {
        titulo: `Presupuesto ${p.numero}`,
        texto: `Presupuesto de ${p.cliente_nombre}`,
      });
      setAviso(mensajeCompartir(resultado));
    } catch (err: any) {
      setError2("No se pudo generar el PDF: " + err.message);
    } finally {
      setGenerandoPdf(false);
    }
  }

  async function cambiarEstado(estado: string) {
    await api.post(`/api/presupuestos/${id}/estado`, { estado });
    setRechazar(false);
    recargar();
  }

  async function aprobarInsumos() {
    setError2(null);
    setAprobando(true);
    try {
      await api.post(`/api/presupuestos/${id}/insumos/aprobar`);
      setAviso("Materiales descontados. Presupuesto marcado como aceptado.");
      recargar();
    } catch (err: any) {
      setError2(err.message);
    } finally {
      setAprobando(false);
    }
  }

  async function cancelarInsumosStock() {
    try {
      await api.post(`/api/presupuestos/${id}/insumos/cancelar`);
      setCancelarInsumos(false);
      setAviso("Stock de materiales devuelto.");
      recargar();
    } catch (err: any) {
      setError2(err.message);
      setCancelarInsumos(false);
    }
  }

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data) return null;
  const p = data.presupuesto;
  const cliente = { nombre: p.cliente_nombre, telefono: p.cliente_telefono };

  return (
    <div>
      <div className="encabezado-seccion">
        <div>
          <a href="#/presupuestos">← Presupuestos</a>
          <h1 style={{ marginTop: 4 }}>Presupuesto #{p.numero}</h1>
        </div>
        <div className="btn-grupo">
          <button className="btn wa" onClick={() => waPresupuesto(cliente, p, data.items)}>WhatsApp: enviar</button>
          {p.estado === "pendiente" && (
            <button className="btn wa" onClick={() => waRecordatorioPresupuesto(cliente, p)}>Recordar</button>
          )}
          <button className="btn wa" disabled={generandoPdf} onClick={compartirPdf}>
            {generandoPdf ? "Generando PDF…" : "📄 Compartir PDF por WhatsApp"}
          </button>
        </div>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      <Error msg={error2} />

      <div className="card">
        <div className="card-body">
          <dl className="dt-list">
            <dt>Cliente</dt><dd><a href={`#/clientes/${p.cliente_id}`}>{p.cliente_nombre}</a></dd>
            <dt>Fecha</dt><dd>{fecha(p.fecha)}</dd>
            <dt>Válido hasta</dt><dd>{p.valido_hasta ? fecha(p.valido_hasta) : "—"}</dd>
            <dt>Estado</dt><dd><span className={`badge ${p.estado === "aceptado" ? "pagada" : p.estado === "rechazado" ? "impaga" : p.estado === "vencido" ? "anulada" : "parcial"}`}>{p.estado}</span></dd>
            {p.venta_id && <><dt>Venta generada</dt><dd><a href={`#/ventas`}>Venta #{p.venta_numero}</a></dd></>}
            {p.nota && <><dt>Nota</dt><dd>{p.nota}</dd></>}
          </dl>
          {p.croquis && (
            <img
              src={p.croquis}
              alt="Croquis del trabajo"
              style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: "1px solid var(--borde)", marginTop: 14 }}
            />
          )}
        </div>
      </div>

      <div className="card">
        <h2>Renglones</h2>
        <div className="tabla-wrap solo-escritorio">
          <table className="tabla">
            <thead><tr><th>Herramienta</th><th className="num">Cant.</th><th className="num">Precio unit.</th><th className="num">Subtotal</th></tr></thead>
            <tbody>
              {data.items.map((it: any) => (
                <tr key={it.id}>
                  <td>{it.nombre_herramienta}</td>
                  <td className="num">{it.cantidad}</td>
                  <td className="num">{pesos(it.precio_unitario)}</td>
                  <td className="num">{pesos(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body solo-movil lista-tarjetas">
          {data.items.map((it: any) => (
            <div className="tarjeta-fila" key={it.id}>
              <div className="tf-titulo">{it.nombre_herramienta}</div>
              <div className="tf-datos">
                <span>{it.cantidad} x {pesos(it.precio_unitario)}</span>
                <span className="num">{pesos(it.subtotal)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="card-body">
          <dl className="dt-list" style={{ gridTemplateColumns: "auto auto", marginLeft: "auto", width: 240 }}>
            <dt>Subtotal</dt><dd>{pesos(p.subtotal)}</dd>
            <dt>Descuento</dt><dd>{pesos(p.descuento)}</dd>
            <dt><b>Total</b></dt><dd><b>{pesos(p.total)}</b></dd>
          </dl>
        </div>
      </div>

      {data.insumos.length > 0 && (
        <div className="card taller-card">
          <h2>Materiales (Taller) <span className="mut" style={{ fontWeight: 400, fontSize: 13 }}>(interno, no aparece en lo impreso)</span></h2>
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead><tr><th>Material</th><th className="num">Cant.</th><th className="num">Costo</th></tr></thead>
              <tbody>
                {data.insumos.map((it: any) => (
                  <tr key={it.id}>
                    <td>{it.nombre_insumo}</td>
                    <td className="num">{it.cantidad_requerida}</td>
                    <td className="num">{pesos(it.costo_unitario * it.cantidad_requerida)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body">
            {(() => {
              const costoMateriales = data.insumos.reduce((acc: number, it: any) => acc + it.costo_unitario * it.cantidad_requerida, 0);
              const margen = p.total - costoMateriales;
              return (
                <dl className="dt-list" style={{ gridTemplateColumns: "auto auto", marginLeft: "auto", width: 280 }}>
                  <dt>Costo de materiales</dt><dd>{pesos(costoMateriales)}</dd>
                  <dt><b>Margen</b></dt><dd><b className={margen < 0 ? "stock-cero" : ""}>{pesos(margen)}</b></dd>
                </dl>
              );
            })()}
            {p.insumos_descontados_en ? (
              <div className="btn-grupo" style={{ marginTop: 12 }}>
                <span className="mut">Stock descontado el {fecha(p.insumos_descontados_en)}.</span>
                <button className="btn" onClick={() => setCancelarInsumos(true)}>Cancelar (devolver stock)</button>
              </div>
            ) : (
              <div className="btn-grupo" style={{ marginTop: 12 }}>
                <button className="btn primario" disabled={aprobando} onClick={aprobarInsumos}>
                  {aprobando ? "Descontando…" : "Aprobar y descontar materiales"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!p.venta_id && p.estado !== "rechazado" && (
        <div className="card">
          <h2>Acciones</h2>
          <div className="card-body btn-grupo">
            <button className="btn primario" onClick={() => setConvertir(true)}>Convertir a venta</button>
            <button className="btn" onClick={() => setRechazar(true)}>Marcar rechazado</button>
            {p.estado === "pendiente" && (
              <button className="btn" onClick={() => cambiarEstado("vencido")}>Marcar vencido</button>
            )}
          </div>
        </div>
      )}

      {cancelarInsumos && (
        <Confirmar
          mensaje="¿Cancelar? Se devuelve al stock exactamente lo que se había descontado de cada material."
          textoConfirmar="Cancelar y devolver stock"
          onSi={cancelarInsumosStock}
          onNo={() => setCancelarInsumos(false)}
        />
      )}

      {convertir && (
        <ConvertirModal presupuestoId={id} onCerrar={(msg) => {
          setConvertir(false);
          if (msg) { setAviso(msg); recargar(); }
        }} />
      )}
      {rechazar && (
        <Confirmar mensaje="¿Marcar este presupuesto como rechazado?" textoConfirmar="Rechazar" peligro
          onSi={() => cambiarEstado("rechazado")} onNo={() => setRechazar(false)} />
      )}
    </div>
  );
}

function ConvertirModal({ presupuestoId, onCerrar }: { presupuestoId: number; onCerrar: (msg?: string) => void }) {
  const [pagoModo, setPagoModo] = useState<"nada" | "total" | "libre">("nada");
  const [pagoLibre, setPagoLibre] = useState("");
  const [pagoMedio, setPagoMedio] = useState("efectivo");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function confirmar(force: boolean) {
    setError(null);
    setGuardando(true);
    const body: any = { permitir_stock_negativo: force };
    if (pagoModo === "total") body.pago_inicial = { monto: null, medio: pagoMedio }; // se resuelve abajo con el total real
    try {
      // Necesitamos el total real para "paga el total"; lo resolvemos leyendo el presupuesto si hace falta.
      if (pagoModo === "total") {
        const d = await api.get<any>(`/api/presupuestos/${presupuestoId}`);
        body.pago_inicial = { monto: d.presupuesto.total, medio: pagoMedio };
      } else if (pagoModo === "libre" && Number(pagoLibre) > 0) {
        body.pago_inicial = { monto: Math.round(Number(pagoLibre) * 100), medio: pagoMedio };
      }
      const r = await api.post<any>(`/api/presupuestos/${presupuestoId}/convertir`, body);
      onCerrar(`Convertido a venta #${r.numero}.`);
      navegar(`/ventas`);
    } catch (err: any) {
      if (err.status === 409 && !force) {
        setError(err.message + " Volvé a confirmar para continuar igual.");
        setGuardando(false);
        return;
      }
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Convertir a venta" onCerrar={() => onCerrar()}
      pie={<><button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={guardando} onClick={() => confirmar(false)}>{guardando ? "Convirtiendo…" : "Confirmar"}</button></>}>
      <Error msg={error} />
      <p className="mut">Esto crea la venta real: descuenta stock y genera los movimientos.</p>
      <Campo label="Pago en este momento">
        <select value={pagoModo} onChange={(e) => setPagoModo(e.target.value as any)}>
          <option value="nada">No paga nada ahora</option>
          <option value="total">Paga el total</option>
          <option value="libre">Monto libre</option>
        </select>
      </Campo>
      {pagoModo === "libre" && (
        <Campo label="Monto ($)"><input className="num" type="number" step="0.01" value={pagoLibre} onChange={(e) => setPagoLibre(e.target.value)} /></Campo>
      )}
      {pagoModo !== "nada" && (
        <Campo label="Medio de pago">
          <select value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)}>
            {MEDIOS.map((m) => <option key={m} value={m}>{ETIQUETA_MEDIO[m]}</option>)}
          </select>
        </Campo>
      )}
      {error && error.includes("Volvé a confirmar") && (
        <button className="btn peligro" style={{ marginTop: 8 }} onClick={() => confirmar(true)}>Vender igual (stock en negativo)</button>
      )}
    </Modal>
  );
}
