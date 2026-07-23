import { useState } from "react";
import { api } from "../api";
import { pesos, numero, aCentavos, aPesos, hoyISO } from "../format";
import { Cargando, Error, Vacio, Modal, Campo, Confirmar, useCarga } from "../components/ui";
import { exportarPrecios } from "../excel";
import { waListaDePrecios } from "../lib/whatsapp";
import { FormProduccion } from "../components/FormProduccion";
import { useRol, esDueno } from "../lib/rol";

type Modo =
  | { t: "cerrado" }
  | { t: "nueva" }
  | { t: "editar"; h: any }
  | { t: "produccion"; h: any }
  | { t: "ajuste"; h: any }
  | { t: "precio"; h: any }
  | { t: "masivo" };

export function Herramientas() {
  const [buscar, setBuscar] = useState("");
  const [rubroF, setRubroF] = useState("");
  const [incluirArchivadas, setInclArch] = useState(false);
  const [modo, setModo] = useState<Modo>({ t: "cerrado" });
  const [archivarH, setArchivarH] = useState<any | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

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

  let lista: any[] = data?.herramientas ?? [];
  if (rubroF) lista = lista.filter((h) => (h.rubro ?? "") === rubroF);

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Herramientas</h1>
        <div className="btn-grupo">
          <button className="btn" onClick={() => setModo({ t: "masivo" })}>% Ajuste masivo</button>
          <button className="btn wa" onClick={() => waListaDePrecios(data?.herramientas ?? [], "minorista")}>
            Compartir lista
          </button>
          <button className="btn" onClick={() => exportarPrecios().catch((e) => setAviso(e.message))}>
            ⬇ Excel precios
          </button>
          <button className="btn primario" onClick={() => setModo({ t: "nueva" })}>+ Nueva</button>
        </div>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="barra-filtros">
        <div className="campo" style={{ flex: 2 }}>
          <label>Buscar por nombre o código</label>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Ej: martillo, MART-001" />
        </div>
        <div className="campo">
          <label>Rubro</label>
          <select value={rubroF} onChange={(e) => setRubroF(e.target.value)}>
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
          mensaje="No hay herramientas que coincidan."
          accion={<button className="btn primario" onClick={() => setModo({ t: "nueva" })}>Crear la primera</button>}
        />
      ) : (
        <div className="card">
          <div className="tabla-wrap">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th><th>Herramienta</th><th>Rubro</th>
                  <th className="num">Minorista</th><th className="num">Mayorista</th>
                  <th className="num">Stock</th><th className="num">Mín.</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((h: any) => {
                  const bajo = h.stock <= h.stock_minimo;
                  const cero = h.stock <= 0;
                  return (
                    <tr key={h.id} className={h.activo ? "" : "archivado"}>
                      <td className="num">{h.codigo}</td>
                      <td><a href={`#/herramientas/${h.id}`}>{h.nombre}</a>{!h.activo && " (archivada)"}</td>
                      <td>{h.rubro ?? "—"}</td>
                      <td className="num">{pesos(h.precio)}</td>
                      <td className="num">{pesos(h.precio_mayor)}</td>
                      <td className={`num ${cero ? "stock-cero" : bajo ? "stock-bajo" : ""}`}>{numero(h.stock)}</td>
                      <td className="num">{numero(h.stock_minimo)}</td>
                      <td className="acc">
                        <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                          <button className="btn chico" onClick={() => setModo({ t: "produccion", h })}>Producir</button>
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

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const body: any = {
        codigo, nombre, rubro,
        stock_minimo: Number(stockMin || 0), notas,
      };
      if (esDueno(rol)) body.costo = aCentavos(costo || "0");
      if (editar) {
        await api.put(`/api/herramientas/${h.id}`, body);
      } else {
        body.precio = aCentavos(precio || "0");
        body.precio_mayor = aCentavos(precioMayor || "0");
        body.stock = Number(stock || 0);
        await api.post("/api/herramientas", body);
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
        <Campo label="Rubro"><input value={rubro} onChange={(e) => setRubro(e.target.value)} placeholder="Ej: Masas, Grinfas, Barretas" /></Campo>
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
        <Campo label="Motivo (obligatorio)">
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
