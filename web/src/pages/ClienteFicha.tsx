import { useState } from "react";
import { api } from "../api";
import { pesos, fecha } from "../format";
import { Cargando, Error, Vacio, Confirmar, useCarga } from "../components/ui";
import { FormCliente } from "./Clientes";
import { FormPago } from "../components/FormPago";
import { Comprobante } from "../components/Comprobante";
import { exportarCliente } from "../excel";
import { waEstadoDeCuenta, waRecordatorioDeuda } from "../lib/whatsapp";
import { navegar } from "../lib/router";

export function ClienteFicha({ id }: { id: number }) {
  const [editar, setEditar] = useState(false);
  const [pagoNuevo, setPagoNuevo] = useState(false);
  const [pagoEditar, setPagoEditar] = useState<any | null>(null);
  const [pagoBorrar, setPagoBorrar] = useState<any | null>(null);
  const [ventaAnular, setVentaAnular] = useState<any | null>(null);
  const [comprobante, setComprobante] = useState<number | null>(null);
  const [archivar, setArchivar] = useState(false);
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
            <dt>Notas</dt><dd>{c.notas ?? "—"}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <h2>Ventas</h2>
        <div className="tabla-wrap">
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
      </div>

      <div className="card">
        <h2>Pagos</h2>
        <div className="tabla-wrap">
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
    </div>
  );
}
