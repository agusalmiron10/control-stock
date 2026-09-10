import { useMemo, useState } from "react";
import { api } from "../api";
import { pesos, aCentavos, aPesos, hoyISO } from "../format";
import { Cargando, Error, Campo, useCarga } from "../components/ui";
import { BuscadorCliente } from "../components/BuscadorCliente";
import { navegar } from "../lib/router";
import { useModulo, useVocab } from "../lib/config";
import { redimensionar } from "../lib/imagen";

interface Reng { herramienta_id: string; cantidad: string; precio: string }
interface Material { insumo_id: string; cantidad: string }

export function NuevoPresupuesto() {
  const hayInsumos = useModulo("insumos");
  const hayCroquis = useModulo("croquis");
  const vocab = useVocab();
  const clientesQ = useCarga<any>(() => api.get("/api/clientes"), []);
  const herrQ = useCarga<any>(() => api.get("/api/herramientas"), []);
  const insumosQ = useCarga<any>(() => (hayInsumos ? api.get("/api/insumos") : Promise.resolve({ insumos: [] })), [hayInsumos]);
  const [clientesExtra, setClientesExtra] = useState<any[]>([]);
  const clientes = useMemo(() => [...(clientesQ.data?.clientes ?? []), ...clientesExtra], [clientesQ.data, clientesExtra]);

  const [clienteId, setClienteId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [validoHasta, setValidoHasta] = useState("");
  const [tipoPrecio, setTipoPrecio] = useState<"minorista" | "mayorista">("minorista");
  const [items, setItems] = useState<Reng[]>([{ herramienta_id: "", cantidad: "1", precio: "" }]);
  const [descTipo, setDescTipo] = useState<"monto" | "porcentaje">("monto");
  const [descValor, setDescValor] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // "A medida": el trabajo se describe en texto libre y se cotiza con un
  // precio puesto a mano, no sumando renglones del catálogo. La lista de
  // materiales de acá abajo es interna — nunca aparece en lo que ve el
  // cliente (eso lo imprime PresupuestoPDF, que sólo muestra nota y total).
  const [aMedida, setAMedida] = useState(false);
  const [precioManual, setPrecioManual] = useState("");
  const [materiales, setMateriales] = useState<Material[]>([]);
  const [nuevoInsumoId, setNuevoInsumoId] = useState("");
  const [nuevoInsumoCant, setNuevoInsumoCant] = useState("1");
  // Foto o boceto técnico del trabajo (moldería, diseño) — se ve tal cual en
  // el presupuesto impreso, no es interno como la sección Taller.
  const [croquis, setCroquis] = useState<string | null>(null);
  const [subiendoCroquis, setSubiendoCroquis] = useState(false);

  async function elegirCroquis(file: File | undefined) {
    if (!file) return;
    setSubiendoCroquis(true);
    try {
      setCroquis(await redimensionar(file));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubiendoCroquis(false);
    }
  }

  const herramientas: any[] = herrQ.data?.herramientas ?? [];
  const hMap = useMemo(() => new Map(herramientas.map((h) => [String(h.id), h])), [herramientas]);
  const insumosDisponibles: any[] = insumosQ.data?.insumos ?? [];
  const iMap = useMemo(() => new Map(insumosDisponibles.map((i) => [String(i.id), i])), [insumosDisponibles]);

  const costoMateriales = materiales.reduce((acc, m) => {
    const ins = iMap.get(m.insumo_id);
    return acc + (ins ? ins.costo_unitario * (Number(m.cantidad) || 0) : 0);
  }, 0);

  const subtotalItems = items.reduce((acc, it) => acc + (Number(it.cantidad) || 0) * aCentavos(it.precio || "0"), 0);
  const subtotal = aMedida ? aCentavos(precioManual || "0") : subtotalItems;
  const descuentoCent = aMedida ? 0 : (descTipo === "monto" ? aCentavos(descValor || "0") : Math.round((subtotal * (Number(descValor) || 0)) / 100));
  const descuento = Math.min(Math.max(0, descuentoCent), subtotal);
  const total = subtotal - descuento;
  const margen = total - costoMateriales;

  function agregarMaterial() {
    if (!nuevoInsumoId || Number(nuevoInsumoCant) <= 0) return;
    setMateriales((arr) => [...arr, { insumo_id: nuevoInsumoId, cantidad: nuevoInsumoCant }]);
    setNuevoInsumoId("");
    setNuevoInsumoCant("1");
  }
  function quitarMaterial(i: number) {
    setMateriales((arr) => arr.filter((_, j) => j !== i));
  }

  function precioDe(h: any): number {
    if (!h) return 0;
    return tipoPrecio === "mayorista" && h.precio_mayor > 0 ? h.precio_mayor : h.precio;
  }
  function setItem(i: number, patch: Partial<Reng>) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }
  function elegirHerramienta(i: number, hid: string) {
    const h = hMap.get(hid);
    setItem(i, { herramienta_id: hid, precio: h ? String(aPesos(precioDe(h))) : "" });
  }
  /** Código, nombre y stock disponible — así se ve de entrada si alcanza,
   *  sin tener que ir a buscarlo aparte (mismo dato que ya muestra Ventas). */
  function etiquetaHerramienta(hh: any): string {
    return `${hh.codigo} — ${hh.nombre} (stock ${hh.stock})`;
  }
  function agregarReng() { setItems((a) => [...a, { herramienta_id: "", cantidad: "1", precio: "" }]); }
  function quitarReng(i: number) { setItems((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a)); }

  async function enviar() {
    setError(null);
    if (!clienteId) { setError("Elegí un cliente."); return; }
    const validos = items.filter((it) => it.herramienta_id && Number(it.cantidad) > 0);
    if (aMedida) {
      if (!nota.trim()) { setError("Describí el trabajo — es lo único que va a ver el cliente."); return; }
      if (!precioManual || Number(precioManual) <= 0) { setError("Poné el precio final."); return; }
    } else if (validos.length === 0) {
      setError("Agregá al menos un renglón.");
      return;
    }

    setGuardando(true);
    const body: any = {
      cliente_id: clienteId,
      fecha,
      valido_hasta: validoHasta || undefined,
      items: aMedida ? [] : validos.map((it) => ({ herramienta_id: it.herramienta_id, cantidad: Number(it.cantidad), precio_unitario: aCentavos(it.precio || "0") })),
      // Sólo se mandan los materiales si la sección Taller está a la vista:
      // si alguien cargó materiales y después destildó "a medida", esa lista
      // desapareció de la pantalla y no tiene que guardarse igual.
      insumos: aMedida
        ? materiales
            .filter((m) => m.insumo_id && Number(m.cantidad) > 0)
            .map((m) => ({ insumo_id: m.insumo_id, cantidad_requerida: Number(m.cantidad) }))
        : [],
      nota,
    };
    if (aMedida) body.precio_manual = aCentavos(precioManual);
    // Mismo criterio que los materiales: si se sacó la pantalla de "a
    // medida" después de sacar una foto, esa foto no viaja igual.
    if (aMedida && croquis) body.croquis = croquis;
    if (!aMedida && descValor && Number(descValor) > 0) {
      body.descuento = { tipo: descTipo, valor: descTipo === "monto" ? aCentavos(descValor) : Number(descValor) };
    }

    try {
      const r = await api.post<any>("/api/presupuestos", body);
      navegar(`/presupuestos/${r.id}`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  if (clientesQ.cargando || herrQ.cargando) return <Cargando />;
  const insumosActivos = insumosDisponibles.filter((i) => i.activo);

  return (
    <div>
      <div className="encabezado-seccion">
        <div>
          <a href="#/presupuestos">← Presupuestos</a>
          <h1 style={{ marginTop: 4 }}>Nuevo presupuesto</h1>
        </div>
      </div>

      <Error msg={error} />

      {/* Primero se decide QUÉ se está cotizando — cambia todo lo que sigue
          abajo, así que va antes que el cliente y la fecha, no escondido
          entre otros campos. */}
      <div className="card">
        <div className="card-body">
          <div className="modo-presupuesto">
            <button type="button" className={`modo-opcion ${!aMedida ? "activo" : ""}`} onClick={() => setAMedida(false)}>
              <span className="modo-opcion-icono">📦</span>
              <span>
                <span className="modo-opcion-titulo">Producto del catálogo</span>
                <span className="modo-opcion-detalle">Elegís productos que ya vendés, con cantidad y precio de cada uno.</span>
              </span>
            </button>
            <button type="button" className={`modo-opcion ${aMedida ? "activo" : ""}`} onClick={() => setAMedida(true)}>
              <span className="modo-opcion-icono">✏️</span>
              <span>
                <span className="modo-opcion-titulo">Trabajo a medida</span>
                <span className="modo-opcion-detalle">Describís el trabajo con tus palabras y ponés un precio final, sin usar el catálogo.</span>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Mismo esqueleto de dos columnas que "Nueva venta": lo que se va
          armando a la izquierda, y a la derecha — fijo, siempre a la vista
          mientras se sigue cargando — el resumen con el total y el botón
          para confirmar. Antes había que bajar hasta el final de la
          pantalla (después de Renglones, Descuento, Taller…) para ver
          cuánto quedaba y poder guardar. */}
      <div className="pos-venta">
        <div className="pos-principal">
          <div className="card">
            <div className="card-body">
              <div className="fila">
                <Campo label="Cliente">
                  <BuscadorCliente
                    clientes={clientes}
                    clienteId={clienteId}
                    onElegir={setClienteId}
                    onClienteNuevo={(c) => setClientesExtra((arr) => [...arr, c])}
                  />
                </Campo>
                <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
                <Campo label="Válido hasta (opcional)"><input type="date" value={validoHasta} onChange={(e) => setValidoHasta(e.target.value)} /></Campo>
                {!aMedida && (
                  <Campo label="Lista de precios">
                    <select value={tipoPrecio} onChange={(e) => setTipoPrecio(e.target.value as any)}>
                      <option value="minorista">Minorista</option>
                      <option value="mayorista">Mayorista</option>
                    </select>
                  </Campo>
                )}
              </div>
            </div>
          </div>

          {aMedida ? (
            <div className="card">
              <h2>Para el cliente</h2>
              <div className="card-body">
                <Campo label={`Descripción del trabajo (esto${hayCroquis ? ", y la foto de abajo," : ""} es lo único que ve el cliente)`}>
                  <textarea
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    rows={3}
                    placeholder="Ej: Mochila de cuero marrón a medida, con bolsillo interno y correa ajustable."
                  />
                </Campo>
                <Campo label="Precio final ($)">
                  <input className="num" type="number" step="0.01" min={0} value={precioManual} onChange={(e) => setPrecioManual(e.target.value)} />
                </Campo>
                {hayCroquis && (
                  <Campo label="Foto o croquis del trabajo (opcional)">
                    {croquis ? (
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <img src={croquis} alt="Croquis" style={{ maxWidth: 160, maxHeight: 160, borderRadius: 8, border: "1px solid var(--borde)" }} />
                        <button className="btn chico" onClick={() => setCroquis(null)}>Quitar</button>
                      </div>
                    ) : (
                      <input type="file" accept="image/*" onChange={(e) => elegirCroquis(e.target.files?.[0])} disabled={subiendoCroquis} />
                    )}
                  </Campo>
                )}
              </div>
            </div>
          ) : (
            <div className="card">
              <h2>Renglones</h2>
              <div className="tabla-wrap solo-escritorio">
                <table className="tabla">
                  <thead>
                    <tr><th style={{ minWidth: 200 }}>{vocab.singular}</th><th className="num">Cantidad</th><th className="num">Precio unit. ($)</th><th className="num">Subtotal</th><th></th></tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const cant = Number(it.cantidad) || 0;
                      const sub = cant * aCentavos(it.precio || "0");
                      return (
                        <tr key={i}>
                          <td>
                            <select value={it.herramienta_id} onChange={(e) => elegirHerramienta(i, e.target.value)}>
                              <option value="">Elegí…</option>
                              {herramientas.map((hh) => <option key={hh.id} value={hh.id}>{etiquetaHerramienta(hh)}</option>)}
                            </select>
                          </td>
                          <td className="num" style={{ maxWidth: 110 }}>
                            <input className="num" type="number" min={1} value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} />
                          </td>
                          <td className="num" style={{ maxWidth: 140 }}>
                            <input className="num" type="number" step="0.01" min={0} value={it.precio} onChange={(e) => setItem(i, { precio: e.target.value })} />
                          </td>
                          <td className="num">{pesos(sub)}</td>
                          <td className="acc"><button className="btn chico" onClick={() => quitarReng(i)} disabled={items.length === 1}>✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* En celular la tabla de 5 columnas no entra sin scroll horizontal
                  (el botón de quitar quedaba fuera de vista) — cada renglón pasa a
                  ser una mini-tarjeta con los campos apilados. */}
              <div className="card-body solo-movil reng-lista">
                {items.map((it, i) => {
                  const cant = Number(it.cantidad) || 0;
                  const sub = cant * aCentavos(it.precio || "0");
                  return (
                    <div className="reng-card" key={i}>
                      <div className="reng-card-fila">
                        <select value={it.herramienta_id} onChange={(e) => elegirHerramienta(i, e.target.value)}>
                          <option value="">Elegí…</option>
                          {herramientas.map((hh) => <option key={hh.id} value={hh.id}>{etiquetaHerramienta(hh)}</option>)}
                        </select>
                        <button className="btn chico" onClick={() => quitarReng(i)} disabled={items.length === 1}>Quitar</button>
                      </div>
                      <div className="reng-card-fila">
                        <Campo label="Cantidad"><input className="num" type="number" min={1} value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} /></Campo>
                        <Campo label="Precio unit. ($)"><input className="num" type="number" step="0.01" min={0} value={it.precio} onChange={(e) => setItem(i, { precio: e.target.value })} /></Campo>
                      </div>
                      <div className="reng-card-subtotal">Subtotal <b>{pesos(sub)}</b></div>
                    </div>
                  );
                })}
              </div>

              <div className="card-body">
                <button className="btn" onClick={agregarReng}>+ Agregar {vocab.singular.toLowerCase()}</button>
              </div>
            </div>
          )}

          {hayInsumos && aMedida && (
            <div className="card taller-card">
              <h2>Taller — Materiales <span className="mut" style={{ fontWeight: 400, fontSize: 13 }}>(interno, el cliente no lo ve)</span></h2>
              <div className="card-body">
                <p className="mut" style={{ marginTop: 0 }}>
                  Opcional: si este trabajo consume materiales que tenés cargados en <a href="#/insumos">Insumos</a>,
                  elegilos acá para llevar el costo y descontar el stock cuando lo apruebes.
                </p>

                {insumosActivos.length === 0 ? (
                  <div className="aviso-vacio-insumos">
                    <span>Todavía no cargaste ningún insumo.</span>
                    <a className="btn chico" href="#/insumos">Cargar insumos</a>
                  </div>
                ) : (
                  <>
                    <div className="fila">
                      <Campo label="Material">
                        <select value={nuevoInsumoId} onChange={(e) => setNuevoInsumoId(e.target.value)}>
                          <option value="">Elegí…</option>
                          {insumosActivos.map((i) => (
                            <option key={i.id} value={i.id}>{i.nombre} ({i.unidad_medida}) — stock {i.stock_actual}</option>
                          ))}
                        </select>
                      </Campo>
                      <Campo label="Cantidad">
                        <input className="num" type="number" step="0.001" min={0} value={nuevoInsumoCant} onChange={(e) => setNuevoInsumoCant(e.target.value)} />
                      </Campo>
                      <div style={{ display: "flex", alignItems: "flex-end" }}>
                        <button className="btn" onClick={agregarMaterial} disabled={!nuevoInsumoId}>+ Agregar material</button>
                      </div>
                    </div>

                    {materiales.length === 0 && <p className="mut">Todavía no agregaste materiales a este presupuesto.</p>}
                  </>
                )}

                {materiales.length > 0 && (
                  <table className="tabla" style={{ marginTop: 12 }}>
                    <thead><tr><th>Material</th><th className="num">Cantidad</th><th className="num">Costo</th><th></th></tr></thead>
                    <tbody>
                      {materiales.map((m, i) => {
                        const ins = iMap.get(m.insumo_id);
                        const cant = Number(m.cantidad) || 0;
                        const costo = ins ? ins.costo_unitario * cant : 0;
                        return (
                          <tr key={i}>
                            <td>{ins?.nombre ?? m.insumo_id}</td>
                            <td className="num">{cant} {ins?.unidad_medida}</td>
                            <td className="num">{pesos(costo)}</td>
                            <td className="acc"><button className="btn chico" onClick={() => quitarMaterial(i)}>✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                <div className="dt-list" style={{ gridTemplateColumns: "auto auto", marginTop: 12 }}>
                  <dt>Costo de materiales</dt><dd>{pesos(costoMateriales)}</dd>
                  <dt><b>Margen (precio final − materiales)</b></dt>
                  <dd><b className={margen < 0 ? "stock-cero" : ""}>{pesos(margen)}</b></dd>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* El cierre: en pantalla ancha queda fijo al costado (sticky),
            siempre a la vista mientras se sigue cargando el presupuesto —
            mismo patrón que el cierre de venta. En celular pasa a ser una
            tarjeta más, y la barra fija de abajo de toda la página vuelve a
            hacer ese trabajo. */}
        <aside className="pos-cierre">
          <div className="pos-cierre-scroll">
            <p className="pos-cierre-titulo">Cierre de presupuesto</p>

            <div className="pos-resumen">
              <div className="pos-resumen-linea">
                <span>Subtotal</span>
                <span>{pesos(subtotal)}</span>
              </div>
              {descuento > 0 && (
                <div className="pos-resumen-linea">
                  <span>Descuento</span>
                  <span>− {pesos(descuento)}</span>
                </div>
              )}
            </div>

            {!aMedida && (
              <div className="pos-seccion">
                <label className="pos-label">Descuento</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={descTipo} onChange={(e) => setDescTipo(e.target.value as any)} style={{ maxWidth: 130 }}>
                    <option value="monto">Monto ($)</option>
                    <option value="porcentaje">Porcentaje (%)</option>
                  </select>
                  <input className="num" type="number" step="0.01" min={0} value={descValor} onChange={(e) => setDescValor(e.target.value)} placeholder="0" />
                </div>
              </div>
            )}

            {!aMedida && (
              <div className="pos-seccion">
                <Campo label="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
              </div>
            )}
          </div>

          <div className="pos-cierre-pie">
            <div className="btv-cifras">
              <span className="mut">{descuento > 0 ? `Descuento ${pesos(descuento)}` : "Sin descuento"}</span>
              <span className="btv-total">{pesos(total)}</span>
            </div>
            <button className="btn primario pos-finalizar" disabled={guardando} onClick={enviar}>
              {guardando ? "Guardando…" : "Crear presupuesto"}
            </button>
          </div>
        </aside>
      </div>

      {/* Fija abajo de todo, sólo en el celular (en escritorio el panel de
          al lado ya deja el total y el botón siempre a la vista). */}
      <div className="barra-total-venta pos-barra-movil">
        <div className="btv-cifras">
          <span className="mut">{descuento > 0 ? `Descuento ${pesos(descuento)}` : "Sin descuento"}</span>
          <span className="btv-total">{pesos(total)}</span>
        </div>
        <button className="btn primario" disabled={guardando} onClick={enviar}>
          {guardando ? "Guardando…" : "Crear presupuesto"}
        </button>
      </div>
    </div>
  );
}
