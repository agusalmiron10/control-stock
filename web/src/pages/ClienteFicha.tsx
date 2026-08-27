import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, Modal, useCarga } from "../components/ui";
import { FormCliente } from "./Clientes";
import { FormPago } from "../components/FormPago";
import { Comprobante } from "../components/Comprobante";
import { exportarCliente } from "../excel";
import { waEstadoDeCuenta, waRecordatorioDeuda } from "../lib/whatsapp";
import { navegar } from "../lib/router";
import { qrClienteSvg } from "../lib/qr";
import { useModulo } from "../lib/config";
import { useFacturacionLista } from "../lib/facturacion";

const ETIQUETA_CONDICION_IVA: Record<string, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributista",
  exento: "Exento",
};

export function ClienteFicha({ id }: { id: string }) {
  const [editar, setEditar] = useState(false);
  const [pagoNuevo, setPagoNuevo] = useState(false);
  const [pagoEditar, setPagoEditar] = useState<any | null>(null);
  const [pagoBorrar, setPagoBorrar] = useState<any | null>(null);
  const [ventaAnular, setVentaAnular] = useState<any | null>(null);
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [archivar, setArchivar] = useState(false);
  const [verQr, setVerQr] = useState(false);
  const hayVentaRapida = useModulo("venta_rapida");
  const hayFacturacion = useFacturacionLista().listo;
  const [aviso, setAviso] = useState<string | null>(null);

  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/clientes/${id}`), [id]);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!data) return null;
  const c = data.cliente;

  function actualizar(msg?: string) {
    if (msg) setAviso(msg);
    recargar();
  }

  async function anularVenta() {
    if (!ventaAnular) return;
    try {
      await api.post(`/api/ventas/${ventaAnular.id}/anular`);
      setVentaAnular(null);
      actualizar(`Venta #${ventaAnular.numero} anulada. Se devolvió el stock y se liberaron sus pagos.`);
    } catch (err: any) { setAviso(err.message); setVentaAnular(null); }
  }

  async function borrarPago() {
    if (!pagoBorrar) return;
    await api.del(`/api/pagos/${pagoBorrar.id}`);
    setPagoBorrar(null);
    actualizar("Pago eliminado. Se recalculó la cuenta.");
  }

  async function hacerArchivar() {
    await api.post(`/api/clientes/${id}/archivar`, { activar: !c.activo });
    setArchivar(false);
    actualizar(c.activo ? "Cliente archivado." : "Cliente reactivado.");
  }

  const saldo = data.saldo;

  return (
    <div>
      <div className="encabezado-seccion">
        <div>
          <a href="#/clientes">← Clientes</a>
          <h1 style={{ marginTop: 4 }}>{c.nombre} {!c.activo && <span className="mut">(archivado)</span>}</h1>
        </div>
        <div className="btn-grupo">
          <button className="btn wa" onClick={() => waEstadoDeCuenta(c, data.saldo, data.total_comprado, data.total_pagado)}>
            WhatsApp: estado de cuenta
          </button>
          {data.saldo > 0 && (
            <button className="btn wa" onClick={() => waRecordatorioDeuda(c, data.saldo)}>Recordar deuda</button>
          )}
          <button className="btn" onClick={() => exportarCliente(id).catch((e) => setAviso(e.message))}>⬇ Excel</button>
          {hayVentaRapida && <button className="btn" onClick={() => setVerQr(true)}>QR del cliente</button>}
          <button className="btn" onClick={() => setEditar(true)}>Editar</button>
          <button className="btn" onClick={() => setArchivar(true)}>{c.activo ? "Archivar" : "Reactivar"}</button>
          <button className="btn primario" onClick={() => setPagoNuevo(true)}>+ Registrar pago</button>
        </div>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="grid-kpi">
        <div className="kpi"><div className="rot">Saldo</div>
          <div className={`val ${saldo > 0 ? "debe" : saldo < 0 ? "afavor" : ""}`}>
            {saldo < 0 ? `${pesos(-saldo)}` : pesos(saldo)}
          </div>
          <div className="mut">{saldo > 0 ? "debe" : saldo < 0 ? "a favor" : "al día"}</div>
        </div>
        <div className="kpi"><div className="rot">Total comprado</div><div className="val">{pesos(data.total_comprado)}</div></div>
        <div className="kpi"><div className="rot">Total pagado</div><div className="val">{pesos(data.total_pagado)}</div></div>
      </div>

      <div className="card">
        <h2>Datos</h2>
        <div className="card-body">
          <dl className="dt-list">
            <dt>Localidad</dt><dd>{c.localidad ?? "—"}</dd>
            <dt>Dirección</dt><dd>{c.direccion ?? "—"}</dd>
            <dt>Teléfono</dt><dd>{c.telefono ?? "—"}</dd>
            <dt>Email</dt><dd>{c.email ?? "—"}</dd>
            {hayFacturacion && (
              <>
                <dt>Documento</dt><dd>{c.doc_tipo ? `${c.doc_tipo} ${c.doc_numero}` : "Consumidor final"}</dd>
                <dt>Condición IVA</dt><dd>{ETIQUETA_CONDICION_IVA[c.condicion_iva ?? ""] ?? "Sin especificar"}</dd>
              </>
            )}
            <dt>Notas</dt><dd>{c.notas ?? "—"}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <h2>Ventas</h2>
        <div className="tabla-wrap solo-escritorio">
          {data.ventas.length === 0 ? (
            <Vacio mensaje="Este cliente todavía no tiene ventas."
              accion={<button className="btn primario" onClick={() => navegar("/ventas/nueva")}>Cargar una venta</button>} />
          ) : (
            <table className="tabla">
              <thead>
                <tr><th>Fecha</th><th className="num">N°</th><th className="num">Total</th>
                  <th className="num">Pagado</th><th className="num">Saldo</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {data.ventas.map((v: any) => (
                  <tr key={v.id} className={v.estado === "anulada" ? "archivado" : ""}>
                    <td className="num">{fecha(v.fecha)}</td>
                    <td className="num">{v.numero}</td>
                    <td className="num">{pesos(v.total)}</td>
                    <td className="num">{pesos(v.pagado)}</td>
                    <td className={`num ${v.saldo > 0 ? "debe" : ""}`}>{pesos(v.saldo)}</td>
                    <td><span className={`badge ${v.estado}`}>{v.estado}</span></td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setComprobante(v.id)}>Comprobante</button>
                        {v.estado !== "anulada" && (
                          <button className="btn chico peligro" onClick={() => setVentaAnular(v)}>Anular</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {data.ventas.length === 0 ? (
          <div className="solo-movil"><Vacio mensaje="Este cliente todavía no tiene ventas."
            accion={<button className="btn primario" onClick={() => navegar("/ventas/nueva")}>Cargar una venta</button>} /></div>
        ) : (
          <div className="card-body solo-movil lista-tarjetas">
            {data.ventas.map((v: any) => (
              <div className="tarjeta-fila" key={v.id}>
                <div className="tf-titulo">#{v.numero} <span className="mut" style={{ fontWeight: 400 }}>· {fecha(v.fecha)}</span></div>
                <div className="tf-datos">
                  <span className="num">{pesos(v.total)}</span>
                  <span className={`badge ${v.estado}`}>{v.estado}</span>
                  {v.saldo > 0 && <span className="num debe">Debe {pesos(v.saldo)}</span>}
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico" onClick={() => setComprobante(v.id)}>Comprobante</button>
                  {v.estado !== "anulada" && (
                    <button className="btn chico peligro" onClick={() => setVentaAnular(v)}>Anular</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Pagos</h2>
        <div className="tabla-wrap solo-escritorio">
          {data.pagos.length === 0 ? (
            <Vacio mensaje="Todavía no registraste pagos de este cliente." />
          ) : (
            <table className="tabla">
              <thead>
                <tr><th>Fecha</th><th className="num">Monto</th><th>Medio</th><th>Aplicado a</th><th>Nota</th><th></th></tr>
              </thead>
              <tbody>
                {data.pagos.map((p: any) => (
                  <tr key={p.id}>
                    <td className="num">{fecha(p.fecha)}</td>
                    <td className="num saldado">{pesos(p.monto)}</td>
                    <td>{p.medio}</td>
                    <td>{p.venta_numero ? `Venta #${p.venta_numero}` : <span className="mut">A cuenta</span>}</td>
                    <td>{p.nota ?? "—"}</td>
                    <td className="acc">
                      <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                        <button className="btn chico" onClick={() => setPagoEditar(p)}>Editar</button>
                        <button className="btn chico peligro" onClick={() => setPagoBorrar(p)}>Borrar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {data.pagos.length === 0 ? (
          <div className="solo-movil"><Vacio mensaje="Todavía no registraste pagos de este cliente." /></div>
        ) : (
          <div className="card-body solo-movil lista-tarjetas">
            {data.pagos.map((p: any) => (
              <div className="tarjeta-fila" key={p.id}>
                <div className="tf-titulo">{pesos(p.monto)} <span className="mut" style={{ fontWeight: 400 }}>· {fecha(p.fecha)} · {p.medio}</span></div>
                <div className="tf-datos">
                  <span className="mut">{p.venta_numero ? `Venta #${p.venta_numero}` : "A cuenta"}{p.nota ? ` · ${p.nota}` : ""}</span>
                </div>
                <div className="tf-datos" style={{ marginTop: 8 }}>
                  <button className="btn chico" onClick={() => setPagoEditar(p)}>Editar</button>
                  <button className="btn chico peligro" onClick={() => setPagoBorrar(p)}>Borrar</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editar && <FormCliente cliente={c} onCerrar={(m) => { setEditar(false); actualizar(m); }} />}
      {comprobante && <Comprobante ventaId={comprobante} onCerrar={() => setComprobante(null)} />}
      {pagoNuevo && <FormPago clienteFijo={{ id, nombre: c.nombre }} onCerrar={(m) => { setPagoNuevo(false); actualizar(m); }} />}
      {pagoEditar && <FormPago clienteFijo={{ id, nombre: c.nombre }} pago={pagoEditar} onCerrar={(m) => { setPagoEditar(null); actualizar(m); }} />}

      {pagoBorrar && (
        <Confirmar mensaje={`¿Borrar el pago de ${pesos(pagoBorrar.monto)} del ${fecha(pagoBorrar.fecha)}? Se recalcula toda la cuenta.`}
          textoConfirmar="Borrar" peligro onSi={borrarPago} onNo={() => setPagoBorrar(null)} />
      )}
      {ventaAnular && (
        <Confirmar mensaje={`¿Anular la venta #${ventaAnular.numero} por ${pesos(ventaAnular.total)}? Devuelve el stock y libera los pagos imputados.`}
          textoConfirmar="Anular venta" peligro onSi={anularVenta} onNo={() => setVentaAnular(null)} />
      )}
      {archivar && (
        <Confirmar mensaje={c.activo ? `¿Archivar a ${c.nombre}?` : `¿Reactivar a ${c.nombre}?`}
          textoConfirmar={c.activo ? "Archivar" : "Reactivar"} peligro={!!c.activo}
          onSi={hacerArchivar} onNo={() => setArchivar(false)} />
      )}

      {verQr && (
        <Modal titulo={`QR de ${c.nombre}`} onCerrar={() => setVerQr(false)} pie={<button className="btn" onClick={() => setVerQr(false)}>Cerrar</button>}>
          <p className="mut" style={{ marginTop: 0 }}>
            Imprimilo o guardalo. Escaneado desde "Venta rápida" en el celular elige a este cliente al toque, sin señal.
          </p>
          <div style={{ maxWidth: 260, margin: "0 auto" }} dangerouslySetInnerHTML={{ __html: qrClienteSvg(id) }} />
        </Modal>
      )}
    </div>
  );
}
