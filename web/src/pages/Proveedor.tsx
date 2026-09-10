import { useEffect, useState } from "react";
import { api } from "../api";
import { Modal, Campo, Error, Cargando, Vacio, useCarga } from "../components/ui";
import { CopiasProveedor } from "../components/CopiasProveedor";
import { RegistroProveedor } from "../components/RegistroProveedor";
import { SaludArca } from "../components/SaludArca";
import { MetricasProveedor } from "../components/MetricasProveedor";
import { ErroresProveedor } from "../components/ErroresProveedor";
import { MODULOS, INFO_MODULOS, type Modulo } from "../lib/config";
import { pesos, fecha, aCentavos, aPesos, hoyISO } from "../format";
import { waRecordatorioSuscripcion } from "../lib/whatsapp";

/**
 * Pantalla del proveedor del sistema: la cartera de clientes. Desde acá se
 * da de alta un negocio nuevo (queda usable en el momento), se ve cómo viene
 * cada uno y se entra a cualquiera para dar soporte.
 */

interface Negocio {
  id: string;
  nombre: string;
  codigo: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  estado: "prueba" | "activo" | "suspendido" | "baja";
  plan: string | null;
  precio_mensual: number | null;
  paga_hasta: string | null;
  dias_para_vencer: number | null;
  ultimo_pago: string | null;
  sin_corte: number;
  notas: string | null;
  alta: string;
  usuarios: number;
  clientes: number;
  rubro_id: string | null;
  rubro_nombre: string | null;
  rubro_otro_texto: string | null;
  productos: number;
  ventas: number;
  ultima_venta: string | null;
}

const ESTADOS = [
  { id: "prueba", label: "En prueba" },
  { id: "activo", label: "Activo" },
  { id: "suspendido", label: "Suspendido" },
  { id: "baja", label: "De baja" },
] as const;

/**
 * Cada bloque de "Herramientas del proveedor" se abre y cierra: son tablas
 * largas y no se miran todas a la vez. Arrancan cerradas y cuál quedó
 * abierto se recuerda entre sesiones (mismo criterio que los grupos del
 * menú lateral). El contenido no se monta hasta que se abre por primera
 * vez, así abrir el panel no dispara 7 llamadas a la API de una.
 */
function SeccionColapsable({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const clave = `cs_prov_seccion_${titulo}`;
  const [abierto, setAbierto] = useState(() => {
    try { return localStorage.getItem(clave) === "1"; } catch { return false; }
  });
  function alternar() {
    setAbierto((v) => {
      const siguiente = !v;
      try { localStorage.setItem(clave, siguiente ? "1" : "0"); } catch { /* incógnito o storage lleno */ }
      return siguiente;
    });
  }
  return (
    <div className="card">
      <button type="button" className="card-header card-header-toggle" aria-expanded={abierto} onClick={alternar}>
        <span className="card-header-chevron" aria-hidden>{abierto ? "▾" : "▸"}</span>
        {titulo}
      </button>
      {abierto && <div className="card-body">{children}</div>}
    </div>
  );
}

function plata(n: number): string {
  return n.toLocaleString("es-AR");
}

/** "hace 3 días" es más útil que una fecha para saber si el cliente lo usa. */
function desdeHace(fecha: string | null): string {
  if (!fecha) return "sin ventas";
  const dias = Math.floor((Date.now() - new Date(fecha + "T00:00:00").getTime()) / 86400000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  if (dias < 365) {
    const m = Math.floor(dias / 30);
    return m === 1 ? "hace 1 mes" : `hace ${m} meses`;
  }
  const a = Math.floor(dias / 365);
  return a === 1 ? "hace 1 año" : `hace ${a} años`;
}

export function Proveedor({ onEntrar }: { onEntrar: () => void }) {
  const [modo, setModo] = useState<
    | { t: "alta" }
    | { t: "editar"; n: Negocio }
    | { t: "clave"; n: Negocio }
    | { t: "plan"; n: Negocio }
    | { t: "cobro"; n: Negocio }
    | { t: "pagos"; n: Negocio }
    | null
  >(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscar, setBuscar] = useState("");
  const lista = useCarga<{ negocios: Negocio[] }>(() => api.get("/api/super/negocios"), []);

  function cerrar(msg?: string) {
    setModo(null);
    if (msg) setAviso(msg);
    lista.recargar();
  }

  async function entrar(n: Negocio) {
    await api.post(`/api/super/negocios/${n.id}/entrar`);
    onEntrar();
  }

  const negocios: Negocio[] = lista.data?.negocios ?? [];
  const activos = negocios.filter((n) => n.estado === "activo" || n.estado === "prueba");
  // El buscador sólo filtra qué filas se muestran en la tabla — los KPI de
  // arriba (facturación, vencidos) siguen contando TODOS los clientes,
  // buscados o no, porque son un resumen general, no del filtro.
  const q = buscar.trim().toLowerCase();
  const negociosFiltrados = q
    ? negocios.filter((n) => n.nombre.toLowerCase().includes(q) || n.codigo.toLowerCase().includes(q))
    : negocios;

  // Quién está al día y quién no. Sólo cuenta a los que tienen plan cargado:
  // un negocio sin precio todavía no es un cliente que paga.
  const conPlan = negocios.filter((n) => n.precio_mensual != null && !n.sin_corte);
  const vencidos = conPlan.filter((n) => n.dias_para_vencer != null && n.dias_para_vencer < 0);
  const porVencer = conPlan.filter((n) => n.dias_para_vencer != null && n.dias_para_vencer >= 0 && n.dias_para_vencer <= 7);
  const facturacionMensual = conPlan
    .filter((n) => n.estado === "activo")
    .reduce((s, n) => s + (n.precio_mensual ?? 0), 0);

  return (
    <div className="app">
      <main className="contenido">
        <div className="encabezado-seccion">
          <div>
            <h1 style={{ margin: 0 }}>Mis clientes</h1>
            <p className="mut" style={{ margin: "4px 0 0" }}>
              {activos.length === 1 ? "1 instalación" : `${activos.length} instalaciones`} en uso
              {negocios.length !== activos.length && ` · ${negocios.length - activos.length} inactiva(s)`}
            </p>
          </div>
          <div className="btn-grupo">
            <button className="btn primario" onClick={() => setModo({ t: "alta" })}>+ Nuevo cliente</button>
            <button className="btn" onClick={() => api.post("/api/auth/logout").then(onEntrar)}>Salir</button>
          </div>
        </div>

        {aviso && <div className="ok-box">{aviso}</div>}

        {conPlan.length > 0 && (
          <div className="grid-kpi">
            <div className="kpi">
              <div className="rot">Facturación mensual</div>
              <div className="val">{pesos(facturacionMensual)}</div>
              <div className="mut">{conPlan.filter((n) => n.estado === "activo").length} clientes activos</div>
            </div>
            <div className="kpi">
              <div className="rot">Vencidos</div>
              <div className={`val ${vencidos.length > 0 ? "debe" : ""}`}>{vencidos.length}</div>
              {vencidos.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
                  {vencidos.map((n) => (
                    <button key={n.id} type="button" className="btn chico" style={{ justifyContent: "space-between" }}
                      onClick={() => waRecordatorioSuscripcion(n, n.dias_para_vencer ?? 0)}>
                      {n.nombre} · Recordar
                    </button>
                  ))}
                </div>
              ) : <div className="mut">Nadie te debe</div>}
            </div>
            <div className="kpi">
              <div className="rot">Vencen esta semana</div>
              <div className="val">{porVencer.length}</div>
              {porVencer.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
                  {porVencer.map((n) => (
                    <button key={n.id} type="button" className="btn chico" style={{ justifyContent: "space-between" }}
                      onClick={() => waRecordatorioSuscripcion(n, n.dias_para_vencer ?? 0)}>
                      {n.nombre} · Recordar
                    </button>
                  ))}
                </div>
              ) : <div className="mut">Ninguno</div>}
            </div>
          </div>
        )}

        {lista.cargando && <Cargando />}
        <Error msg={lista.error} />

        {!lista.cargando && negocios.length === 0 && (
          <Vacio
            mensaje="Todavía no diste de alta ningún cliente."
            accion={<button className="btn primario" onClick={() => setModo({ t: "alta" })}>Dar de alta el primero</button>}
          />
        )}

        {negocios.length > 3 && (
          <div className="campo" style={{ maxWidth: 300, marginBottom: 12 }}>
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar cliente por nombre…"
            />
          </div>
        )}

        {negocios.length > 0 && negociosFiltrados.length === 0 && (
          <div className="card"><div className="card-body">
            <Vacio mensaje={`No hay ningún cliente que coincida con "${buscar}".`} />
          </div></div>
        )}

        {negociosFiltrados.length > 0 && (
          <div className="card">
            <div className="tabla-wrap solo-escritorio">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cliente</th><th>Contacto</th><th>Uso</th><th>Plan y pago</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {negociosFiltrados.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <strong>{n.nombre}</strong>
                          <span className={`badge ${n.estado === "activo" ? "pagada" : n.estado === "prueba" ? "parcial" : "anulada"}`}>
                            {ESTADOS.find((e) => e.id === n.estado)?.label}
                          </span>
                        </div>
                        <code className="mut" style={{ fontSize: 12 }}>{n.codigo}</code>
                        <div className="mut" style={{ fontSize: 12 }}>
                          {n.rubro_nombre ?? <span className="debe">Sin rubro elegido</span>}
                          {n.rubro_otro_texto ? ` · "${n.rubro_otro_texto}"` : ""}
                        </div>
                      </td>
                      <td className="mut">
                        {n.contacto || n.telefono
                          ? <>{n.contacto}{n.contacto && n.telefono ? <br /> : null}{n.telefono}</>
                          : "—"}
                      </td>
                      <td>
                        <div>{plata(n.clientes)} clientes · {plata(n.productos)} productos · {plata(n.ventas)} ventas</div>
                        <div className="mut">Última venta: {desdeHace(n.ultima_venta)}</div>
                      </td>
                      <td>
                        {n.precio_mensual == null ? (
                          <span className="mut">Sin plan asignado</span>
                        ) : (
                          <>
                            <div>{n.plan ?? "Plan"} · {pesos(n.precio_mensual)}/mes</div>
                            <div className={n.sin_corte ? "mut" : (n.dias_para_vencer ?? 0) < 0 ? "debe" : "mut"}>
                              {n.sin_corte
                                ? "Sin corte"
                                : n.paga_hasta == null
                                  ? "Nunca pagó"
                                  : (n.dias_para_vencer ?? 0) < 0
                                    ? `Vencido hace ${Math.abs(n.dias_para_vencer ?? 0)} día(s)`
                                    : `Al día · vence en ${n.dias_para_vencer} día(s)`}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="acc">
                        <div className="btn-grupo" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <button className="btn chico primario" onClick={() => entrar(n)}>Entrar</button>
                          <button className="btn chico" onClick={() => setModo({ t: "cobro", n })}>Registrar cobro</button>
                          <button className="btn chico" onClick={() => setModo({ t: "pagos", n })}>Ver pagos</button>
                          <button className="btn chico" onClick={() => setModo({ t: "plan", n })}>Plan</button>
                          <button className="btn chico" onClick={() => setModo({ t: "editar", n })}>Editar</button>
                          <button className="btn chico" onClick={() => setModo({ t: "clave", n })}>Blanquear clave</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card-body solo-movil lista-tarjetas">
              {negociosFiltrados.map((n) => (
                <div key={n.id} className="tarjeta-fila">
                  <div className="tf-titulo">
                    <strong>{n.nombre}</strong>
                    <span className={`badge ${n.estado === "activo" ? "pagada" : n.estado === "prueba" ? "parcial" : "anulada"}`}>{ESTADOS.find((e) => e.id === n.estado)?.label}</span>
                    <code className="mut" style={{ fontSize: 12 }}>{n.codigo}</code>
                    <span className="mut" style={{ fontSize: 12, fontWeight: 400 }}>
                      {n.rubro_nombre ?? "Sin rubro"}
                    </span>
                  </div>
                  <div className="tf-datos">
                    <span>{plata(n.clientes)} clientes · {plata(n.productos)} productos · {plata(n.ventas)} ventas</span>
                    <span className="mut">Última venta: {desdeHace(n.ultima_venta)}</span>
                    {n.contacto && <span className="mut">{n.contacto}{n.telefono ? ` · ${n.telefono}` : ""}</span>}
                  </div>
                  <div className="tf-datos">
                    {n.precio_mensual == null ? (
                      <span className="mut">Sin plan asignado</span>
                    ) : (
                      <>
                        <span>{n.plan ?? "Plan"} · {pesos(n.precio_mensual)}/mes</span>
                        <span className={n.sin_corte ? "mut" : (n.dias_para_vencer ?? 0) < 0 ? "debe" : "mut"}>
                          {n.sin_corte
                            ? "Sin corte"
                            : n.paga_hasta == null
                              ? "Nunca pagó"
                              : (n.dias_para_vencer ?? 0) < 0
                                ? `Vencido hace ${Math.abs(n.dias_para_vencer ?? 0)} día(s)`
                                : `Al día · vence en ${n.dias_para_vencer} día(s)`}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="tf-datos" style={{ marginTop: 6 }}>
                    <button className="btn chico primario" onClick={() => entrar(n)}>Entrar</button>
                    <button className="btn chico" onClick={() => setModo({ t: "cobro", n })}>Registrar cobro</button>
                    <button className="btn chico" onClick={() => setModo({ t: "pagos", n })}>Ver pagos</button>
                    <button className="btn chico" onClick={() => setModo({ t: "plan", n })}>Plan</button>
                    <button className="btn chico" onClick={() => setModo({ t: "editar", n })}>Editar</button>
                    <button className="btn chico" onClick={() => setModo({ t: "clave", n })}>Blanquear clave</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {negocios.length > 0 && (
          <>
            <div className="encabezado-seccion" style={{ marginTop: 32, borderTop: "1px solid var(--borde)", paddingTop: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>Herramientas del proveedor</h2>
                <p className="mut" style={{ margin: "4px 0 0" }}>
                  Uso de cada instalación, estado de la facturación electrónica, y qué se tocó y cuándo.
                </p>
              </div>
            </div>

            <SeccionColapsable titulo="Rubros y perfiles"><RubrosYPerfiles /></SeccionColapsable>
            <SeccionColapsable titulo='Rubros pedidos como "Otro"'><RubrosOtro /></SeccionColapsable>
            <SeccionColapsable titulo="Errores del sistema"><ErroresProveedor /></SeccionColapsable>
            <SeccionColapsable titulo="Uso por cliente"><MetricasProveedor /></SeccionColapsable>
            <SeccionColapsable titulo="Facturación electrónica"><SaludArca /></SeccionColapsable>
            <SeccionColapsable titulo="Registro"><RegistroProveedor /></SeccionColapsable>
            <SeccionColapsable titulo="Copias de seguridad"><CopiasProveedor /></SeccionColapsable>
          </>
        )}
      </main>

      {modo?.t === "alta" && <FormAlta onCerrar={cerrar} />}
      {modo?.t === "editar" && <FormEditar negocio={modo.n} onCerrar={cerrar} />}
      {modo?.t === "clave" && <FormClave negocio={modo.n} onCerrar={cerrar} />}
      {modo?.t === "plan" && <FormPlan negocio={modo.n} onCerrar={cerrar} />}
      {modo?.t === "cobro" && <FormCobro negocio={modo.n} onCerrar={cerrar} />}
      {modo?.t === "pagos" && <FormPagos negocio={modo.n} onCerrar={cerrar} />}
    </div>
  );
}

/** Alta de un cliente nuevo: al confirmar, su sistema ya está andando. */
function FormAlta({ onCerrar }: { onCerrar: (msg?: string) => void }) {
  const rubrosQ = useCarga<{ rubros: { id: string; etiqueta: string; modulos: string[] }[] }>(
    () => api.get("/api/super/rubros"),
    []
  );
  const [f, setF] = useState({
    nombre: "", rubro: "ferreteria", contacto: "", telefono: "", email: "",
    usuario: "admin", password: "", estado: "prueba", notas: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState<{ codigo: string; usuario: string } | null>(null);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const rubro = rubrosQ.data?.rubros.find((r) => r.id === f.rubro);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const r = await api.post<{ codigo: string; usuario: string }>("/api/super/negocios", f);
      setListo(r);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  // Una vez creado se muestran los datos de acceso: es lo que hay que pasarle
  // al cliente, y la contraseña no se puede volver a ver después.
  if (listo) {
    const url = `${location.origin}/#/panel`;
    const texto = `Tu sistema ya está listo.\n\nEntrá a: ${url}\nNegocio: ${listo.codigo}\nUsuario: ${listo.usuario}\nContraseña: ${f.password}\n\nCambiala apenas entres, desde Ajustes.`;
    return (
      <Modal titulo="Cliente dado de alta" onCerrar={() => onCerrar(`${f.nombre} ya puede entrar.`)}>
        <p>Pasale estos datos. La contraseña no se puede volver a ver.</p>
        <pre className="bloque-datos" style={{ whiteSpace: "pre-wrap", background: "var(--superficie)", border: "1px solid var(--borde)", borderRadius: 8, padding: 12, fontSize: 13 }}>{texto}</pre>
        <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(texto)}>Copiar</button>
          <a
            className="btn"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/${(f.telefono || "").replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`}
          >
            Enviar por WhatsApp
          </a>
          <button className="btn primario" onClick={() => onCerrar(`${f.nombre} ya puede entrar.`)}>Listo</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo="Nuevo cliente" onCerrar={() => onCerrar()}>
      <form onSubmit={guardar}>
        <Error msg={error} />
        <Campo label="Nombre del negocio">
          <input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} autoFocus placeholder="Ferretería El Tornillo" />
        </Campo>
        <Campo label="Rubro">
          <select value={f.rubro} onChange={(e) => set("rubro", e.target.value)}>
            {(rubrosQ.data?.rubros ?? []).map((r) => <option key={r.id} value={r.id}>{r.etiqueta}</option>)}
          </select>
        </Campo>
        {rubro && (
          <p className="mut" style={{ marginTop: -6, fontSize: 13 }}>
            Arranca con: {rubro.modulos.join(", ").replace(/_/g, " ")}. Después lo cambia desde Ajustes.
          </p>
        )}
        <div className="fila">
          <Campo label="Persona de contacto">
            <input value={f.contacto} onChange={(e) => set("contacto", e.target.value)} />
          </Campo>
          <Campo label="Teléfono">
            <input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} placeholder="11 2233 4455" />
          </Campo>
        </div>
        <Campo label="Email">
          <input value={f.email} onChange={(e) => set("email", e.target.value)} />
        </Campo>

        <hr />
        <p className="mut">Datos con los que va a entrar el dueño.</p>
        <div className="fila">
          <Campo label="Usuario">
            <input value={f.usuario} onChange={(e) => set("usuario", e.target.value)} autoCapitalize="none" />
          </Campo>
          <Campo label="Contraseña">
            <input value={f.password} onChange={(e) => set("password", e.target.value)} placeholder="mínimo 6 caracteres" />
          </Campo>
        </div>
        <Campo label="Estado">
          <select value={f.estado} onChange={(e) => set("estado", e.target.value)}>
            {ESTADOS.filter((e) => e.id !== "baja").map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </Campo>
        <Campo label="Notas (privadas)">
          <textarea rows={2} value={f.notas} onChange={(e) => set("notas", e.target.value)} />
        </Campo>

        <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => onCerrar()}>Cancelar</button>
          <button className="btn primario" disabled={guardando}>{guardando ? "Creando…" : "Crear e instalar"}</button>
        </div>
      </form>
    </Modal>
  );
}

function FormEditar({ negocio, onCerrar }: { negocio: Negocio; onCerrar: (msg?: string) => void }) {
  const [f, setF] = useState({
    nombre: negocio.nombre,
    contacto: negocio.contacto ?? "",
    telefono: negocio.telefono ?? "",
    email: negocio.email ?? "",
    estado: negocio.estado,
    notas: negocio.notas ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  // Los módulos son el único dato de este modal que el proveedor controla y
  // el dueño del negocio no puede tocar — por eso se cargan y se guardan
  // aparte, contra su propio endpoint.
  const detalle = useCarga<{ modulos: Record<Modulo, boolean> }>(() => api.get(`/api/super/negocios/${negocio.id}`), [negocio.id]);
  const [modulos, setModulos] = useState<Record<Modulo, boolean> | null>(null);
  useEffect(() => { if (detalle.data) setModulos(detalle.data.modulos); }, [detalle.data]);
  const toggleModulo = (m: Modulo) => setModulos((mm) => (mm ? { ...mm, [m]: !mm[m] } : mm));

  // El rubro va aparte de los módulos y no es lo mismo: los módulos son lo
  // que le vendiste, el rubro es cómo se comporta el sistema para él.
  const catalogo = useCarga<{ rubros: RubroCatalogo[] }>(() => api.get("/api/super/catalogo-rubros"), []);
  const [rubroId, setRubroId] = useState(negocio.rubro_id ?? "");

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.put(`/api/super/negocios/${negocio.id}`, f);
      if (modulos) await api.put(`/api/super/negocios/${negocio.id}/modulos`, { modulos });
      if (rubroId && rubroId !== negocio.rubro_id) {
        await api.put(`/api/super/negocios/${negocio.id}/rubro`, { rubro_id: rubroId });
      }
      onCerrar("Datos actualizados.");
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Modal titulo={negocio.nombre} onCerrar={() => onCerrar()}>
      <form onSubmit={guardar}>
        <Error msg={error} />
        <Campo label="Nombre"><input value={f.nombre} onChange={(e) => set("nombre", e.target.value)} /></Campo>
        <div className="fila">
          <Campo label="Contacto"><input value={f.contacto} onChange={(e) => set("contacto", e.target.value)} /></Campo>
          <Campo label="Teléfono"><input value={f.telefono} onChange={(e) => set("telefono", e.target.value)} /></Campo>
        </div>
        <Campo label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} /></Campo>
        <Campo label="Estado">
          <select value={f.estado} onChange={(e) => set("estado", e.target.value)}>
            {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </Campo>
        {(f.estado === "suspendido" || f.estado === "baja") && (
          <p className="error-box">
            Con este estado nadie de {negocio.nombre} va a poder entrar. Los datos quedan guardados.
          </p>
        )}
        <Campo label="Notas (privadas)">
          <textarea rows={3} value={f.notas} onChange={(e) => set("notas", e.target.value)} />
        </Campo>

        <hr />
        <Campo label="Rubro">
          <select value={rubroId} onChange={(e) => setRubroId(e.target.value)}>
            <option value="">Sin definir (lo elige el dueño al entrar)</option>
            {(catalogo.data?.rubros ?? []).filter((r) => r.activo).map((r) => (
              <option key={r.id} value={r.id}>{r.icono ?? ""} {r.nombre}</option>
            ))}
          </select>
        </Campo>
        <p className="mut" style={{ marginTop: -6, fontSize: 13 }}>
          Define cómo se comporta el sistema (cómo llama a los productos, qué campos tienen).
          No prende ni apaga funciones: eso son los módulos de abajo.
        </p>

        <hr />
        <p className="mut" style={{ marginTop: 0 }}>
          Módulos que tiene este negocio. Sólo vos podés prenderlos o apagarlos — el dueño no.
        </p>
        {!modulos ? (
          <p className="mut">Cargando…</p>
        ) : (
          <div className="lista-tarjetas">
            {MODULOS.map((m) => (
              <label className="tarjeta-fila modulo-fila" key={m}>
                <input type="checkbox" checked={modulos[m]} onChange={() => toggleModulo(m)} />
                <span>
                  <span className="tf-titulo" style={{ marginBottom: 2 }}>{INFO_MODULOS[m].titulo}</span>
                  <span className="mut">{INFO_MODULOS[m].detalle}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => onCerrar()}>Cancelar</button>
          <button className="btn primario">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

/** Para cuando el cliente llama diciendo que no puede entrar. */
function FormClave({ negocio, onCerrar }: { negocio: Negocio; onCerrar: (msg?: string) => void }) {
  const detalle = useCarga<{ usuarios: { id: number; usuario: string; rol: string }[] }>(
    () => api.get(`/api/super/negocios/${negocio.id}`),
    [negocio.id]
  );
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/api/super/negocios/${negocio.id}/clave`, { usuario, password });
      onCerrar(`Contraseña de "${usuario}" cambiada. Pasásela al cliente.`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Modal titulo={`Blanquear clave · ${negocio.nombre}`} onCerrar={() => onCerrar()}>
      <form onSubmit={guardar}>
        <Error msg={error} />
        <Campo label="Usuario">
          <select value={usuario} onChange={(e) => setUsuario(e.target.value)}>
            <option value="">Elegí un usuario…</option>
            {(detalle.data?.usuarios ?? []).map((u) => (
              <option key={u.id} value={u.usuario}>{u.usuario} ({u.rol})</option>
            ))}
          </select>
        </Campo>
        <Campo label="Contraseña nueva">
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" />
        </Campo>
        <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => onCerrar()}>Cancelar</button>
          <button className="btn primario" disabled={!usuario || password.length < 6}>Cambiar</button>
        </div>
      </form>
    </Modal>
  );
}


/** Cuánto paga este negocio y con qué tolerancia. No cobra: sólo define. */
function FormPlan({ negocio, onCerrar }: { negocio: Negocio; onCerrar: (msg?: string) => void }) {
  const [f, setF] = useState({
    plan: negocio.plan ?? "",
    precio: negocio.precio_mensual == null ? "" : String(aPesos(negocio.precio_mensual)),
    dias_gracia: String((negocio as any).dias_gracia ?? 7),
    sin_corte: negocio.sin_corte === 1,
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await api.put(`/api/super/negocios/${negocio.id}/plan`, {
        plan: f.plan || null,
        precio_mensual: f.precio === "" ? null : aCentavos(f.precio),
        dias_gracia: Number(f.dias_gracia) || 0,
        sin_corte: f.sin_corte,
      });
      onCerrar(`Plan de ${negocio.nombre} actualizado.`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Plan de ${negocio.nombre}`} onCerrar={() => onCerrar()}>
      <Error msg={error} />
      <div className="fila">
        <Campo label="Nombre del plan"><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} placeholder="Básico" /></Campo>
        <Campo label="Precio por mes ($)">
          <input type="number" step="0.01" min="0" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} />
        </Campo>
      </div>
      <Campo label="Días de tolerancia después del vencimiento">
        <input type="number" min="0" max="90" value={f.dias_gracia} onChange={(e) => setF({ ...f, dias_gracia: e.target.value })} />
      </Campo>
      <p className="mut" style={{ marginTop: -4 }}>
        Pasados esos días sin pagar, el sistema lo suspende solo. Los datos no se borran.
      </p>
      <label className="tarjeta-fila modulo-fila">
        <input type="checkbox" checked={f.sin_corte} onChange={(e) => setF({ ...f, sin_corte: e.target.checked })} />
        <span>
          No suspender nunca
          <div className="mut">Para tu propio negocio o un acuerdo especial.</div>
        </span>
      </label>
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>
      </div>
    </Modal>
  );
}

/** Registra un cobro y empuja la fecha hasta la que el negocio está cubierto. */
function FormCobro({ negocio, onCerrar }: { negocio: Negocio; onCerrar: (msg?: string) => void }) {
  const [f, setF] = useState({
    monto: negocio.precio_mensual == null ? "" : String(aPesos(negocio.precio_mensual)),
    meses: "1",
    medio: "transferencia",
    fecha: hoyISO(),
    nota: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!f.monto) { setError("Poné el monto cobrado."); return; }
    setError(null);
    setGuardando(true);
    try {
      const r = await api.post<{ cubre_hasta: string }>(`/api/super/negocios/${negocio.id}/cobro`, {
        monto: aCentavos(f.monto),
        meses: Number(f.meses) || 1,
        medio: f.medio,
        fecha: f.fecha,
        nota: f.nota || null,
      });
      onCerrar(`Cobro registrado. ${negocio.nombre} queda cubierto hasta el ${r.cubre_hasta}.`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Registrar cobro — ${negocio.nombre}`} onCerrar={() => onCerrar()}>
      <Error msg={error} />
      <p className="mut" style={{ marginTop: 0 }}>
        {negocio.paga_hasta
          ? `Hoy está cubierto hasta el ${negocio.paga_hasta}.`
          : "Todavía no tiene ningún pago registrado."}
      </p>
      <div className="fila">
        <Campo label="Monto ($)">
          <input type="number" step="0.01" min="0" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} />
        </Campo>
        <Campo label="Meses que cubre">
          <input type="number" min="1" max="36" value={f.meses} onChange={(e) => setF({ ...f, meses: e.target.value })} />
        </Campo>
      </div>
      <div className="fila">
        <Campo label="Fecha del cobro"><input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
        <Campo label="Medio">
          <select value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })}>
            {["transferencia", "efectivo", "mercadopago", "otro"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Campo>
      </div>
      <Campo label="Nota (opcional)"><input value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></Campo>
      <p className="mut">
        Si estaba suspendido por falta de pago, registrar el cobro lo reactiva solo.
      </p>
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={guardando} onClick={guardar}>{guardando ? "Guardando…" : "Registrar cobro"}</button>
      </div>
    </Modal>
  );
}

interface Cobro {
  id: string; fecha: string; monto: number; medio: string | null;
  cubre_hasta: string; nota: string | null; registrado_por: string | null; creado_en: string;
}

/** Todos los cobros que se le registraron a este negocio, más nuevo primero. */
function FormPagos({ negocio, onCerrar }: { negocio: Negocio; onCerrar: (msg?: string) => void }) {
  const { data, error, cargando } = useCarga<{ cobros: Cobro[] }>(
    () => api.get(`/api/super/negocios/${negocio.id}/cobros`),
    [negocio.id]
  );
  const cobros = data?.cobros ?? [];

  return (
    <Modal titulo={`Pagos — ${negocio.nombre}`} onCerrar={() => onCerrar()}>
      {cargando && <Cargando />}
      <Error msg={error} />
      {!cargando && cobros.length === 0 && (
        <p className="mut" style={{ marginTop: 0 }}>Todavía no se le registró ningún cobro a este cliente.</p>
      )}
      {cobros.length > 0 && (
        <div className="tabla-wrap">
          <table className="tabla">
            <thead>
              <tr><th>Fecha</th><th className="num">Monto</th><th>Medio</th><th>Cubre hasta</th><th>Nota</th></tr>
            </thead>
            <tbody>
              {cobros.map((c) => (
                <tr key={c.id}>
                  <td className="num">{fecha(c.fecha)}</td>
                  <td className="num">{pesos(c.monto)}</td>
                  <td>{c.medio ?? "—"}</td>
                  <td>{fecha(c.cubre_hasta)}</td>
                  <td className="mut">{c.nota ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" onClick={() => onCerrar()}>Cerrar</button>
      </div>
    </Modal>
  );
}


/**
 * Qué escribieron los que no encontraron su rubro en la lista. Cuando un
 * texto se repite, conviene darle su propia fila en `rubros` — que es todo
 * lo que hace falta para soportarlo, sin tocar código.
 */
function RubrosOtro() {
  const { data, error, cargando } = useCarga<{
    negocios: { id: string; nombre: string; codigo: string; rubro_otro_texto: string; rubro_configurado_en: string }[];
  }>(() => api.get("/api/super/rubros-otro"), []);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  const lista = data?.negocios ?? [];

  if (lista.length === 0) {
    return <p className="mut" style={{ marginTop: 0 }}>Nadie eligió "Otro" todavía: la lista de rubros les alcanzó a todos.</p>;
  }

  return (
    <div className="tabla-wrap">
      <table className="tabla">
        <thead><tr><th>Cliente</th><th>Escribió</th><th>Cuándo</th></tr></thead>
        <tbody>
          {lista.map((n) => (
            <tr key={n.id}>
              <td>{n.nombre} <code className="mut" style={{ fontSize: 12 }}>{n.codigo}</code></td>
              <td><b>{n.rubro_otro_texto}</b></td>
              <td className="mut">{fecha(n.rubro_configurado_en?.slice(0, 10))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface RubroCatalogo {
  id: string; nombre: string; icono: string | null; perfil_id: string;
  perfil_nombre: string; orden: number; activo: number; cuentas: number;
}
interface PerfilConfig { id: string; nombre: string; capacidades_json: string }

/**
 * Qué capacidad es de qué tipo. Es lo que permite editar el perfil con
 * controles de verdad (un check es un check, una lista es una lista) en vez
 * de un textarea de JSON donde cualquier dedazo rompe el perfil de todos los
 * clientes que lo usan.
 */
const CAMPOS_CAPACIDAD: { clave: string; etiqueta: string; tipo: "bool" | "texto" | "numero" | "lista" | "opciones"; opciones?: string[]; ayuda?: string }[] = [
  { clave: "concepto_default", etiqueta: "Qué factura por defecto", tipo: "opciones",
    opciones: ["productos", "servicios", "ambos"],
    ayuda: "Va en el campo Concepto de ARCA. Una fumigadora factura Servicios." },
  { clave: "producto_singular", etiqueta: "Producto (singular)", tipo: "texto", ayuda: "Artículo, Prenda, Herramienta…" },
  { clave: "producto_plural", etiqueta: "Producto (plural)", tipo: "texto" },
  { clave: "unidad_default", etiqueta: "Unidad por defecto", tipo: "texto", ayuda: "unidad, kg, metro…" },
  { clave: "categorias_sugeridas", etiqueta: "Categorías sugeridas", tipo: "lista", ayuda: "Separadas por coma. Se ofrecen al cargar un producto." },
  { clave: "campos_extra_producto", etiqueta: "Campos extra del producto", tipo: "lista", ayuda: "Separados por coma. Ej: marca, medida." },
  { clave: "permite_variantes", etiqueta: "Variantes (talle / color)", tipo: "bool", ayuda: "Cada combinación pasa a ser un producto con su propio stock." },
  { clave: "tipos_variante", etiqueta: "Tipos de variante", tipo: "lista", ayuda: "Qué define una variante. Ej: talle, color." },
  { clave: "permite_vencimientos", etiqueta: "Vencimientos", tipo: "bool", ayuda: "Fecha de vencimiento por producto, con aviso en el panel." },
  { clave: "alerta_dias_antes_vencer", etiqueta: "Avisar N días antes de vencer", tipo: "numero" },
  { clave: "venta_fraccionada", etiqueta: "Venta fraccionada (kg / metro)", tipo: "bool", ayuda: "Permite vender cantidades con decimales (1,5 kg)." },
  { clave: "requiere_numero_serie", etiqueta: "Número de serie por unidad", tipo: "bool", ayuda: "Se pide una serie por unidad al vender, y después se puede buscar por serie." },
  { clave: "precios_por_escala", etiqueta: "Precio por cantidad", tipo: "bool", ayuda: "Tramos por producto: de 10 en adelante, otro precio." },
];

/**
 * ABM de rubros y perfiles. Sumar un rubro acá es todo lo que hace falta
 * para soportarlo: no hay que tocar código ni desplegar.
 */
function RubrosYPerfiles() {
  const { data, error, cargando, recargar } = useCarga<{ rubros: RubroCatalogo[]; perfiles: PerfilConfig[] }>(
    () => api.get("/api/super/catalogo-rubros"),
    []
  );
  const [editando, setEditando] = useState<PerfilConfig | null>(null);
  const [nuevoRubro, setNuevoRubro] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  const rubros = data?.rubros ?? [];
  const perfiles = data?.perfiles ?? [];

  async function alternarActivo(r: RubroCatalogo) {
    await api.put(`/api/super/catalogo-rubros/${r.id}`, { activo: !r.activo });
    recargar();
  }

  return (
    <>
      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      <div className="tf-datos" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <p className="mut" style={{ margin: 0 }}>
          {rubros.length} rubros sobre {perfiles.length} perfiles. Un perfil define el
          comportamiento; varios rubros pueden compartirlo.
        </p>
        <button className="btn chico primario" onClick={() => setNuevoRubro(true)}>+ Nuevo rubro</button>
      </div>

      <div className="tabla-wrap">
        <table className="tabla">
          <thead>
            <tr><th>Rubro</th><th>Perfil</th><th className="num">Cuentas</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {rubros.map((r) => (
              <tr key={r.id} className={r.activo ? "" : "archivado"}>
                <td>{r.icono ?? ""} <b>{r.nombre}</b> <code className="mut" style={{ fontSize: 12 }}>{r.id}</code></td>
                <td>{r.perfil_nombre}</td>
                <td className="num">{r.cuentas || "—"}</td>
                <td>
                  <span className={`badge ${r.activo ? "pagada" : "anulada"}`}>{r.activo ? "Visible" : "Oculto"}</span>
                </td>
                <td className="acc">
                  <button className="btn chico" onClick={() => alternarActivo(r)}>
                    {r.activo ? "Ocultar" : "Mostrar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 6 }}>Perfiles</h3>
      <div className="lista-tarjetas">
        {perfiles.map((p) => {
          const usados = rubros.filter((r) => r.perfil_id === p.id);
          const cuentas = usados.reduce((s, r) => s + r.cuentas, 0);
          return (
            <div className="tarjeta-fila" key={p.id}>
              <div className="tf-titulo">
                <strong>{p.nombre}</strong>
                <code className="mut" style={{ fontSize: 12 }}>{p.id}</code>
              </div>
              <div className="tf-datos">
                <span className="mut">
                  {usados.length} rubro(s) · {cuentas} cuenta(s) usando este comportamiento
                </span>
              </div>
              <div className="tf-datos" style={{ marginTop: 6 }}>
                <button className="btn chico" onClick={() => setEditando(p)}>Editar capacidades</button>
              </div>
            </div>
          );
        })}
      </div>

      {editando && (
        <FormPerfil
          perfil={editando}
          cuentasAfectadas={rubros.filter((r) => r.perfil_id === editando.id).reduce((s, r) => s + r.cuentas, 0)}
          onCerrar={(m) => { setEditando(null); if (m) { setAviso(m); recargar(); } }}
        />
      )}
      {nuevoRubro && (
        <FormNuevoRubro
          perfiles={perfiles}
          onCerrar={(m) => { setNuevoRubro(false); if (m) { setAviso(m); recargar(); } }}
        />
      )}
    </>
  );
}

/** Edición de las capacidades de un perfil, con un control por tipo de dato. */
function FormPerfil({ perfil, cuentasAfectadas, onCerrar }: {
  perfil: PerfilConfig; cuentasAfectadas: number; onCerrar: (m?: string) => void;
}) {
  const [caps, setCaps] = useState<Record<string, any>>(() => {
    try { return JSON.parse(perfil.capacidades_json) ?? {}; } catch { return {}; }
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError(null);
    setGuardando(true);
    try {
      await api.put(`/api/super/perfiles/${perfil.id}`, { capacidades: caps });
      onCerrar(`Perfil "${perfil.nombre}" actualizado.`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Capacidades · ${perfil.nombre}`} ancho onCerrar={() => onCerrar()}
      pie={<>
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </>}>
      <Error msg={error} />
      {cuentasAfectadas > 0 && (
        <div className="pill-alerta">
          Esto le cambia el comportamiento a <b>{cuentasAfectadas} cuenta(s)</b> — salvo donde
          tengan un ajuste propio, que siempre le gana al perfil.
        </div>
      )}
      {CAMPOS_CAPACIDAD.map((campo) => (
        <div key={campo.clave} style={{ marginBottom: 10 }}>
          {campo.tipo === "bool" ? (
            <label className="tarjeta-fila modulo-fila">
              <input
                type="checkbox"
                checked={!!caps[campo.clave]}
                onChange={(e) => setCaps((c) => ({ ...c, [campo.clave]: e.target.checked }))}
              />
              <span>
                {campo.etiqueta}
                {campo.ayuda && <div className="mut">{campo.ayuda}</div>}
              </span>
            </label>
          ) : (
            <Campo label={campo.etiqueta}>
              {campo.tipo === "opciones" ? (
                <select
                  value={caps[campo.clave] ?? campo.opciones![0]}
                  onChange={(e) => setCaps((c) => ({ ...c, [campo.clave]: e.target.value }))}
                >
                  {campo.opciones!.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : campo.tipo === "numero" ? (
                <input
                  className="num" type="number" min={0}
                  value={caps[campo.clave] ?? ""}
                  onChange={(e) => setCaps((c) => ({ ...c, [campo.clave]: Number(e.target.value) }))}
                />
              ) : (
                <input
                  value={campo.tipo === "lista"
                    ? (Array.isArray(caps[campo.clave]) ? caps[campo.clave].join(", ") : "")
                    : (caps[campo.clave] ?? "")}
                  onChange={(e) => setCaps((c) => ({
                    ...c,
                    [campo.clave]: campo.tipo === "lista"
                      ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean)
                      : e.target.value,
                  }))}
                />
              )}
              {campo.ayuda && <p className="mut" style={{ margin: "2px 0 0", fontSize: 12.5 }}>{campo.ayuda}</p>}
            </Campo>
          )}
        </div>
      ))}
    </Modal>
  );
}

/** Alta de un rubro: una fila más, sin tocar código. */
function FormNuevoRubro({ perfiles, onCerrar }: { perfiles: PerfilConfig[]; onCerrar: (m?: string) => void }) {
  const [f, setF] = useState({ id: "", nombre: "", icono: "", perfil_id: perfiles[0]?.id ?? "", orden: "500" });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await api.post("/api/super/catalogo-rubros", { ...f, orden: Number(f.orden) || 500 });
      onCerrar(`Rubro "${f.nombre}" creado. Ya aparece en el selector de los clientes.`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo rubro" onCerrar={() => onCerrar()}>
      <form onSubmit={guardar}>
        <Error msg={error} />
        <div className="fila">
          <Campo label="Nombre visible">
            <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Pinturería" autoFocus />
          </Campo>
          <Campo label="Icono">
            <input value={f.icono} onChange={(e) => setF({ ...f, icono: e.target.value })} placeholder="🎨" maxLength={4} />
          </Campo>
        </div>
        <Campo label="Identificador">
          <input value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} placeholder="pintureria" />
        </Campo>
        <p className="mut" style={{ marginTop: -6, fontSize: 13 }}>Sin espacios ni acentos. No se puede cambiar después.</p>
        <div className="fila">
          <Campo label="Se comporta como">
            <select value={f.perfil_id} onChange={(e) => setF({ ...f, perfil_id: e.target.value })}>
              {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Orden en la lista">
            <input className="num" type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} />
          </Campo>
        </div>
        <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => onCerrar()}>Cancelar</button>
          <button className="btn primario" disabled={guardando}>{guardando ? "Creando…" : "Crear rubro"}</button>
        </div>
      </form>
    </Modal>
  );
}
