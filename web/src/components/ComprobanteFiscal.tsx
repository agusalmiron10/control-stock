import { api } from "../api";
import { pesos, fecha, numero } from "../format";
import { negocio } from "../lib/negocio";
import { qrArcaSvg } from "../lib/qr";
import { Cargando, Error, useCarga } from "./ui";
import { AtendidoPor } from "./AtendidoPor";

const LETRA_POR_TIPO: Record<number, "A" | "B" | "C"> = { 1: "A", 6: "B", 11: "C", 3: "A", 8: "B", 13: "C", 2: "A", 7: "B", 12: "C" };
const ES_NOTA_CREDITO: Record<number, boolean> = { 3: true, 8: true, 13: true };
const ES_NOTA_DEBITO = new Set([2, 7, 12]);

/** ARCA devuelve el vencimiento del CAE como "AAAAMMDD"; para mostrar, con guiones. */
function fechaAfip(aaaammdd: string | null | undefined): string {
  if (!aaaammdd || aaaammdd.length !== 8) return aaaammdd ?? "";
  return fecha(`${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6, 8)}`);
}

const CONDICION_IVA_LABEL: Record<string, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributista",
  exento: "Exento",
};

/** Comprobante fiscal imprimible: factura o nota de crédito, con CAE y QR de ARCA. */
export function ComprobanteFiscal({ ventaId, onCerrar }: { ventaId: string; onCerrar: () => void }) {
  const venta = useCarga<any>(() => api.get(`/api/ventas/${ventaId}`), [ventaId]);
  const facturas = useCarga<{ facturas: any[] }>(() => api.get(`/api/facturacion/ventas/${ventaId}`), [ventaId]);
  const emisor = useCarga<any>(() => api.get(`/api/facturacion/emisor`), []);

  const cargando = venta.cargando || facturas.cargando || emisor.cargando;
  const error = venta.error || facturas.error || emisor.error;
  // La más reciente autorizada: si hay NC, es la última fila (factura + su NC).
  // Se excluye la Nota de Débito a propósito: es un cargo aparte, no
  // reemplaza a la factura — sin este filtro, emitir una ND después de la
  // factura hacía que "Ver / Imprimir" mostrara la ND en vez de la factura.
  const comprobante = (facturas.data?.facturas ?? [])
    .filter((f) => !ES_NOTA_DEBITO.has(f.tipo_comprobante))
    .find((f) => f.estado === "autorizada");

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  if (!venta.data || !comprobante || !emisor.data?.configurado) return null;

  const letra = LETRA_POR_TIPO[comprobante.tipo_comprobante] ?? "B";
  const esNC = ES_NOTA_CREDITO[comprobante.tipo_comprobante];
  const numeroFormal = `${String(comprobante.punto_venta).padStart(4, "0")}-${String(comprobante.numero).padStart(8, "0")}`;
  // IVA mixto: varias alícuotas en un mismo comprobante. Si no viene (el
  // caso de siempre), se muestra la línea única de "Neto gravado / IVA (X%)".
  let desglose: { ivaPorcentaje: number; neto: number; iva: number }[] | null = null;
  if (comprobante.iva_desglose) {
    try { desglose = JSON.parse(comprobante.iva_desglose); } catch { desglose = null; }
  }

  const qr = qrArcaSvg({
    // Misma fecha que la impresa y que la que tiene ARCA: el QR es lo que
    // lee la app de verificación, así que no puede decir otra cosa.
    fecha: comprobante.fecha_comprobante ?? comprobante.creado_en?.slice(0, 10) ?? "",
    cuit: Number(emisor.data.cuit),
    ptoVta: comprobante.punto_venta,
    tipoCmp: comprobante.tipo_comprobante,
    nroCmp: comprobante.numero,
    importe: comprobante.total / 100,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: comprobante.doc_tipo,
    nroDocRec: Number(comprobante.doc_numero),
    tipoCodAut: "E",
    codAut: Number(comprobante.cae),
  });

  return (
    <div className="comprobante-overlay" onMouseDown={onCerrar}>
      <div className="comprobante-caja" onMouseDown={(e) => e.stopPropagation()}>
        <div className="no-print comprobante-barra">
          <button className="btn" onClick={onCerrar}>Cerrar</button>
          <button className="btn primario" onClick={() => window.print()}>🖨 Imprimir / Guardar PDF</button>
        </div>

        <div className="comprobante comprobante-fiscal">
          <div className="comp-header">
            <div className="comp-header-izq">
              {negocio().logo && <img src={negocio().logo ?? undefined} alt="" className="comp-logo" />}
              <div>
                <div className="comp-marca">{negocio().nombre}</div>
                <div className="comp-sub">{negocio().rubro}</div>
                <div className="comp-sub">Tel: {negocio().telefono} · {negocio().instagram}</div>
                <div className="comp-sub">
                  CUIT {emisor.data.cuit} · {CONDICION_IVA_LABEL[emisor.data.condicion_iva] ?? emisor.data.condicion_iva}
                </div>
              </div>
            </div>
            <div className="comp-doc comp-doc-fiscal">
              <div className="comp-letra">{letra}</div>
              <div className="comp-doc-tit">{esNC ? "NOTA DE CRÉDITO" : "FACTURA"}</div>
              <div className="comp-doc-num">N° {numeroFormal}</div>
              {/* La fecha con la que se emitió ante ARCA, no la de creación de
                  la fila: son distintas si se fechó con la fecha de la venta,
                  y el papel tiene que decir lo mismo que tiene ARCA. */}
              <div className="comp-sub">{fecha(comprobante.fecha_comprobante ?? comprobante.creado_en?.slice(0, 10))}</div>
            </div>
          </div>

          {emisor.data.ambiente === "homologacion" && (
            <div className="comp-anulada" style={{ textAlign: "center", margin: "4px 0" }}>
              COMPROBANTE DE PRUEBA — SIN VALOR FISCAL
            </div>
          )}

          {/* Datos que exige el comprobante impreso (no van en el pedido a ARCA). */}
          <div className="comp-cliente">
            {comprobante.condicion_venta && (
              <div><b>Condición de venta:</b> {comprobante.condicion_venta}</div>
            )}
            {comprobante.fch_serv_desde && (
              <div>
                <b>Período del servicio:</b> {fecha(comprobante.fch_serv_desde)} al{" "}
                {fecha(comprobante.fch_serv_hasta)}
                {comprobante.fch_vto_pago && <> · <b>Vence el pago:</b> {fecha(comprobante.fch_vto_pago)}</>}
              </div>
            )}
          </div>
          <div className="comp-cliente">
            <b>Cliente:</b> {venta.data.venta.cliente_nombre}
            {comprobante.doc_numero !== "0" && <> — {comprobante.doc_tipo === 80 ? "CUIT" : "DNI"} {comprobante.doc_numero}</>}
          </div>

          <table className="comp-tabla">
            <thead>
              <tr><th>Cant.</th><th>Detalle</th><th className="num">P. unit.</th><th className="num">Subtotal</th></tr>
            </thead>
            <tbody>
              {venta.data.items.map((it: any) => (
                <tr key={it.id}>
                  <td className="num">{numero(it.cantidad)}</td>
                  <td>{it.nombre_herramienta}</td>
                  <td className="num">{pesos(it.precio_unitario)}</td>
                  <td className="num">{pesos(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="comp-totales">
            {desglose ? (
              <>
                {desglose.map((d: any) => (
                  <div key={d.ivaPorcentaje}>
                    <span>Neto ({d.ivaPorcentaje / 100}%)</span><span className="num">{pesos(d.neto)}</span>
                  </div>
                ))}
                {desglose.map((d: any) => (
                  <div key={`iva-${d.ivaPorcentaje}`}>
                    <span>IVA ({d.ivaPorcentaje / 100}%)</span><span className="num">{pesos(d.iva)}</span>
                  </div>
                ))}
              </>
            ) : (
              <>
                <div><span>Neto gravado</span><span className="num">{pesos(comprobante.neto_gravado)}</span></div>
                <div><span>IVA ({comprobante.iva_porcentaje / 100}%)</span><span className="num">{pesos(comprobante.iva)}</span></div>
              </>
            )}
            <div className="comp-total"><span>TOTAL</span><span className="num">{pesos(comprobante.total)}</span></div>
          </div>

          <div className="comp-fiscal-pie">
            <div className="comp-qr" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="comp-cae">
              <div><b>CAE:</b> {comprobante.cae}</div>
              <div><b>Vencimiento CAE:</b> {fechaAfip(comprobante.cae_vencimiento)}</div>
            </div>
          </div>

          <AtendidoPor nombre={venta.data.venta?.atendido_por_nombre} foto={venta.data.venta?.atendido_por_foto} />

          <div className="comp-pie">¡Gracias por su compra! — {negocio().nombre}</div>
        </div>
      </div>
    </div>
  );
}
