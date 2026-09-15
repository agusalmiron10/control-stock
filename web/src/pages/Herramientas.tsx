import { useEffect, useState } from "react";
import { api } from "../api";
import { pesos, numero, aCentavos, aPesos, hoyISO } from "../format";
import { Cargando, Error, Vacio, Modal, Campo, Confirmar, useCarga } from "../components/ui";
import { ImportarProductos } from "../components/ImportarProductos";
import { exportarPrecios } from "../excel";
import { waListaDePrecios } from "../lib/whatsapp";
import { generarPdfListaPrecios } from "../lib/pdf";
import { compartirArchivo, mensajeCompartir } from "../lib/compartirArchivo";
import { FormProduccion } from "../components/FormProduccion";
import { useRol, esDueno } from "../lib/rol";
import { useModulo, useVocab, useCapacidades } from "../lib/config";

type Modo =
  | { t: "cerrado" }
  | { t: "nueva" }
  | { t: "editar"; h: any }
  | { t: "produccion"; h: any }
  | { t: "ajuste"; h: any }
  | { t: "precio"; h: any }
  | { t: "masivo" };

export function Herramientas() {
  const [importar, setImportar] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [rubroF, setRubroF] = useState("");
  const [incluirArchivadas, setInclArch] = useState(false);
  const [modo, setModo] = useState<Modo>({ t: "cerrado" });
  const [archivarH, setArchivarH] = useState<any | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [compartiendoPdf, setCompartiendoPdf] = useState(false);
  const [pagina, setPagina] = useState(1);
  const LIMITE = 20;
  const hayProduccion = useModulo("produccion");
  const hayMayorista = useModulo("precio_mayorista");
  const hayAcopio = useModulo("acopio");
  const vocab = useVocab();

  const qs = new URLSearchParams();
  if (buscar) qs.set("buscar", buscar);
  if (incluirArchivadas) qs.set("incluirArchivadas", "1");
  const { data, error, cargando, recargar } = useCarga<any>(
    () => api.get(`/api/herramientas?${qs}`),
    [buscar, incluirArchivadas]
  );
  const rubrosQ = useCarga<any>(() => api.get("/api/herramientas/rubros"), []);

  async function archivar() {
    if (!archivarH) return;
    await api.post(`/api/herramientas/${archivarH.id}/archivar`, { activar: !archivarH.activo });
    setArchivarH(null);
    recargar();
  }

  function cerrar(msg?: string) {
    setModo({ t: "cerrado" });
    if (msg) setAviso(msg);
    recargar();
    rubrosQ.recargar();
  }

  /**
   * Con pocos productos, el mensaje de WhatsApp trae la lista entera como
   * texto. Con muchos, waListaDePrecios manda sólo un aviso corto — acá se
   * completa con la descarga del Excel, para adjuntarlo a mano (no hay
   * forma de pre-cargar un archivo en un link de WhatsApp, sólo texto).
   */
  function compartirListaTexto() {
    const { completa, cantidad } = waListaDePrecios(data?.herramientas ?? [], "minorista");
    if (!completa) {
      exportarPrecios().catch((e) => setAviso(e.message));
      setAviso(
        `Se abrió WhatsApp con un aviso corto (son ${cantidad} productos, no entran bien como texto) — te descargamos también el Excel completo para que lo adjuntes.`
      );
    }
  }

  /**
   * La lista entera como archivo PDF, con nombre, rubro y precio — a
   * diferencia del texto de arriba, esto no se corta nunca por más
   * productos que haya (sigue en la hoja siguiente). compartirArchivo() la
   * descarga siempre y, si el navegador lo permite, abre el selector nativo
   * para mandarla directo por WhatsApp en el mismo paso.
   */
  async function compartirPdf() {
    setCompartiendoPdf(true);
    try {
      const blob = await generarPdfListaPrecios(data?.herramientas ?? [], "minorista", vocab);
      const resultado = await compartirArchivo(blob, `lista-precios-${hoyISO()}.pdf`, {
        titulo: `Lista de precios`,
        texto: `Lista de precios de ${vocab.plural.toLowerCase()}`,
      });
      setAviso(mensajeCompartir(resultado));
    } catch (e: any) {
      setAviso("No se pudo generar el PDF: " + e.message);
    } finally {
      setCompartiendoPdf(false);
    }
  }

  let lista: any[] = data?.herramientas ?? [];
  if (rubroF) lista = lista.filter((h) => (h.rubro ?? "") === rubroF);
  
  const totalProductos = lista.length;
  const totalPaginas = Math.ceil(totalProductos / LIMITE);
  const listaPaginada = lista.slice((pagina - 1) * LIMITE, pagina * LIMITE);

  return (
    <div>
      <div className="encabezado-seccion">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h1>{vocab.plural}</h1>
          <span style={{ background: "var(--acento)", color: "white", padding: "4px 12px", borderRadius: "20px", fontSize: "1.2rem", fontWeight: "bold" }}>
            {totalProductos} {totalProductos === 1 ? "producto" : "productos"}
          </span>
        </div>
        <div className="btn-grupo">
          <button className="btn" onClick={() => setImportar(true)}>⬆ Importar</button>
          <button className="btn" onClick={() => setModo({ t: "masivo" })}>% Ajuste masivo</button>
          <button className="btn wa" onClick={compartirListaTexto}>
            Compartir lista
          </button>
          <button className="btn" disabled={compartiendoPdf} onClick={compartirPdf}>
            {compartiendoPdf ? "Generando…" : "⬇ PDF"}
          </button>
          <button className="btn" onClick={() => exportarPrecios().catch((e) => setAviso(e.message))}>
            ⬇ Excel precios
          </button>
          <button className="btn primario" data-tour="nueva-herramienta" onClick={() => setModo({ t: "nueva" })}>+ Nueva</button>
        </div>
      </div>

      {importar && (
        <ImportarProductos
          onCerrar={(mensaje) => { setImportar(false); if (mensaje) { setAviso(mensaje); recargar(); } }}
        />
      )}

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="barra-filtros">
        <div className="campo" style={{ flex: 2 }}>
          <label>Buscar por nombre o código</label>
          <input value={buscar} onChange={(e) => { setBuscar(e.target.value); setPagina(1); }} placeholder="Ej: martillo, MART-001" />
        </div>
        <div className="campo">
          <label>Rubro</label>
          <select value={rubroF} onChange={(e) => { setRubroF(e.target.value); setPagina(1); }}>
            <option value="">Todos</option>
            {(rubrosQ.data?.rubros ?? []).map((r: string) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <label className="campo check">
          <input type="checkbox" checked={incluirArchivadas} onChange={(e) => setInclArch(e.target.checked)} />
          Incluir archivadas
        </label>
      </div>

      {error && <Error msg={error} />}
      {cargando ? (
        <Cargando />
      ) : lista.length === 0 ? (
        <Vacio
          mensaje={`No hay ${vocab.plural.toLowerCase()} que coincidan.`}
          accion={<button className="btn primario" onClick={() => setModo({ t: "nueva" })}>Crear la primera</button>}
        />
      ) : (
        <div className="card">
          <div className="tabla-wrap solo-escritorio">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th><th>{vocab.singular}</th><th>Rubro</th>
                  <th className="num">Minorista</th>{hayMayorista && <th className="num">Mayorista</th>}
                  <th className="num">Stock</th>{hayAcopio && <th className="num">Disponible</th>}<th className="num">Mín.</th><th></th>
                </tr>
              </thead>
              <tbody>
                {listaPaginada.map((h: any) => {
                  const bajo = h.stock <= h.stock_minimo;
                  const cero = h.stock <= 0;
                  const disponible = h.stock_disponible ?? h.stock;
                  const acopiado = h.stock - disponible;
                  return (
                    <tr key={h.id} className={h.activo ? "" : "archivado"}>
                      <td className="num">{h.codigo}</td>
                      <td><a href={`#/herramientas/${h.id}`}>{h.nombre}</a>{!h.activo && " (archivada)"}</td>
                      <td>{h.rubro ?? "—"}</td>
                      <td className="num">{pesos(h.precio)}</td>
                      {hayMayorista && <td className="num">{pesos(h.precio_mayor)}</td>}
                      <td className={`num ${cero ? "stock-cero" : bajo ? "stock-bajo" : ""}`}>{numero(h.stock)}</td>
                      {hayAcopio && (
                        <td className={`num ${disponible <= 0 ? "stock-cero" : ""}`}>
                          {numero(disponible)}
                          {acopiado > 0 && <div className="mut" style={{ fontSize: 11 }}>{numero(acopiado)} acopiado</div>}
                        </td>
                      )}
                      <td className="num">{numero(h.stock_minimo)}</td>
                      <td className="acc">
                        <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                          {hayProduccion && <button className="btn chico" onClick={() => setModo({ t: "produccion", h })}>Producir</button>}
                          <button className="btn chico" onClick={() => setModo({ t: "ajuste", h })}>Ajustar</button>
                          <button className="btn chico" onClick={() => setModo({ t: "precio", h })}>Precio</button>
                          <button className="btn chico" onClick={() => setModo({ t: "editar", h })}>Editar</button>
                          <button className="btn chico" onClick={() => setArchivarH(h)}>{h.activo ? "Archivar" : "Reactivar"}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card-body solo-movil lista-tarjetas">
            {listaPaginada.map((h: any) => {
              const bajo = h.stock <= h.stock_minimo;
              const cero = h.stock <= 0;
              return (
                <div className="tarjeta-fila" key={h.id}>
                  <div className="tf-titulo">
                    <a href={`#/herramientas/${h.id}`}>{h.nombre}</a>{!h.activo && " (archivada)"}
                    <span className="mut" style={{ fontWeight: 400 }}> · {h.codigo}{h.rubro ? ` · ${h.rubro}` : ""}</span>
                  </div>
                  <div className="tf-datos">
                    <span className="num">Min. {pesos(h.precio)}</span>
                    {hayMayorista && <span className="num">May. {pesos(h.precio_mayor)}</span>}
                    <span className={`num ${cero ? "stock-cero" : bajo ? "stock-bajo" : ""}`}>Stock {numero(h.stock)}</span>
                    {hayAcopio && h.stock !== (h.stock_disponible ?? h.stock) && (
                      <span className="num mut">Disponible {numero(h.stock_disponible)}</span>
                    )}
                  </div>
                  <div className="tf-datos" style={{ marginTop: 8 }}>
                    <div className="btn-grupo">
                      {hayProduccion && <button className="btn chico" onClick={() => setModo({ t: "produccion", h })}>Producir</button>}
                      <button className="btn chico" onClick={() => setModo({ t: "ajuste", h })}>Ajustar</button>
                      <button className="btn chico" onClick={() => setModo({ t: "precio", h })}>Precio</button>
                      <button className="btn chico" onClick={() => setModo({ t: "editar", h })}>Editar</button>
                      <button className="btn chico" onClick={() => setArchivarH(h)}>{h.activo ? "Archivar" : "Reactivar"}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {totalPaginas > 1 && (
            <div className="card-body" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "1rem", borderTop: "1px solid var(--borde)", padding: "16px" }}>
              <button className="btn" disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>Anterior</button>
              <span>Página <b>{pagina}</b> de {totalPaginas}</span>
              <button className="btn" disabled={pagina === totalPaginas} onClick={() => setPagina(p => p + 1)}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {(modo.t === "nueva" || modo.t === "editar") && <FormHerramienta modo={modo} onCerrar={cerrar} />}
      {modo.t === "produccion" && <FormProduccion h={modo.h} onCerrar={cerrar} />}
      {modo.t === "ajuste" && <FormAjuste h={modo.h} onCerrar={cerrar} />}
      {modo.t === "precio" && <FormPrecio h={modo.h} onCerrar={cerrar} />}
      {modo.t === "masivo" && <FormAjusteMasivo rubros={rubrosQ.data?.rubros ?? []} onCerrar={cerrar} />}

      {archivarH && (
        <Confirmar
          mensaje={
            archivarH.activo
              ? `¿Archivar "${archivarH.nombre}"? No se borra: podés reactivarla después.`
              : `¿Reactivar "${archivarH.nombre}"?`
          }
          textoConfirmar={archivarH.activo ? "Archivar" : "Reactivar"}
          peligro={!!archivarH.activo}
          onSi={archivar}
          onNo={() => setArchivarH(null)}
        />
      )}
    </div>
  );
}

function FormHerramienta({ modo, onCerrar }: { modo: any; onCerrar: (m?: string) => void }) {
  const rol = useRol();
  const editar = modo.t === "editar";
  const h = modo.h;
  const [codigo, setCodigo] = useState(h?.codigo ?? "");
  const [nombre, setNombre] = useState(h?.nombre ?? "");
  const [rubro, setRubro] = useState(h?.rubro ?? "");
  const [precio, setPrecio] = useState(h ? String(aPesos(h.precio)) : "");
  const [precioMayor, setPrecioMayor] = useState(h ? String(aPesos(h.precio_mayor)) : "");
  const [costo, setCosto] = useState(h ? String(aPesos(h.costo)) : "");
  const [stock, setStock] = useState(h ? String(h.stock) : "0");
  const [stockMin, setStockMin] = useState(h ? String(h.stock_minimo) : "0");
  const [notas, setNotas] = useState(h?.notas ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Qué campos extra tiene un producto lo decide la capacidad del rubro, no
  // este componente: acá sólo se renderiza la lista que venga.
  const {
    campos_extra_producto, categorias_sugeridas, permite_vencimientos, precios_por_escala,
    requiere_numero_serie, permite_variantes, tipos_variante,
  } = useCapacidades();
  const [requiereSerie, setRequiereSerie] = useState(!!h?.requiere_serie);
  // Valores por tipo de variante, separados por coma: "S, M, L" × "negro, blanco".
  const [valoresVariante, setValoresVariante] = useState<Record<string, string>>({});
  const [creandoVariantes, setCreandoVariantes] = useState(false);
  const [venceEl, setVenceEl] = useState(h?.vence_el ?? "");
  const [escalas, setEscalas] = useState<{ desde_cantidad: number | string; precio: number | string }[]>([]);
  // En blanco = "usa la alícuota general del negocio" (Ajustes → Facturación
  // electrónica) — no es lo mismo que elegir "0% Exento", que es un valor
  // real. Sólo tiene sentido si el negocio factura.
  const [ivaPorcentaje, setIvaPorcentaje] = useState(h?.iva_porcentaje != null ? String(h.iva_porcentaje) : "");
  const factura = useModulo("facturacion_electronica");

  // Los tramos se piden aparte y sólo cuando hacen falta: es un producto ya
  // existente en un negocio que usa precio por cantidad.
  useEffect(() => {
    if (!precios_por_escala || !editar || !h?.id) return;
    api.get<{ escalas: { desde_cantidad: number; precio: number }[] }>(`/api/herramientas/${h.id}/escalas`)
      .then((r) => setEscalas(r.escalas.map((e) => ({ desde_cantidad: e.desde_cantidad, precio: aPesos(e.precio) }))))
      .catch(() => {});
  }, [precios_por_escala, editar, h?.id]);
  const [datosExtra, setDatosExtra] = useState<Record<string, string>>(() => {
    try {
      const guardado = h?.datos_extra ? JSON.parse(h.datos_extra) : {};
      return guardado && typeof guardado === "object" ? guardado : {};
    } catch {
      return {};
    }
  });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const body: any = {
        codigo, nombre, rubro,
        stock_minimo: Number(stockMin || 0), notas,
        datos_extra: datosExtra,
      };
      if (factura) body.iva_porcentaje = ivaPorcentaje === "" ? null : Number(ivaPorcentaje);
      if (permite_vencimientos) body.vence_el = venceEl || null;
      if (requiere_numero_serie) body.requiere_serie = requiereSerie;
      if (esDueno(rol)) body.costo = aCentavos(costo || "0");
      if (editar) {
        await api.put(`/api/herramientas/${h.id}`, body);
      } else {
        body.precio = aCentavos(precio || "0");
        body.precio_mayor = aCentavos(precioMayor || "0");
        body.stock = Number(stock || 0);
        await api.post("/api/herramientas", body);
      }
      // Los tramos van en su propio pedido: son otra tabla y sólo aplican a
      // un producto que ya existe.
      if (precios_por_escala && editar && h?.id) {
        await api.put(`/api/herramientas/${h.id}/escalas`, {
          escalas: escalas
            .filter((e) => Number(e.desde_cantidad) > 0)
            .map((e) => ({ desde_cantidad: Number(e.desde_cantidad), precio: aCentavos(String(e.precio || 0)) })),
        });
      }
      onCerrar(editar ? "Herramienta actualizada." : "Herramienta creada.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={editar ? "Editar herramienta" : "Nueva herramienta"} onCerrar={() => onCerrar()}
      pie={<>
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" form="fh" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
      </>}>
      <form id="fh" onSubmit={guardar}>
        <Error msg={error} />
        <div className="fila">
          <Campo label="Código"><input value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus /></Campo>
          <Campo label="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
        </div>
        <Campo label="Rubro">
          <input
            value={rubro}
            onChange={(e) => setRubro(e.target.value)}
            list="rubros-sugeridos"
            placeholder={categorias_sugeridas.length > 0 ? `Ej: ${categorias_sugeridas.slice(0, 3).join(", ")}` : "Categoría del producto"}
          />
          {/* Sugerencias del rubro del negocio: ayudan sin obligar — el campo
              sigue siendo texto libre, se puede escribir cualquier otra. */}
          <datalist id="rubros-sugeridos">
            {categorias_sugeridas.map((cat) => <option key={cat} value={cat} />)}
          </datalist>
        </Campo>
        {campos_extra_producto.length > 0 && (
          <div className="fila">
            {campos_extra_producto.map((campo) => (
              <Campo key={campo} label={campo.charAt(0).toUpperCase() + campo.slice(1)}>
                <input
                  value={datosExtra[campo] ?? ""}
                  onChange={(e) => setDatosExtra((d) => ({ ...d, [campo]: e.target.value }))}
                  maxLength={120}
                />
              </Campo>
            ))}
          </div>
        )}
        {permite_vencimientos && (
          <Campo label="Vence el">
            <input type="date" value={venceEl} onChange={(e) => setVenceEl(e.target.value)} />
          </Campo>
        )}
        {precios_por_escala && editar && (
          <>
            <hr />
            <p className="mut" style={{ marginTop: 0 }}>
              <b>Precio por cantidad.</b> El precio que se aplica es el del tramo más alto que
              alcance lo que se lleva. Dejalo vacío si este producto no tiene descuento por volumen.
            </p>
            {escalas.map((e, i) => (
              <div className="fila" key={i}>
                <Campo label="Desde (cantidad)">
                  <input
                    className="num" type="number" min={1} value={e.desde_cantidad}
                    onChange={(ev) => setEscalas((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, desde_cantidad: ev.target.value } : x)))}
                  />
                </Campo>
                <Campo label="Precio por unidad ($)">
                  <input
                    className="num" type="number" step="0.01" min={0} value={e.precio}
                    onChange={(ev) => setEscalas((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, precio: ev.target.value } : x)))}
                  />
                </Campo>
                <button type="button" className="btn chico" style={{ alignSelf: "flex-end", marginBottom: 10 }}
                  onClick={() => setEscalas((arr) => arr.filter((_, j) => j !== i))}>
                  Quitar
                </button>
              </div>
            ))}
            <button type="button" className="btn chico"
              onClick={() => setEscalas((arr) => [...arr, { desde_cantidad: "", precio: "" }])}>
              + Agregar tramo
            </button>
          </>
        )}
        {requiere_numero_serie && (
          <label className="tarjeta-fila modulo-fila" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={requiereSerie} onChange={(e) => setRequiereSerie(e.target.checked)} />
            <span>
              Lleva número de serie
              <div className="mut">
                Al venderlo se va a pedir una serie por unidad. Dejalo apagado para lo que no
                la lleva (fundas, accesorios).
              </div>
            </span>
          </label>
        )}
        {permite_variantes && editar && !h?.padre_id && tipos_variante.length > 0 && (
          <>
            <hr />
            <p className="mut" style={{ marginTop: 0 }}>
              <b>Variantes.</b> Cada combinación pasa a ser un producto propio con su stock.
              Este producto queda como agrupación.
            </p>
            {tipos_variante.map((tipo) => (
              <Campo key={tipo} label={`${tipo.charAt(0).toUpperCase() + tipo.slice(1)} (separados por coma)`}>
                <input
                  value={valoresVariante[tipo] ?? ""}
                  onChange={(e) => setValoresVariante((v) => ({ ...v, [tipo]: e.target.value }))}
                  placeholder={tipo === "talle" ? "S, M, L, XL" : tipo === "color" ? "negro, blanco" : ""}
                />
              </Campo>
            ))}
            <button type="button" className="btn chico" disabled={creandoVariantes}
              onClick={async () => {
                // Producto cartesiano de lo que se cargó en cada tipo.
                const listas = tipos_variante
                  .map((t) => ({ tipo: t, vals: (valoresVariante[t] ?? "").split(",").map((x) => x.trim()).filter(Boolean) }))
                  .filter((l) => l.vals.length > 0);
                if (listas.length === 0) { setError("Cargá al menos un valor."); return; }
                let combos: Record<string, string>[] = [{}];
                for (const l of listas) {
                  combos = combos.flatMap((c) => l.vals.map((v) => ({ ...c, [l.tipo]: v })));
                }
                setCreandoVariantes(true);
                setError(null);
                try {
                  const r = await api.post<{ creadas: number; stock_padre_anterior: number }>(
                    `/api/herramientas/${h.id}/variantes`, { combinaciones: combos }
                  );
                  onCerrar(
                    `${r.creadas} variante(s) creada(s).` +
                    (r.stock_padre_anterior > 0
                      ? ` Ojo: el producto padre tenía ${r.stock_padre_anterior} de stock y quedó en 0 — repartilo entre las variantes.`
                      : "")
                  );
                } catch (err: any) {
                  setError(err.message);
                  setCreandoVariantes(false);
                }
              }}>
              {creandoVariantes ? "Creando…" : "Generar variantes"}
            </button>
          </>
        )}
        {!editar && (
          <div className="fila">
            <Campo label="Precio minorista ($)">
              <input className="num" type="number" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            </Campo>
            <Campo label="Precio mayorista ($)">
              <input className="num" type="number" step="0.01" value={precioMayor} onChange={(e) => setPrecioMayor(e.target.value)} />
            </Campo>
          </div>
        )}
        <div className="fila">
          {esDueno(rol) && (
            <Campo label="Costo ($)">
              <input className="num" type="number" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} />
            </Campo>
          )}
          {!editar && (
            <Campo label="Stock inicial">
              <input className="num" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
            </Campo>
          )}
          <Campo label="Stock mínimo">
            <input className="num" type="number" value={stockMin} onChange={(e) => setStockMin(e.target.value)} />
          </Campo>
        </div>
        {factura && (
          <Campo label="% IVA de este producto (opcional)">
            <select value={ivaPorcentaje} onChange={(e) => setIvaPorcentaje(e.target.value)}>
              <option value="">Usar la alícuota general del negocio</option>
              <option value="0">0% (Exento)</option>
              <option value="250">2,5%</option>
              <option value="500">5%</option>
              <option value="1050">10,5%</option>
              <option value="2100">21%</option>
              <option value="2700">27%</option>
            </select>
            <span className="mut" style={{ fontSize: 12.5 }}>
              Sólo si este producto va a otra alícuota que el resto — por ejemplo, si vendés algo
              exento junto con productos gravados. Si no sabés qué elegir, dejalo así.
            </span>
          </Campo>
        )}
        {editar && <p className="mut">Los precios se cambian con el botón "Precio" (guarda historial). Acá no se tocan.</p>}
        <Campo label="Notas"><textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
      </form>
    </Modal>
  );
}


function FormAjuste({ h, onCerrar }: { h: any; onCerrar: (m?: string) => void }) {
  const [nuevo, setNuevo] = useState(String(h.stock));
  const [fecha, setFecha] = useState(hoyISO());
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/herramientas/${h.id}/ajuste`, { nuevo: Number(nuevo), fecha, motivo });
      onCerrar(`Stock ajustado a ${nuevo} en ${h.nombre}.`);
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal titulo={`Ajustar stock — ${h.nombre}`} onCerrar={() => onCerrar()}
      pie={<><button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" form="fa">Guardar ajuste</button></>}>
      <form id="fa" onSubmit={guardar}>
        <Error msg={error} />
        <p className="mut">Stock actual: <b>{numero(h.stock)}</b>. Poné el conteo real (rotura, pérdida, recuento).</p>
        <div className="fila">
          <Campo label="Stock nuevo (real)">
            <input className="num" type="number" value={nuevo} onChange={(e) => setNuevo(e.target.value)} autoFocus />
          </Campo>
          <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        </div>
        <Campo label="Motivo (opcional)">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: 2 rotas en depósito" />
        </Campo>
      </form>
    </Modal>
  );
}

function FormPrecio({ h, onCerrar }: { h: any; onCerrar: (m?: string) => void }) {
  const [precio, setPrecio] = useState(String(aPesos(h.precio)));
  const [precioMayor, setPrecioMayor] = useState(String(aPesos(h.precio_mayor)));
  const [fecha, setFecha] = useState(hoyISO());
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/herramientas/${h.id}/precio`, {
        precio_nuevo: aCentavos(precio), precio_mayor_nuevo: aCentavos(precioMayor), fecha, motivo,
      });
      onCerrar(`Precio actualizado. Podés descargar o compartir la lista desde los botones de arriba.`);
    } catch (err: any) { setError(err.message); }
  }

  return (
    <Modal titulo={`Cambiar precio — ${h.nombre}`} onCerrar={() => onCerrar()}
      pie={<><button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" form="fpr">Guardar precio</button></>}>
      <form id="fpr" onSubmit={guardar}>
        <Error msg={error} />
        <p className="mut">Actual: minorista <b>{pesos(h.precio)}</b> · mayorista <b>{pesos(h.precio_mayor)}</b>. Las ventas ya hechas no cambian.</p>
        <div className="fila">
          <Campo label="Nuevo minorista ($)">
            <input className="num" type="number" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} autoFocus />
          </Campo>
          <Campo label="Nuevo mayorista ($)">
            <input className="num" type="number" step="0.01" value={precioMayor} onChange={(e) => setPrecioMayor(e.target.value)} />
          </Campo>
        </div>
        <div className="fila">
          <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
          <Campo label="Motivo (opcional)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: aumento de insumos" /></Campo>
        </div>
      </form>
    </Modal>
  );
}

function FormAjusteMasivo({ rubros, onCerrar }: { rubros: string[]; onCerrar: (m?: string) => void }) {
  const [porcentaje, setPorcentaje] = useState("");
  const [tipo, setTipo] = useState<"ambos" | "minorista" | "mayorista">("ambos");
  const [rubro, setRubro] = useState("");
  const [redondeo, setRedondeo] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const r = await api.post<any>("/api/herramientas/ajuste-masivo", {
        porcentaje: Number(porcentaje),
        tipo,
        rubro: rubro || undefined,
        redondeo: Number(redondeo),
        motivo: motivo || undefined,
      });
      onCerrar(`Listo: ${r.herramientas_afectadas} herramienta(s) actualizada(s). No olvides compartir/descargar la lista nueva.`);
    } catch (err: any) { setError(err.message); setGuardando(false); }
  }

  const p = Number(porcentaje);

  return (
    <Modal titulo="Ajuste masivo de precios" onCerrar={() => onCerrar()}
      pie={<><button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" form="fam" disabled={guardando}>{guardando ? "Aplicando…" : "Aplicar ajuste"}</button></>}>
      <form id="fam" onSubmit={guardar}>
        <Error msg={error} />
        <p className="mut">Aumentá o bajá varios precios de una. Los que están en $0 no se tocan. Queda registrado en el historial.</p>
        <div className="fila">
          <Campo label="Porcentaje (%)">
            <input className="num" type="number" step="0.1" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)}
              placeholder="12 = +12% · -5 = -5%" autoFocus />
          </Campo>
          <Campo label="Aplicar a">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
              <option value="ambos">Ambos precios</option>
              <option value="minorista">Solo minorista</option>
              <option value="mayorista">Solo mayorista</option>
            </select>
          </Campo>
        </div>
        <div className="fila">
          <Campo label="Rubro">
            <select value={rubro} onChange={(e) => setRubro(e.target.value)}>
              <option value="">Todos los rubros</option>
              {rubros.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Campo>
          <Campo label="Redondear a">
            <select value={redondeo} onChange={(e) => setRedondeo(e.target.value)}>
              <option value="0">Sin redondeo</option>
              <option value="100">$1</option>
              <option value="1000">$10</option>
              <option value="10000">$100</option>
            </select>
          </Campo>
        </div>
        <Campo label="Motivo (opcional)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: actualización julio" /></Campo>
        {Number.isFinite(p) && p !== 0 && (
          <p className="mut">Ejemplo: un precio de $1.000 quedaría en <b>${(1000 * (1 + p / 100)).toLocaleString("es-AR")}</b> (antes de redondear).</p>
        )}
      </form>
    </Modal>
  );
}
