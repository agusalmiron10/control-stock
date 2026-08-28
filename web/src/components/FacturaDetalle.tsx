import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { Modal, Error, Cargando, useCarga } from "./ui";

const TEXTO_ESTADO: Record<string, string> = {
  autorizada: "Autorizada",
  rechazada: "Rechazada",
  error: "Con error",
  pendiente: "Pendiente",
  huerfano: "Sin confirmar",
};
const BADGE: Record<string, string> = {
  autorizada: "pagada",
  rechazada: "impaga",
  error: "impaga",
  pendiente: "parcial",
  huerfano: "parcial",
};

const CONDICION: Record<string, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
  consumidor_final: "Consumidor Final",
};

/** ARCA devuelve el vencimiento del CAE como yyyyMMdd. */
function fechaCae(v: string | null): string {
  if (!v) return "—";
  if (/^\d{8}$/.test(v)) return fecha(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
  return fecha(v.slice(0, 10));
}

interface Props {
  id: string;
  onCerrar: () => void;
  /** Para reimprimir: la vista de comprobante fiscal se abre desde afuera. */
  onImprimir?: (ventaId: string) => void;
  onVerificar?: () => void;
  onReintentar?: (ventaId: string) => void;
}

/** Ficha completa de un comprobante: quién, qué, cuánto y qué dijo ARCA. */
export function FacturaDetalle({ id, onCerrar, onImprimir, onVerificar, onReintentar }: Props) {
  const { data, error, cargando } = useCarga<any>(() => api.get(`/api/facturacion/facturas/${id}`), [id]);
  const f = data?.factura;

  return (
    <Modal titulo={f ? `${f.comprobante} ${f.numero_formateado ?? ""}`.trim() : "Comprobante"} ancho onCerrar={onCerrar}>
      <Error msg={error} />
      {cargando ? (
        <Cargando />
      ) : !f ? null : (
        <>
          <div className="tf-datos" style={{ marginBottom: 14 }}>
            <span className={`badge ${BADGE[f.estado] ?? ""}`}>{TEXTO_ESTADO[f.estado] ?? f.estado}</span>
            {data.nota_credito && <span className="badge anulada">Anulada por Nota de Crédito</span>}
            {data.emisor?.ambiente === "homologacion" && (
              <span className="badge parcial">Modo prueba</span>
            )}
          </div>

          {/* El CAE es el dato que se reclama y se copia: va arriba y grande. */}
          {f.estado === "autorizada" && f.cae && (
            <div className="cae-caja">
              <div className="rot">CAE</div>
              <div className="val">{f.cae}</div>
              <div className="mut">Vence el {fechaCae(f.cae_vencimiento)}</div>
            </div>
          )}

          {f.motivo && f.estado !== "autorizada" && (
            <div className="pill-alerta">
              <b>Qué pasó:</b> {f.motivo}
            </div>
          )}

          <h3 style={{ marginBottom: 4 }}>Cliente</h3>
          <dl className="detalle-filas">
            <div className="detalle-fila"><dt>Nombre</dt><dd>{f.cliente_nombre}</dd></div>
            <div className="detalle-fila">
              <dt>Documento</dt>
              <dd>{f.cliente_doc_tipo && f.cliente_doc_numero
                ? `${f.cliente_doc_tipo} ${f.cliente_doc_numero}`
                : "Consumidor final (sin documento)"}</dd>
            </div>
            <div className="detalle-fila">
              <dt>Condición IVA</dt>
              <dd>{CONDICION[f.cliente_condicion_iva] ?? "Consumidor Final"}</dd>
            </div>
            {(f.cliente_localidad || f.cliente_direccion) && (
              <div className="detalle-fila">
                <dt>Domicilio</dt>
                <dd>{[f.cliente_direccion, f.cliente_localidad].filter(Boolean).join(", ")}</dd>
              </div>
            )}
          </dl>

          <h3 style={{ marginBottom: 4, marginTop: 18 }}>Qué se vendió</h3>
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Detalle</th><th className="num">Cant.</th>
                  <th className="num">Precio</th><th className="num">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it: any) => (
                  <tr key={it.id}>
                    <td>{it.nombre_herramienta}</td>
                    <td className="num">{numero(it.cantidad)}</td>
                    <td className="num">{pesos(it.precio_unitario)}</td>
                    <td className="num">{pesos(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginBottom: 4, marginTop: 18 }}>Importes</h3>
          <dl className="detalle-filas">
            <div className="detalle-fila"><dt>Neto gravado</dt><dd>{pesos(f.neto_gravado)}</dd></div>
            <div className="detalle-fila">
              <dt>IVA {(f.iva_porcentaje / 100).toFixed(2).replace(".", ",")}%</dt>
              <dd>{pesos(f.iva)}</dd>
            </div>
            <div className="detalle-fila fuerte"><dt>Total</dt><dd>{pesos(f.total)}</dd></div>
          </dl>

          <h3 style={{ marginBottom: 4, marginTop: 18 }}>Comprobante</h3>
          <dl className="detalle-filas">
            <div className="detalle-fila"><dt>Tipo</dt><dd>{f.comprobante}</dd></div>
            <div className="detalle-fila"><dt>Número</dt><dd>{f.numero_formateado ?? "Todavía sin número"}</dd></div>
            <div className="detalle-fila"><dt>Punto de venta</dt><dd>{String(f.punto_venta).padStart(5, "0")}</dd></div>
            <div className="detalle-fila">
              <dt>Emitida</dt>
              <dd>{fecha((f.autorizado_en ?? f.creado_en).slice(0, 10))}</dd>
            </div>
            <div className="detalle-fila">
              <dt>Venta</dt>
              <dd>#{f.venta_numero} del {fecha(f.venta_fecha)}</dd>
            </div>
            {data.emisor?.cuit && (
              <div className="detalle-fila"><dt>CUIT del emisor</dt><dd>{data.emisor.cuit}</dd></div>
            )}
          </dl>

          {data.nota_credito && (
            <div className="pill-alerta" style={{ marginTop: 14 }}>
              Esta factura fue anulada con una Nota de Crédito
              {data.nota_credito.numero
                ? ` (${String(data.nota_credito.punto_venta).padStart(5, "0")}-${String(data.nota_credito.numero).padStart(8, "0")})`
                : ""}
              {data.nota_credito.cae ? ` · CAE ${data.nota_credito.cae}` : ""}.
            </div>
          )}

          <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" onClick={onCerrar}>Cerrar</button>
            {f.estado === "autorizada" && onImprimir && (
              <button className="btn primario" onClick={() => onImprimir(f.venta_id)}>Ver / Imprimir</button>
            )}
            {f.estado === "huerfano" && onVerificar && (
              <button className="btn primario" onClick={onVerificar}>Verificar con ARCA</button>
            )}
            {(f.estado === "rechazada" || f.estado === "error") && onReintentar && (
              <button className="btn primario" onClick={() => onReintentar(f.venta_id)}>Reintentar</button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
