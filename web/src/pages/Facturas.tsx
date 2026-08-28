import { useState } from "react";
import { api } from "../api";
import { pesos, fecha, mesLargo } from "../format";
import { Cargando, Error, Vacio, useCarga } from "../components/ui";
import { ComprobanteFiscal } from "../components/ComprobanteFiscal";
import { EmitirFacturaModal } from "../components/EmitirFacturaModal";
import { FacturaDetalle } from "../components/FacturaDetalle";
import { FiltroComprobantes, FILTROS_VACIOS, comoQuery, type Filtros } from "../components/FiltroComprobantes";

function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

const BADGE: Record<string, string> = {
  autorizada: "pagada",
  rechazada: "impaga",
  error: "impaga",
  pendiente: "parcial",
  huerfano: "parcial",
};

const TEXTO_ESTADO: Record<string, string> = {
  autorizada: "Autorizada",
  rechazada: "Rechazada",
  error: "Con error",
  pendiente: "Pendiente",
  huerfano: "Sin confirmar",
};

export function Facturas() {
  const [mes, setMes] = useState(mesActual());
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [soloProblemas, setSoloProblemas] = useState(false);
  const [verFactura, setVerFactura] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [reintentar, setReintentar] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [errorVerif, setErrorVerif] = useState<string | null>(null);

  const porFecha = filtros.desde !== "" || filtros.hasta !== "";
  const hayBusqueda = filtros.buscar.trim() !== "";
  const qs = comoQuery(filtros, porFecha ? {} : { mes });
  const { data, error, cargando, recargar } = useCarga<any>(
    () => api.get(`/api/facturacion/facturas?${qs}`),
    [qs]
  );

  async function verificarHuerfanos() {
    setErrorVerif(null);
    setVerificando(true);
    try {
      const r = await api.post<{ revisados: number; autorizados: number; liberados: number }>(
        "/api/facturacion/huerfanos/verificar"
      );
      setAviso(
        `Verificadas ${r.revisados} con ARCA: ${r.autorizados} estaban emitidas (ya tienen su CAE) ` +
        `y ${r.liberados} nunca se emitieron (se pueden facturar de nuevo).`
      );
      recargar();
    } catch (err: any) {
      setErrorVerif(err.message);
    } finally {
      setVerificando(false);
    }
  }

  const t = data?.totales;
  const todas = data?.facturas ?? [];
  const lista = soloProblemas
    ? todas.filter((f: any) => f.estado === "rechazada" || f.estado === "error")
    : todas;

  // El mes actual puede no estar en la lista si todavía no facturaste nada.
  const meses: string[] = data?.meses ?? [];
  const opcionesMes = meses.includes(mes) ? meses : [mes, ...meses];

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Facturas</h1>
        <a className="btn" href={`/api/facturacion/libro-iva?mes=${mes}`}>
          Libro IVA del mes (Excel)
        </a>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      <Error msg={errorVerif} />

      {/* Un comprobante sin confirmar puede existir en ARCA aunque el sistema
          no lo sepa. Hasta resolverlo, esa venta no se puede volver a facturar. */}
      {todas.some((f: any) => f.estado === "huerfano") && (
        <div className="pill-alerta">
          <b>Hay comprobantes sin confirmar.</b> Se cortó la comunicación con ARCA y no sabemos si
          llegaron a emitirse. Verificalos antes de volver a facturar esas ventas — si no, podrías
          terminar con dos facturas para la misma venta.
          <div style={{ marginTop: 8 }}>
            <button className="btn primario" disabled={verificando} onClick={verificarHuerfanos}>
              {verificando ? "Consultando a ARCA…" : "Verificar con ARCA"}
            </button>
          </div>
        </div>
      )}

      <FiltroComprobantes valor={filtros} onCambiar={setFiltros} placeholder="Nombre del cliente, N° o CAE">
        <div className="campo">
          <label>Mes</label>
          <select value={mes} onChange={(e) => setMes(e.target.value)} disabled={porFecha}>
            {opcionesMes.map((m) => <option key={m} value={m}>{mesLargo(m)}</option>)}
          </select>
        </div>
        {t?.con_problema > 0 && (
          <div className="campo">
            <label>&nbsp;</label>
            <button
              className={`btn ${soloProblemas ? "primario" : ""}`}
              onClick={() => setSoloProblemas(!soloProblemas)}
            >
              {soloProblemas
                ? "Ver todas"
                : t.con_problema === 1
                  ? "Ver la que falló"
                  : `Ver las ${t.con_problema} que fallaron`}
            </button>
          </div>
        )}
      </FiltroComprobantes>

      {porFecha && (
        <p className="mut" style={{ marginTop: -4 }}>
          Filtrando por fechas, así que el mes no se aplica.
        </p>
      )}

      {error && <Error msg={error} />}

      {t && (
        <div className="grid-kpi">
          <div className="kpi">
            <div className="rot">Facturado en el mes</div>
            <div className="val">{pesos(t.total)}</div>
            <div className="mut">
              {t.emitidas} factura{t.emitidas === 1 ? "" : "s"}
              {t.notas_credito > 0 && ` · ${t.notas_credito} NC descontada${t.notas_credito === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className="kpi">
            <div className="rot">Neto gravado</div>
            <div className="val">{pesos(t.neto)}</div>
          </div>
          <div className="kpi">
            <div className="rot">IVA</div>
            <div className="val">{pesos(t.iva)}</div>
          </div>
          {t.con_problema > 0 && (
            <div className="kpi">
              <div className="rot">No salieron</div>
              <div className="val debe">{t.con_problema}</div>
              <div className="mut">Se pueden reintentar</div>
            </div>
          )}
        </div>
      )}

      {cargando ? (
        <Cargando />
      ) : lista.length === 0 ? (
        <Vacio
          mensaje={
            soloProblemas
              ? "Ninguna factura falló en este período."
              : hayBusqueda
                ? "Ninguna factura coincide con la búsqueda."
                : porFecha
                  ? "No hay facturas en ese rango de fechas."
                  : `No hay facturas en ${mesLargo(mes)}. Las facturas se emiten desde la venta, en la pantalla de Ventas.`
          }
          accion={
            hayBusqueda || porFecha ? (
              <button className="btn" onClick={() => setFiltros(FILTROS_VACIOS)}>Limpiar filtros</button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid-comprobantes">
          {lista.map((f: any) => (
            <button
              key={f.id}
              className={`comp-card ${
                f.estado === "autorizada" ? "ok" : f.estado === "huerfano" ? "duda" : "falla"
              }`}
              onClick={() => setDetalle(f.id)}
            >
              <div className="comp-card-top">
                <div>
                  <div className="comp-card-tipo">{f.comprobante}</div>
                  <div className="comp-card-nro">{f.numero_formateado ?? "Sin número"}</div>
                </div>
                <span className={`badge ${BADGE[f.estado] ?? ""}`}>
                  {TEXTO_ESTADO[f.estado] ?? f.estado}
                </span>
              </div>

              <div className="comp-card-cliente">{f.cliente_nombre}</div>

              {f.estado !== "autorizada" && f.motivo && (
                <div className="mut" style={{ fontSize: 12.5 }}>{f.motivo}</div>
              )}

              <div className="comp-card-pie">
                <span className="comp-card-total">
                  {f.es_nota_credito ? `-${pesos(f.total)}` : pesos(f.total)}
                </span>
                <span className="comp-card-fecha">
                  {fecha((f.autorizado_en ?? f.creado_en).slice(0, 10))} · Venta #{f.venta_numero}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detalle && (
        <FacturaDetalle
          id={detalle}
          onCerrar={() => setDetalle(null)}
          onImprimir={(ventaId) => { setDetalle(null); setVerFactura(ventaId); }}
          onVerificar={() => { setDetalle(null); void verificarHuerfanos(); }}
          onReintentar={(ventaId) => { setDetalle(null); setReintentar(ventaId); }}
        />
      )}

      {verFactura && <ComprobanteFiscal ventaId={verFactura} onCerrar={() => setVerFactura(null)} />}
      {reintentar && (
        <EmitirFacturaModal
          ventaId={reintentar}
          onCerrar={(mensaje) => {
            setReintentar(null);
            if (mensaje) { setAviso(mensaje); recargar(); }
          }}
        />
      )}
    </div>
  );
}
