import { useState } from "react";
import { api } from "../api";
import { pesos, fecha, aCentavos, aPesos, hoyISO } from "../format";
import { Cargando, Error, Vacio, Modal, Campo, Confirmar, useCarga } from "../components/ui";

/** Arranque del mes en curso: es el rango que se mira casi siempre. */
function primerDiaDelMes(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Sugerencias para el primer gasto de una cuenta nueva, cuando todavía no
 * hay ninguna categoría propia de la cual aprender. Son sugerencias: la
 * categoría es texto libre.
 */
const CATEGORIAS_SUGERIDAS = [
  "Alquiler", "Sueldos", "Servicios", "Impuestos", "Fletes",
  "Mantenimiento", "Librería", "Publicidad", "Otros",
];

export function Gastos() {
  const [desde, setDesde] = useState(primerDiaDelMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [editar, setEditar] = useState<any | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [borrar, setBorrar] = useState<any | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const qs = `desde=${desde}&hasta=${hasta}`;
  const { data, error, cargando, recargar } = useCarga<any>(() => api.get(`/api/gastos?${qs}`), [qs]);
  const cats = useCarga<any>(() => api.get("/api/gastos/categorias"), []);

  function actualizar(msg?: string) {
    if (msg) setAviso(msg);
    recargar();
    cats.recargar();
  }

  async function hacerBorrar() {
    if (!borrar) return;
    await api.del(`/api/gastos/${borrar.id}`);
    setBorrar(null);
    actualizar("Gasto borrado.");
  }

  const lista = data?.gastos ?? [];
  const sugerencias = [...new Set([...(cats.data?.categorias ?? []), ...CATEGORIAS_SUGERIDAS])];

  return (
    <div>
      <div className="encabezado-seccion">
        <h1>Gastos</h1>
        <button className="btn primario" onClick={() => setNuevo(true)}>+ Nuevo gasto</button>
      </div>

      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}

      <div className="barra-filtros">
        <div className="campo">
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="campo">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      {error && <Error msg={error} />}

      {cargando ? (
        <Cargando />
      ) : (
        <>
          <div className="grid-kpi">
            <div className="kpi">
              <div className="rot">Total del período</div>
              <div className="val debe">{pesos(data?.total ?? 0)}</div>
              <div className="mut">{lista.length} gasto{lista.length === 1 ? "" : "s"}</div>
            </div>
            {(data?.por_categoria ?? []).slice(0, 3).map((c: any) => (
              <div className="kpi" key={c.categoria}>
                <div className="rot">{c.categoria}</div>
                <div className="val">{pesos(c.monto)}</div>
              </div>
            ))}
          </div>

          {lista.length === 0 ? (
            <Vacio
              icono="🧾"
              titulo="Todavía no cargaste gastos"
              mensaje={
                "Acá va lo que sale y no es mercadería: alquiler, sueldos, luz, impuestos, fletes. " +
                "Lo que le comprás a un proveedor para revender no va acá, va en Compras. " +
                "Con esto cargado, Reportes deja de mostrarte sólo el margen y te muestra la ganancia real."
              }
              accion={<button className="btn primario" onClick={() => setNuevo(true)}>Cargar el primero</button>}
            />
          ) : (
            <div className="card">
              <div className="tabla-wrap solo-escritorio">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Categoría</th><th>Descripción</th>
                      <th>Medio</th><th className="num">Monto</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((g: any) => (
                      <tr key={g.id}>
                        <td className="num">{fecha(g.fecha)}</td>
                        <td>{g.categoria}</td>
                        <td>{g.descripcion ?? "—"}</td>
                        <td>{g.medio_pago ?? "—"}</td>
                        <td className="num debe">{pesos(g.monto)}</td>
                        <td className="acc">
                          <div className="btn-grupo" style={{ justifyContent: "flex-end" }}>
                            <button className="btn chico" onClick={() => setEditar(g)}>Editar</button>
                            <button className="btn chico peligro" onClick={() => setBorrar(g)}>Borrar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card-body solo-movil lista-tarjetas">
                {lista.map((g: any) => (
                  <div className="tarjeta-fila" key={g.id}>
                    <div className="tf-titulo">
                      {g.categoria}
                      <span className="mut" style={{ fontWeight: 400 }}> · {fecha(g.fecha)}</span>
                    </div>
                    <div className="tf-datos">
                      <span className="num debe">{pesos(g.monto)}</span>
                      {g.medio_pago && <span className="mut">{g.medio_pago}</span>}
                    </div>
                    {g.descripcion && <div className="mut">{g.descripcion}</div>}
                    <div className="tf-datos" style={{ marginTop: 8 }}>
                      <button className="btn chico" onClick={() => setEditar(g)}>Editar</button>
                      <button className="btn chico peligro" onClick={() => setBorrar(g)}>Borrar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {(nuevo || editar) && (
        <FormGasto
          gasto={editar}
          sugerencias={sugerencias}
          onCerrar={(m) => { setNuevo(false); setEditar(null); if (m) actualizar(m); }}
        />
      )}
      {borrar && (
        <Confirmar
          mensaje={`¿Borrar el gasto de ${pesos(borrar.monto)} (${borrar.categoria}) del ${fecha(borrar.fecha)}?`}
          textoConfirmar="Borrar"
          peligro
          onSi={hacerBorrar}
          onNo={() => setBorrar(null)}
        />
      )}
    </div>
  );
}

function FormGasto({
  gasto, sugerencias, onCerrar,
}: { gasto: any | null; sugerencias: string[]; onCerrar: (mensaje?: string) => void }) {
  const [f, setF] = useState({
    fecha: gasto?.fecha ?? hoyISO(),
    categoria: gasto?.categoria ?? "",
    descripcion: gasto?.descripcion ?? "",
    monto: gasto ? aPesos(gasto.monto) : "",
    medio_pago: gasto?.medio_pago ?? "efectivo",
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.categoria.trim()) { setError("Poné una categoría (alquiler, sueldos, luz…)."); return; }
    const monto = aCentavos(f.monto || "0");
    if (monto <= 0) { setError("El monto tiene que ser mayor a cero."); return; }
    setError(null);
    setGuardando(true);
    try {
      const cuerpo = { ...f, monto };
      if (gasto) await api.put(`/api/gastos/${gasto.id}`, cuerpo);
      else await api.post("/api/gastos", cuerpo);
      onCerrar(gasto ? "Gasto actualizado." : "Gasto cargado.");
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={gasto ? "Editar gasto" : "Nuevo gasto"} onCerrar={() => onCerrar()}>
      <form onSubmit={guardar}>
        <Error msg={error} />
        <div className="fila">
          <Campo label="Fecha">
            <input type="date" value={f.fecha} onChange={(e) => set("fecha", e.target.value)} />
          </Campo>
          <Campo label="Monto">
            <input
              className="num" inputMode="decimal" placeholder="0,00"
              value={f.monto} onChange={(e) => set("monto", e.target.value)} autoFocus
            />
          </Campo>
        </div>
        <Campo label="Categoría">
          <input
            list="cat-gastos" value={f.categoria} placeholder="Alquiler, sueldos, luz…"
            onChange={(e) => set("categoria", e.target.value)}
          />
          <datalist id="cat-gastos">
            {sugerencias.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Campo>
        <Campo label="Descripción (opcional)">
          <input
            value={f.descripcion} placeholder="Ej: luz del local, bimestre agosto"
            onChange={(e) => set("descripcion", e.target.value)}
          />
        </Campo>
        <Campo label="Medio de pago (opcional)">
          <input value={f.medio_pago} onChange={(e) => set("medio_pago", e.target.value)} />
        </Campo>
        <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => onCerrar()}>Cancelar</button>
          <button className="btn primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
