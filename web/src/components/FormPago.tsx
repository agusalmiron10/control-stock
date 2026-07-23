import { useEffect, useState } from "react";
import { api } from "../api";
import { pesos, aCentavos, aPesos, hoyISO } from "../format";
import { Modal, Campo, Error } from "./ui";

const MEDIOS = ["efectivo", "transferencia", "cheque", "otro"];

/**
 * Alta o edición de un pago. Si viene clienteFijo, el cliente no se puede cambiar.
 * Permite imputar a una venta puntual o dejarlo "a cuenta" (FIFO).
 */
export function FormPago({
  clienteFijo,
  pago,
  onCerrar,
}: {
  clienteFijo?: { id: number; nombre: string };
  pago?: any;
  onCerrar: (msg?: string) => void;
}) {
  const editar = !!pago;
  const [clienteId, setClienteId] = useState<number | "">(clienteFijo?.id ?? pago?.cliente_id ?? "");
  const [clientes, setClientes] = useState<any[]>([]);
  const [ventas, setVentas] = useState<any[]>([]);
  const [ventaId, setVentaId] = useState<string>(pago?.venta_id ? String(pago.venta_id) : "");
  const [fecha, setFecha] = useState(pago?.fecha ?? hoyISO());
  const [monto, setMonto] = useState(pago ? String(aPesos(pago.monto)) : "");
  const [medio, setMedio] = useState(pago?.medio ?? "efectivo");
  const [nota, setNota] = useState(pago?.nota ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!clienteFijo) api.get<any>("/api/clientes").then((d) => setClientes(d.clientes)).catch(() => {});
  }, [clienteFijo]);

  useEffect(() => {
    if (!clienteId) { setVentas([]); return; }
    api.get<any>(`/api/clientes/${clienteId}`)
      .then((d) => setVentas(d.ventas.filter((v: any) => v.estado !== "anulada")))
      .catch(() => setVentas([]));
  }, [clienteId]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clienteId) { setError("Elegí un cliente."); return; }
    setGuardando(true);
    const body = {
      cliente_id: Number(clienteId),
      venta_id: ventaId ? Number(ventaId) : null,
      fecha, monto: aCentavos(monto), medio, nota,
    };
    try {
      if (editar) await api.put(`/api/pagos/${pago.id}`, body);
      else await api.post("/api/pagos", body);
      onCerrar(editar ? "Pago actualizado." : "Pago registrado.");
    } catch (err: any) { setError(err.message); } finally { setGuardando(false); }
  }

  return (
    <Modal titulo={editar ? "Editar pago" : "Registrar pago"} onCerrar={() => onCerrar()}
      pie={<><button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" form="fpago" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button></>}>
      <form id="fpago" onSubmit={guardar}>
        <Error msg={error} />
        {clienteFijo ? (
          <p className="mut">Cliente: <b>{clienteFijo.nombre}</b></p>
        ) : (
          <Campo label="Cliente">
            <select value={clienteId} onChange={(e) => { setClienteId(e.target.value ? Number(e.target.value) : ""); setVentaId(""); }} disabled={editar}>
              <option value="">Elegí un cliente…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
        )}
        <Campo label="Aplicar a">
          <select value={ventaId} onChange={(e) => setVentaId(e.target.value)}>
            <option value="">A cuenta (se imputa a las ventas más viejas)</option>
            {ventas.map((v) => (
              <option key={v.id} value={v.id}>
                Venta #{v.numero} — {pesos(v.total)} ({v.estado}{v.estado !== "pagada" ? `, debe ${pesos(v.saldo)}` : ""})
              </option>
            ))}
          </select>
        </Campo>
        <div className="fila">
          <Campo label="Monto ($)">
            <input className="num" type="number" step="0.01" min={0} value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />
          </Campo>
          <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        </div>
        <div className="fila">
          <Campo label="Medio">
            <select value={medio} onChange={(e) => setMedio(e.target.value)}>
              {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Campo>
        </div>
        <Campo label="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
      </form>
    </Modal>
  );
}
