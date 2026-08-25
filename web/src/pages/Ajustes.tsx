import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { hoyISO, fecha } from "../format";
import { Campo, Error, Confirmar, useCarga } from "../components/ui";
import { exportarGeneral } from "../excel";
import { useRol, esDueno } from "../lib/rol";
import { useConfig, MODULOS, INFO_MODULOS, type ConfigNegocio, type Modulo } from "../lib/config";

export function Ajustes() {
  const rol = useRol();
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restaurarData, setRestaurarData] = useState<any | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function descargarRespaldo() {
    setError(null);
    try {
      const data = await api.get<any>("/api/backup");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `respaldo-control-stock-${hoyISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) { setError(err.message); }
  }

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setRestaurarData(JSON.parse(String(reader.result)));
      } catch {
        setError("El archivo no es un JSON válido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function restaurar() {
    if (!restaurarData) return;
    setError(null);
    try {
      await api.post("/api/backup/restore", restaurarData);
      setRestaurarData(null);
      setAviso("Respaldo restaurado. Recargá la página para ver los datos.");
    } catch (err: any) { setError(err.message); setRestaurarData(null); }
  }

  return (
    <div>
      <div className="encabezado-seccion"><h1>Ajustes</h1></div>
      {aviso && <div className="ok-box" onClick={() => setAviso(null)}>{aviso}</div>}
      <Error msg={error} />

      {esDueno(rol) && (
        <>
          <ConfigNegocioForm onOk={setAviso} onError={setError} />
          <ConexionPanel onOk={setAviso} onError={setError} />

          <div className="card">
            <h2>Exportar a Excel</h2>
            <div className="card-body">
              <p className="mut">Excel general del negocio (clientes, ventas, pagos, herramientas y movimientos). Podés filtrar por fechas.</p>
              <div className="barra-filtros">
                <div className="campo"><label>Desde (opcional)</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
                <div className="campo"><label>Hasta (opcional)</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
                <button className="btn primario" onClick={() => exportarGeneral(desde || undefined, hasta || undefined).catch((e) => setError(e.message))}>
                  ⬇ Descargar Excel general
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Respaldo</h2>
            <div className="card-body">
              <p className="mut">Descargá toda la base en un archivo JSON, o restaurá desde uno. Restaurar <b>reemplaza</b> todos los datos actuales.</p>
              <div className="btn-grupo">
                <button className="btn" onClick={descargarRespaldo}>⬇ Descargar respaldo (.json)</button>
                <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Restaurar respaldo</button>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }} onChange={elegirArchivo} />
              </div>
              <p className="mut" style={{ marginTop: 12 }}>
                Backup manual por consola: <code>wrangler d1 export control-stock --remote --output=respaldo.sql</code>.
                Además, D1 tiene <b>Time Travel</b> para volver a un punto anterior de los últimos 30 días.
                Cada madrugada además se guarda una copia automática en Cloudflare R2 (ver README).
              </p>
            </div>
          </div>
        </>
      )}

      <CambiarPassword onOk={setAviso} onError={setError} />
      {esDueno(rol) && <GestionUsuarios onOk={setAviso} onError={setError} />}

      {restaurarData && (
        <Confirmar
          mensaje="Restaurar el respaldo REEMPLAZA todos los datos actuales (clientes, ventas, pagos, stock). ¿Seguro?"
          textoConfirmar="Restaurar y reemplazar" peligro onSi={restaurar} onNo={() => setRestaurarData(null)} />
      )}
    </div>
  );
}

/**
 * Conexión con el panel del proveedor: una vez por noche esta instalación le
 * manda un resumen (totales, nada de datos de clientes ni ventas) para que
 * pueda ver que el sistema está funcionando.
 */
function ConexionPanel({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const { data, recargar } = useCarga<any>(() => api.get("/api/config/panel"), []);
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const u = url ?? data?.url ?? "";
  const t = token ?? data?.token ?? "";

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setGuardando(true);
    try {
      await api.put("/api/config/panel", { url: u, token: t });
      onOk(u ? "Conexión con el panel guardada." : "Conexión con el panel desactivada.");
      recargar();
    } catch (err: any) { onError(err.message); } finally { setGuardando(false); }
  }

  return (
    <form className="card" onSubmit={guardar}>
      <h2>Conexión con el panel de soporte</h2>
      <div className="card-body">
        <p className="mut" style={{ marginTop: 0 }}>
          Opcional. Si se completa, cada noche se envía un resumen (total vendido en el mes, cantidad de
          clientes y de productos) a quien te dio el sistema. <b>No se envían datos de tus clientes ni el
          detalle de tus ventas.</b> Dejalo vacío para no enviar nada.
        </p>
        <Campo label="URL del panel"><input value={u} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></Campo>
        <Campo label="Token"><input value={t} onChange={(e) => setToken(e.target.value)} /></Campo>
        <button className="btn primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar conexión"}</button>
      </div>
    </form>
  );
}

/**
 * Identidad del negocio y módulos activos. Esto es lo que hace que la misma
 * app sirva para una fábrica, una ferretería o un kiosko.
 */
function ConfigNegocioForm({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const cfg = useConfig();
  const [f, setF] = useState<ConfigNegocio | null>(null);
  const [guardando, setGuardando] = useState(false);

  // La config llega de forma asíncrona: en cuanto está, se copia al formulario.
  useEffect(() => { setF(cfg); }, [cfg]);
  if (!f) return null;

  const setNegocio = (k: string, v: string) => setF({ ...f, negocio: { ...f.negocio, [k]: v } });
  const setVocab = (k: string, v: string) => setF({ ...f, vocabulario: { ...f.vocabulario, [k]: v } });
  const toggle = (m: Modulo) => setF({ ...f, modulos: { ...f.modulos, [m]: !f.modulos[m] } });

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setGuardando(true);
    try {
      await api.put("/api/config", f);
      window.dispatchEvent(new CustomEvent("config-cambiada"));
      onOk("Configuración guardada.");
    } catch (err: any) { onError(err.message); } finally { setGuardando(false); }
  }

  return (
    <form className="card" onSubmit={guardar}>
      <h2>El negocio</h2>
      <div className="card-body">
        <p className="mut" style={{ marginTop: 0 }}>
          Estos datos aparecen en los comprobantes, los PDF y los mensajes de WhatsApp.
        </p>
        <div className="fila">
          <Campo label="Nombre"><input value={f.negocio.nombre} onChange={(e) => setNegocio("nombre", e.target.value)} /></Campo>
          <Campo label="Rubro"><input value={f.negocio.rubro} onChange={(e) => setNegocio("rubro", e.target.value)} placeholder="Ej: Ferretería y sanitarios" /></Campo>
        </div>
        <div className="fila">
          <Campo label="Teléfono"><input value={f.negocio.telefono} onChange={(e) => setNegocio("telefono", e.target.value)} /></Campo>
          <Campo label="Instagram"><input value={f.negocio.instagram} onChange={(e) => setNegocio("instagram", e.target.value)} /></Campo>
        </div>

        <h3 style={{ fontSize: 14, marginBottom: 4 }}>¿Cómo le decís a lo que vendés?</h3>
        <p className="mut" style={{ marginTop: 0 }}>Cambia el nombre de la sección y los textos de toda la app.</p>
        <div className="fila">
          <Campo label="En singular"><input value={f.vocabulario.producto_singular} onChange={(e) => setVocab("producto_singular", e.target.value)} placeholder="Herramienta / Artículo / Producto" /></Campo>
          <Campo label="En plural"><input value={f.vocabulario.producto_plural} onChange={(e) => setVocab("producto_plural", e.target.value)} placeholder="Herramientas / Artículos / Productos" /></Campo>
        </div>

        <h3 style={{ fontSize: 14, marginBottom: 4 }}>Módulos</h3>
        <p className="mut" style={{ marginTop: 0 }}>
          Prendé solo lo que usa este negocio. Lo que apagues desaparece del menú — los datos no se borran.
        </p>
        <div className="lista-tarjetas">
          {MODULOS.map((m) => (
            <label className="tarjeta-fila modulo-fila" key={m}>
              <input type="checkbox" checked={f.modulos[m]} onChange={() => toggle(m)} />
              <span>
                <span className="tf-titulo" style={{ marginBottom: 2 }}>{INFO_MODULOS[m].titulo}</span>
                <span className="mut">{INFO_MODULOS[m].detalle}</span>
              </span>
            </label>
          ))}
        </div>

        <button className="btn primario" style={{ marginTop: 12 }} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}

function CambiarPassword({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");

  async function cambiarPass(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      await api.post("/api/auth/password", { actual, nueva });
      setActual(""); setNueva("");
      onOk("Contraseña actualizada.");
    } catch (err: any) { onError(err.message); }
  }

  return (
    <div className="card">
      <h2>Seguridad</h2>
      <div className="card-body">
        <form onSubmit={cambiarPass} style={{ maxWidth: 340 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>Cambiar mi contraseña</h3>
          <Campo label="Contraseña actual"><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} /></Campo>
          <Campo label="Contraseña nueva"><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} /></Campo>
          <button className="btn primario">Cambiar contraseña</button>
        </form>
      </div>
    </div>
  );
}

function GestionUsuarios({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const { data, recargar } = useCarga<any>(() => api.get("/api/auth/usuarios"), []);
  const [nuevoUsuario, setNuevoUsuario] = useState("");
  const [nuevoPass, setNuevoPass] = useState("");
  const [nuevoRol, setNuevoRol] = useState<"dueño" | "empleado">("empleado");

  async function agregarUsuario(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      await api.post("/api/auth/usuarios", { usuario: nuevoUsuario, password: nuevoPass, rol: nuevoRol });
      setNuevoUsuario(""); setNuevoPass(""); setNuevoRol("empleado");
      onOk("Usuario creado.");
      recargar();
    } catch (err: any) { onError(err.message); }
  }

  return (
    <div className="card">
      <h2>Usuarios</h2>
      <div className="card-body">
        <p className="mut">Un <b>empleado</b> puede cargar ventas, pagos y stock, pero no ve costos ni rentabilidad, y no puede exportar el Excel general ni tocar el respaldo.</p>

        {data?.usuarios?.length > 0 && (
          <table className="tabla" style={{ marginBottom: 16 }}>
            <thead><tr><th>Usuario</th><th>Rol</th><th>Desde</th></tr></thead>
            <tbody>
              {data.usuarios.map((u: any) => (
                <tr key={u.id}><td>{u.usuario}</td><td>{u.rol}</td><td className="num">{fecha(u.creado_en?.slice(0, 10))}</td></tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={agregarUsuario} style={{ maxWidth: 340 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>Agregar usuario</h3>
          <Campo label="Usuario"><input value={nuevoUsuario} onChange={(e) => setNuevoUsuario(e.target.value)} /></Campo>
          <Campo label="Contraseña"><input type="password" value={nuevoPass} onChange={(e) => setNuevoPass(e.target.value)} /></Campo>
          <Campo label="Rol">
            <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value as any)}>
              <option value="empleado">Empleado (sin costos)</option>
              <option value="dueño">Dueño (ve todo)</option>
            </select>
          </Campo>
          <button className="btn primario">Crear usuario</button>
        </form>
      </div>
    </div>
  );
}
