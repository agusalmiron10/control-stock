import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { hoyISO, fecha } from "../format";
import { Campo, Error, Confirmar, Modal, useCarga } from "../components/ui";
import { exportarGeneral } from "../excel";
import { useRol, esDueno } from "../lib/rol";
import { useConfig, useModulo, MODULOS, INFO_MODULOS, type ConfigNegocio, type Modulo } from "../lib/config";

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
          <FacturacionElectronicaPanel onOk={setAviso} onError={setError} />
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

      <MiFoto onOk={setAviso} onError={setError} />
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

const CONDICIONES_IVA = [
  { id: "responsable_inscripto", label: "Responsable Inscripto" },
  { id: "monotributo", label: "Monotributista" },
  { id: "exento", label: "Exento" },
] as const;

interface ConfigFiscal {
  configurado: boolean;
  activo?: boolean;
  cuit?: string | null;
  razon_social?: string | null;
  condicion_iva?: string | null;
  punto_venta?: number | null;
  ambiente?: "homologacion" | "produccion";
  iva_porcentaje_defecto?: number;
  tiene_certificado?: boolean;
  cert_subido_en?: string | null;
}

/**
 * Facturación electrónica con ARCA: cada negocio carga su propio CUIT,
 * condición de IVA, punto de venta y certificado digital. Sin esto activado
 * no se puede emitir ninguna factura con CAE.
 */
function FacturacionElectronicaPanel({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const tieneModulo = useModulo("facturacion_electronica");
  const { data, recargar } = useCarga<ConfigFiscal>(() => api.get("/api/facturacion/config"), [tieneModulo]);
  const [f, setF] = useState({
    cuit: "", razon_social: "", condicion_iva: "responsable_inscripto",
    punto_venta: "1", ambiente: "homologacion" as "homologacion" | "produccion", iva_porcentaje_defecto: "2100",
  });
  const [tocado, setTocado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState<string | null>(null);
  const crtRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const [crtTexto, setCrtTexto] = useState<string | null>(null);
  const [keyTexto, setKeyTexto] = useState<string | null>(null);

  useEffect(() => {
    if (data?.configurado && !tocado) {
      setF({
        cuit: data.cuit ?? "",
        razon_social: data.razon_social ?? "",
        condicion_iva: data.condicion_iva ?? "responsable_inscripto",
        punto_venta: String(data.punto_venta ?? "1"),
        ambiente: data.ambiente ?? "homologacion",
        iva_porcentaje_defecto: String(data.iva_porcentaje_defecto ?? 2100),
      });
    }
  }, [data, tocado]);

  if (!tieneModulo) return null;

  const set = (k: keyof typeof f, v: string) => { setTocado(true); setF((x) => ({ ...x, [k]: v })); };

  async function guardarDatos(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    setGuardando(true);
    try {
      await api.put("/api/facturacion/config", {
        cuit: f.cuit.replace(/\D/g, ""),
        razon_social: f.razon_social,
        condicion_iva: f.condicion_iva,
        punto_venta: Number(f.punto_venta),
        ambiente: f.ambiente,
        iva_porcentaje_defecto: Number(f.iva_porcentaje_defecto),
      });
      onOk("Datos fiscales guardados.");
      setTocado(false);
      recargar();
    } catch (err: any) { onError(err.message); } finally { setGuardando(false); }
  }

  function leerArchivo(setter: (texto: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => setter(String(reader.result));
      reader.readAsText(file);
    };
  }

  async function subirCertificado() {
    if (!crtTexto || !keyTexto) return;
    onError(null);
    try {
      await api.post("/api/facturacion/certificado", { cert: crtTexto, key: keyTexto });
      setCrtTexto(null);
      setKeyTexto(null);
      if (crtRef.current) crtRef.current.value = "";
      if (keyRef.current) keyRef.current.value = "";
      onOk("Certificado cargado.");
      recargar();
    } catch (err: any) { onError(err.message); }
  }

  async function alternarActivo() {
    onError(null);
    try {
      await api.post(data?.activo ? "/api/facturacion/desactivar" : "/api/facturacion/activar");
      onOk(data?.activo ? "Facturación electrónica desactivada." : "Facturación electrónica activada.");
      recargar();
    } catch (err: any) { onError(err.message); }
  }

  async function probarConexion() {
    onError(null);
    setResultadoPrueba(null);
    setProbando(true);
    try {
      await api.post("/api/facturacion/probar-conexion");
      setResultadoPrueba("✓ Conexión con ARCA exitosa.");
    } catch (err: any) {
      setResultadoPrueba(`✗ ${err.message}`);
    } finally {
      setProbando(false);
    }
  }

  return (
    <div className="card">
      <h2>Facturación electrónica (ARCA)</h2>
      <div className="card-body">
        <p className="mut" style={{ marginTop: 0 }}>
          Emitir Factura A/B/C con CAE real desde una venta. Necesitás el CUIT de este negocio y el
          certificado digital que se tramita en ARCA con la clave fiscal.
        </p>

        {data?.configurado && (
          <div className="tf-datos" style={{ marginBottom: 12 }}>
            <span className={`badge ${data.activo ? "pagada" : "anulada"}`}>{data.activo ? "Activa" : "Inactiva"}</span>
            <span className={`badge ${data.ambiente === "produccion" ? "impaga" : "parcial"}`}>
              Ambiente: {data.ambiente === "produccion" ? "PRODUCCIÓN — facturas reales" : "Modo prueba"}
            </span>
            {data.tiene_certificado && <span className="mut">Certificado cargado{data.cert_subido_en ? ` el ${data.cert_subido_en.slice(0, 10)}` : ""}</span>}
          </div>
        )}

        <form onSubmit={guardarDatos}>
          <div className="fila fila-fiscal">
            <Campo label="CUIT"><input value={f.cuit} onChange={(e) => set("cuit", e.target.value)} placeholder="20111111112" /></Campo>
            <Campo label="Razón social"><input value={f.razon_social} onChange={(e) => set("razon_social", e.target.value)} /></Campo>
          </div>
          <div className="fila fila-fiscal">
            <Campo label="Condición frente al IVA">
              <select value={f.condicion_iva} onChange={(e) => set("condicion_iva", e.target.value)}>
                {CONDICIONES_IVA.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Campo>
            <Campo label="Punto de venta"><input value={f.punto_venta} onChange={(e) => set("punto_venta", e.target.value)} /></Campo>
          </div>
          <div className="fila fila-fiscal">
            <Campo label="% IVA por defecto">
              <select value={f.iva_porcentaje_defecto} onChange={(e) => set("iva_porcentaje_defecto", e.target.value)}>
                <option value="0">0%</option>
                <option value="1050">10,5%</option>
                <option value="2100">21%</option>
                <option value="2700">27%</option>
              </select>
            </Campo>
            <Campo label="Ambiente">
              <select value={f.ambiente} onChange={(e) => set("ambiente", e.target.value)}>
                <option value="homologacion">Modo prueba — para practicar sin emitir nada real</option>
                <option value="produccion">Producción — factura de verdad</option>
              </select>
            </Campo>
          </div>
          {f.ambiente === "produccion" && (
            <p className="error-box">
              <b>Producción:</b> las facturas que emitas acá son reales y quedan registradas en ARCA.
              No se pueden borrar — un error se corrige con una nota de crédito. Practicá primero en
              modo prueba.
            </p>
          )}
          <button className="btn primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar datos fiscales"}</button>
        </form>

        <h3 style={{ fontSize: 14, marginTop: 20, marginBottom: 4 }}>Certificado digital</h3>
        <p className="mut" style={{ marginTop: 0 }}>
          Se tramita en ARCA con la clave fiscal del CUIT de este negocio. La clave privada se guarda cifrada — nadie la puede volver a leer, ni siquiera desde acá.
        </p>
        <div className="fila fila-fiscal">
          <div className="campo">
            <label>Certificado (.crt)</label>
            <input ref={crtRef} type="file" accept=".crt,.pem" onChange={leerArchivo(setCrtTexto)} />
          </div>
          <div className="campo">
            <label>Clave privada (.key)</label>
            <input ref={keyRef} type="file" accept=".key,.pem" onChange={leerArchivo(setKeyTexto)} />
          </div>
        </div>
        <button className="btn" disabled={!crtTexto || !keyTexto} onClick={subirCertificado}>Subir certificado</button>

        <div className="btn-grupo" style={{ marginTop: 20 }}>
          {data?.configurado && (
            <button className="btn" onClick={alternarActivo}>{data.activo ? "Desactivar" : "Activar"}</button>
          )}
          <button className="btn" disabled={probando || !data?.tiene_certificado} onClick={probarConexion}>
            {probando ? "Probando…" : "Probar conexión con ARCA"}
          </button>
        </div>
        {resultadoPrueba && (
          <p className={resultadoPrueba.startsWith("✓") ? "ok-box" : "error-box"} style={{ marginTop: 12 }}>{resultadoPrueba}</p>
        )}
      </div>
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
          Lo que tiene activo este negocio. Para prender o apagar algo, comunicate con tu proveedor.
        </p>
        <div className="lista-tarjetas">
          {MODULOS.filter((m) => f.modulos[m]).map((m) => (
            <div className="tarjeta-fila modulo-fila" key={m}>
              <span className="badge pagada" style={{ flex: "none", marginTop: 2 }}>✓</span>
              <span>
                <span className="tf-titulo" style={{ marginBottom: 2 }}>{INFO_MODULOS[m].titulo}</span>
                <span className="mut">{INFO_MODULOS[m].detalle}</span>
              </span>
            </div>
          ))}
          {MODULOS.every((m) => !f.modulos[m]) && (
            <p className="mut">Este negocio no tiene módulos opcionales activos todavía.</p>
          )}
        </div>

        <button className="btn primario" style={{ marginTop: 12 }} disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}

/**
 * Recorta al centro (cuadrado) y comprime una imagen para que entre cómoda
 * como avatar: no tiene sentido guardar una foto de cámara de varios MB para
 * un círculo de 40px.
 */
// 480px: suficiente para verla ampliada sin que se pixele, y aún así son unos
// pocos KB una vez comprimida a JPEG (el límite del endpoint es mucho mayor).
function recortarYComprimir(file: File, lado = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = lado;
      canvas.height = lado;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, lado, lado);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    // ojo: "Error" acá abajo es el componente importado de ui.tsx, no el
    // constructor nativo — por eso se rechaza con un objeto plano.
    img.onerror = () => { URL.revokeObjectURL(url); reject({ message: "No se pudo leer esa imagen." }); };
    img.src = url;
  });
}

/**
 * Foto de perfil: cada usuario sube y borra la suya propia. No depende del
 * dueño ni del proveedor — es lo único en Ajustes que ve un empleado sin
 * pedirle permiso a nadie.
 */
function MiFoto({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const { data, recargar } = useCarga<{ foto: string | null }>(() => api.get("/api/auth/status"), []);
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onError(null);
    setSubiendo(true);
    try {
      const foto = await recortarYComprimir(file);
      await api.put("/api/auth/foto", { foto });
      recargar();
      window.dispatchEvent(new CustomEvent("foto-cambiada"));
      onOk("Foto actualizada.");
    } catch (err: any) {
      onError(err.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function borrar() {
    onError(null);
    try {
      await api.del("/api/auth/foto");
      recargar();
      window.dispatchEvent(new CustomEvent("foto-cambiada"));
      onOk("Foto borrada.");
    } catch (err: any) {
      onError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Mi foto de perfil</h2>
      <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {data?.foto ? (
          <img src={data.foto} alt="Mi foto" className="avatar avatar-grande" />
        ) : (
          <div className="avatar avatar-grande avatar-vacio">📷</div>
        )}
        <div>
          <p className="mut" style={{ marginTop: 0 }}>La elegís vos — nadie más te la puede cambiar.</p>
          <div className="btn-grupo">
            <button type="button" className="btn" disabled={subiendo} onClick={() => fileRef.current?.click()}>
              {subiendo ? "Subiendo…" : data?.foto ? "Cambiar foto" : "Subir foto"}
            </button>
            {data?.foto && <button type="button" className="btn" onClick={borrar}>Quitar</button>}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={elegirArchivo} />
          </div>
        </div>
      </div>
    </div>
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

/**
 * Elige qué módulos puede usar un empleado. "Acceso a todo" es el default —
 * ve todo lo que el negocio tenga activo, incluso módulos que se activen
 * después. Recién si el dueño lo restringe explícitamente aparece la lista.
 */
function SelectorModulos({
  activos, valor, onChange,
}: { activos: Record<Modulo, boolean>; valor: Modulo[] | null; onChange: (v: Modulo[] | null) => void }) {
  const modulosActivos = MODULOS.filter((m) => activos[m]);
  const restringido = valor !== null;

  return (
    <div>
      <label className="tarjeta-fila modulo-fila">
        <input type="checkbox" checked={!restringido} onChange={(e) => onChange(e.target.checked ? null : modulosActivos)} />
        <span>
          <span className="tf-titulo" style={{ marginBottom: 2 }}>Acceso a todo</span>
          <span className="mut">Ve todos los módulos que el negocio tenga activos, incluso si activás uno nuevo después.</span>
        </span>
      </label>
      {restringido && (
        <div className="lista-tarjetas" style={{ marginLeft: 8, marginTop: 4 }}>
          {modulosActivos.length === 0 && <p className="mut">Este negocio no tiene módulos opcionales activos todavía.</p>}
          {modulosActivos.map((m) => (
            <label key={m} className="tarjeta-fila modulo-fila">
              <input
                type="checkbox"
                checked={valor!.includes(m)}
                onChange={() => onChange(valor!.includes(m) ? valor!.filter((x) => x !== m) : [...valor!, m])}
              />
              <span>
                <span className="tf-titulo" style={{ marginBottom: 2 }}>{INFO_MODULOS[m].titulo}</span>
                <span className="mut">{INFO_MODULOS[m].detalle}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Resumen corto para la tabla: "Todo" o "3 de 9 módulos". */
function resumenModulos(u: any, cantidadActivos: number): string {
  if (u.rol !== "empleado") return "—";
  if (u.modulos_permitidos == null) return "Todo";
  return `${u.modulos_permitidos.length} de ${cantidadActivos}`;
}

function GestionUsuarios({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const cfg = useConfig();
  const { data, recargar } = useCarga<any>(() => api.get("/api/auth/usuarios"), []);
  const [nuevoUsuario, setNuevoUsuario] = useState("");
  const [nuevoPass, setNuevoPass] = useState("");
  const [nuevoRol, setNuevoRol] = useState<"dueño" | "empleado">("empleado");
  const [nuevoModulos, setNuevoModulos] = useState<Modulo[] | null>(null);
  const [editando, setEditando] = useState<{ id: number; usuario: string; modulos: Modulo[] | null } | null>(null);

  const cantidadActivos = MODULOS.filter((m) => cfg.modulos[m]).length;

  async function agregarUsuario(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      await api.post("/api/auth/usuarios", {
        usuario: nuevoUsuario, password: nuevoPass, rol: nuevoRol,
        modulos_permitidos: nuevoRol === "empleado" ? nuevoModulos : null,
      });
      setNuevoUsuario(""); setNuevoPass(""); setNuevoRol("empleado"); setNuevoModulos(null);
      onOk("Usuario creado.");
      recargar();
    } catch (err: any) { onError(err.message); }
  }

  async function guardarModulos() {
    if (!editando) return;
    onError(null);
    try {
      await api.put(`/api/auth/usuarios/${editando.id}/modulos`, { modulos_permitidos: editando.modulos });
      onOk(`Permisos de ${editando.usuario} actualizados.`);
      setEditando(null);
      recargar();
    } catch (err: any) { onError(err.message); }
  }

  return (
    <div className="card">
      <h2>Usuarios</h2>
      <div className="card-body">
        <p className="mut">
          Un <b>empleado</b> no ve costos ni rentabilidad, y no puede exportar el Excel general ni tocar el respaldo.
          Además, podés elegir a qué módulos tiene acceso cada uno.
        </p>

        {data?.usuarios?.length > 0 && (
          <div className="tabla-wrap" style={{ marginBottom: 16 }}>
            <table className="tabla">
              <thead><tr><th></th><th>Usuario</th><th>Rol</th><th>Módulos</th><th>Desde</th><th></th></tr></thead>
              <tbody>
                {data.usuarios.map((u: any) => (
                  <tr key={u.id}>
                    <td>{u.foto ? <img src={u.foto} alt="" className="avatar avatar-chica" /> : <div className="avatar avatar-chica avatar-vacio" style={{ fontSize: 14 }}>👤</div>}</td>
                    <td>{u.usuario}</td>
                    <td>{u.rol}</td>
                    <td>{resumenModulos(u, cantidadActivos)}</td>
                    <td className="num">{fecha(u.creado_en?.slice(0, 10))}</td>
                    <td className="acc">
                      {u.rol === "empleado" && (
                        <button className="btn chico" onClick={() => setEditando({ id: u.id, usuario: u.usuario, modulos: u.modulos_permitidos })}>
                          Editar módulos
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={agregarUsuario} style={{ maxWidth: 420 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>Agregar usuario</h3>
          <Campo label="Usuario"><input value={nuevoUsuario} onChange={(e) => setNuevoUsuario(e.target.value)} /></Campo>
          <Campo label="Contraseña"><input type="password" value={nuevoPass} onChange={(e) => setNuevoPass(e.target.value)} /></Campo>
          <Campo label="Rol">
            <select value={nuevoRol} onChange={(e) => { setNuevoRol(e.target.value as any); setNuevoModulos(null); }}>
              <option value="empleado">Empleado (sin costos)</option>
              <option value="dueño">Dueño (ve todo)</option>
            </select>
          </Campo>
          {nuevoRol === "empleado" && (
            <div style={{ marginBottom: 12 }}>
              <SelectorModulos activos={cfg.modulos} valor={nuevoModulos} onChange={setNuevoModulos} />
            </div>
          )}
          <button className="btn primario">Crear usuario</button>
        </form>
      </div>

      {editando && (
        <Modal titulo={`Módulos de ${editando.usuario}`} onCerrar={() => setEditando(null)}>
          <SelectorModulos
            activos={cfg.modulos}
            valor={editando.modulos}
            onChange={(v) => setEditando({ ...editando, modulos: v })}
          />
          <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn primario" onClick={guardarModulos}>Guardar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
