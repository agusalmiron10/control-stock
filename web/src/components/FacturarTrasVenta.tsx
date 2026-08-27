import { useState } from "react";
import { Modal } from "./ui";
import { EmitirFacturaModal } from "./EmitirFacturaModal";

interface Props {
  venta: { id: string; numero: number };
  /** Se llama al terminar (haya facturado o no). El mensaje, si viene, es para mostrar en la pantalla siguiente. */
  onListo: (mensaje?: string) => void;
}

/**
 * Después de guardar una venta, ofrecer facturarla en el momento. Antes había
 * que ir hasta Ventas, buscar la venta y recién ahí facturar — para el que
 * factura todo el día eso son tres pasos al pedo por venta.
 */
export function FacturarTrasVenta({ venta, onListo }: Props) {
  const [emitiendo, setEmitiendo] = useState(false);

  if (emitiendo) {
    return <EmitirFacturaModal ventaId={venta.id} onCerrar={(mensaje) => onListo(mensaje)} />;
  }

  return (
    <Modal titulo={`Venta #${venta.numero} guardada`} onCerrar={() => onListo()}>
      <p style={{ marginTop: 0 }}>¿Querés facturarla ahora?</p>
      <p className="mut">Si no, podés hacerlo después desde Ventas o desde Facturas.</p>
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onListo()}>Después</button>
        <button className="btn primario" onClick={() => setEmitiendo(true)}>Facturar ahora</button>
      </div>
    </Modal>
  );
}
