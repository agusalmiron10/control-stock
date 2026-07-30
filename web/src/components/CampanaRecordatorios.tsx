import { useState } from "react";
import { pesos } from "../format";
import { Modal } from "./ui";
import { waRecordatorioDeuda } from "../lib/whatsapp";

interface Deudor { cliente_id: string; nombre: string; saldo: number; telefono: string | null }

/**
 * WhatsApp no tiene un "enviar a todos" real desde wa.me (cada link abre un
 * chat distinto) — esto guía el envío uno por uno en vez de tener que ir
 * cliente por cliente desde Cobranzas.
 */
export function CampanaRecordatorios({ deudores, onCerrar }: { deudores: Deudor[]; onCerrar: () => void }) {
  const conTelefono = deudores.filter((d) => d.telefono);
  const [i, setI] = useState(0);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());

  if (conTelefono.length === 0) {
    return (
      <Modal titulo="Recordar a todos" onCerrar={onCerrar} pie={<button className="btn" onClick={onCerrar}>Cerrar</button>}>
        <p className="mut" style={{ margin: 0 }}>Ninguno de los que deben tiene teléfono cargado.</p>
      </Modal>
    );
  }

  const actual = conTelefono[i];
  const terminado = i >= conTelefono.length;

  function enviarYSiguiente() {
    waRecordatorioDeuda(actual, actual.saldo);
    setEnviados((s) => new Set(s).add(actual.cliente_id));
    setI((n) => n + 1);
  }

  return (
    <Modal titulo="Recordar a todos" onCerrar={onCerrar} pie={<button className="btn" onClick={onCerrar}>Cerrar</button>}>
      <p className="mut" style={{ marginTop: 0 }}>
        Se abre un chat de WhatsApp por vez — mandalo y seguí con el próximo. {enviados.size} de {conTelefono.length} enviados.
      </p>
      {terminado ? (
        <p><b>Listo, no quedan más pendientes.</b></p>
      ) : (
        <div className="tarjeta-fila" style={{ border: "1px solid var(--borde)", borderRadius: 8, padding: 12 }}>
          <div className="tf-titulo">{actual.nombre}</div>
          <div className="tf-datos">
            <span className="num debe">{pesos(actual.saldo)}</span>
            <span className="mut">{actual.telefono}</span>
          </div>
          <div className="tf-datos" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => setI((n) => n + 1)}>Saltar</button>
            <button className="btn primario wa" onClick={enviarYSiguiente}>WhatsApp y siguiente →</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
