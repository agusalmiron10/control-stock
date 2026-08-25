import { useState } from "react";
import { api } from "../api";
import { Modal, Campo, Error, Cargando, Vacio, useCarga } from "../components/ui";

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
  notas: string | null;
  alta: string;
  usuarios: number;
  clientes: number;
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
  const [modo, setModo] = useState<{ t: "alta" } | { t: "editar"; n: Negocio } | { t: "clave"; n: Negocio } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
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

  const negocios = lista.data?.negocios ?? [];
  const activos = negocios.filter((n) => n.estado === "activo" || n.estado === "prueba");

  return (
    <div className="app">
      <main className="contenido" style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
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

        {lista.cargando && <Cargando />}
        <Error msg={lista.error} />

        {!lista.cargando && negocios.length === 0 && (
          <Vacio
            mensaje="Todavía no diste de alta ningún cliente."
            accion={<button className="btn primario" onClick={() => setModo({ t: "alta" })}>Dar de alta el primero</button>}
          />
        )}

        {negocios.length > 0 && <div className="card"><div className="card-body lista-tarjetas">
          {negocios.map((n) => (
            <div key={n.id} className="tarjeta-fila">
              <div className="tf-titulo">
                <strong>{n.nombre}</strong>
                <span className={`badge ${n.estado === "activo" ? "pagada" : n.estado === "prueba" ? "parcial" : "anulada"}`}>{ESTADOS.find((e) => e.id === n.estado)?.label}</span>
                <code className="mut" style={{ fontSize: 12 }}>{n.codigo}</code>
              </div>
              <div className="tf-datos">
                <span>{plata(n.clientes)} clientes · {plata(n.productos)} productos · {plata(n.ventas)} ventas</span>
                <span className="mut">Última venta: {desdeHace(n.ultima_venta)}</span>
                {n.contacto && <span className="mut">{n.contacto}{n.telefono ? ` · ${n.telefono}` : ""}</span>}
              </div>
              <div className="tf-datos" style={{ marginTop: 6 }}>
                <button className="btn chico primario" onClick={() => entrar(n)}>Entrar</button>
                <button className="btn chico" onClick={() => setModo({ t: "editar", n })}>Editar</button>
                <button className="btn chico" onClick={() => setModo({ t: "clave", n })}>Blanquear clave</button>
              </div>
            </div>
          ))}
        </div></div>}
      </main>

      {modo?.t === "alta" && <FormAlta onCerrar={cerrar} />}
      {modo?.t === "editar" && <FormEditar negocio={modo.n} onCerrar={cerrar} />}
      {modo?.t === "clave" && <FormClave negocio={modo.n} onCerrar={cerrar} />}
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

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.put(`/api/super/negocios/${negocio.id}`, f);
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
