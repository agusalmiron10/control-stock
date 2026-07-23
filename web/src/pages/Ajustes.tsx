import { useRef, useState } from "react";
import { api } from "../api";
import { hoyISO } from "../format";
import { Campo, Error, Confirmar } from "../components/ui";
import { exportarGeneral } from "../excel";

export function Ajustes() {
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
          </p>
        </div>
      </div>

      <Seguridad onOk={setAviso} onError={setError} />

      {restaurarData && (
        <Confirmar
          mensaje="Restaurar el respaldo REEMPLAZA todos los datos actuales (clientes, ventas, pagos, stock). ¿Seguro?"
          textoConfirmar="Restaurar y reemplazar" peligro onSi={restaurar} onNo={() => setRestaurarData(null)} />
      )}
    </div>
  );
}

function Seguridad({ onOk, onError }: { onOk: (m: string) => void; onError: (m: string | null) => void }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [nuevoUsuario, setNuevoUsuario] = useState("");
  const [nuevoPass, setNuevoPass] = useState("");

  async function cambiarPass(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      await api.post("/api/auth/password", { actual, nueva });
      setActual(""); setNueva("");
      onOk("Contraseña actualizada.");
    } catch (err: any) { onError(err.message); }
  }
  async function agregarUsuario(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    try {
      await api.post("/api/auth/usuarios", { usuario: nuevoUsuario, password: nuevoPass });
      setNuevoUsuario(""); setNuevoPass("");
      onOk("Usuario creado.");
    } catch (err: any) { onError(err.message); }
  }

  return (
    <div className="card">
      <h2>Seguridad</h2>
      <div className="card-body">
        <div className="fila" style={{ alignItems: "flex-start" }}>
          <form onSubmit={cambiarPass} style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, marginTop: 0 }}>Cambiar mi contraseña</h3>
            <Campo label="Contraseña actual"><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} /></Campo>
            <Campo label="Contraseña nueva"><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} /></Campo>
            <button className="btn primario">Cambiar contraseña</button>
          </form>
          <form onSubmit={agregarUsuario} style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, marginTop: 0 }}>Agregar otro usuario</h3>
            <Campo label="Usuario"><input value={nuevoUsuario} onChange={(e) => setNuevoUsuario(e.target.value)} /></Campo>
            <Campo label="Contraseña"><input type="password" value={nuevoPass} onChange={(e) => setNuevoPass(e.target.value)} /></Campo>
            <button className="btn primario">Crear usuario</button>
          </form>
        </div>
      </div>
    </div>
  );
}
