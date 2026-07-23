import { useState } from "react";
import { api } from "../api";
import { pesos, numero, aCentavos, hoyISO } from "../format";
import { Modal, Campo, Error } from "./ui";
import { useRol, esDueno } from "../lib/rol";

/**
 * Registrar producción. El costo del lote es opcional: si se carga, el
 * backend recalcula el costo de la herramienta como promedio ponderado
 * entre el stock existente y el lote nuevo. Un empleado no ve el costo.
 */
export function FormProduccion({ h, onCerrar }: { h: any; onCerrar: (m?: string) => void }) {
  const rol = useRol();
  const [cantidad, setCantidad] = useState("");
  const [costoLote, setCostoLote] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body: any = { cantidad: Number(cantidad), fecha, motivo };
      if (esDueno(rol) && costoLote) body.costo_lote = aCentavos(costoLote);
      await api.post(`/api/herramientas/${h.id}/produccion`, body);
      onCerrar(`Producción registrada: +${cantidad} de ${h.nombre}.`);
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal titulo={`Producción — ${h.nombre}`} onCerrar={() => onCerrar()}
      pie={<><button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" form="fp">Registrar</button></>}>
      <form id="fp" onSubmit={guardar}>
        <Error msg={error} />
        <p className="mut">Stock actual: <b>{numero(h.stock)}</b>{esDueno(rol) && <> · Costo actual: <b>{pesos(h.costo)}</b></>}</p>
        <div className="fila">
          <Campo label="Unidades fabricadas">
            <input className="num" type="number" min={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus />
          </Campo>
          <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        </div>
        {esDueno(rol) && (
          <Campo label="Costo del lote (opcional, $)">
            <input className="num" type="number" step="0.01" min={0} value={costoLote} onChange={(e) => setCostoLote(e.target.value)}
              placeholder="Materiales + mano de obra de este lote" />
          </Campo>
        )}
        <Campo label="Motivo (opcional)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
      </form>
    </Modal>
  );
}
