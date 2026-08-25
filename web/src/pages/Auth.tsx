import { useState } from "react";
import { api } from "../api";
import { Campo, Error } from "../components/ui";

/**
 * El código del negocio lo escribe una vez cada empleado y no lo piensa más.
 * Va en localStorage y no en la cookie a propósito: es una comodidad del
 * navegador, no una credencial — sin usuario y contraseña no sirve de nada.
 */
const CLAVE_NEGOCIO = "control-stock:negocio";

export function negocioRecordado(): string {
  try {
    return localStorage.getItem(CLAVE_NEGOCIO) ?? "";
  } catch {
    return "";
  }
}

/** Pantalla de acceso. Si needsSetup, crea el primer usuario. */
export function Auth({ needsSetup, onListo }: { needsSetup: boolean; onListo: () => void }) {
  const [negocio, setNegocio] = useState(negocioRecordado);
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // El proveedor del sistema entra sin código de negocio: no tiene uno.
  const [modoProveedor, setModoProveedor] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== password2) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setCargando(true);
    try {
      if (needsSetup) {
        await api.post("/api/auth/setup", { usuario, password, negocio: nombreNegocio });
      } else {
        const codigo = modoProveedor ? "" : negocio.trim().toLowerCase();
        await api.post("/api/auth/login", { usuario, password, negocio: codigo });
        try {
          if (codigo) localStorage.setItem(CLAVE_NEGOCIO, codigo);
        } catch {
          // Navegador con almacenamiento bloqueado: se escribe el código cada vez.
        }
      }
      onListo();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="login-card" onSubmit={enviar}>
        <h1>Control de Stock</h1>
        <p className="sub">
          {needsSetup
            ? "Creá tu usuario para empezar."
            : modoProveedor
              ? "Acceso del proveedor del sistema."
              : "Ingresá con tu usuario y contraseña."}
        </p>
        <Error msg={error} />

        {needsSetup && (
          <Campo label="Nombre del negocio">
            <input
              value={nombreNegocio}
              onChange={(e) => setNombreNegocio(e.target.value)}
              placeholder="Ej: Ferretería El Tornillo"
            />
          </Campo>
        )}

        {!needsSetup && !modoProveedor && (
          <Campo label="Negocio">
            <input
              value={negocio}
              onChange={(e) => setNegocio(e.target.value)}
              placeholder="el-codigo-de-tu-negocio"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus={!negocio}
            />
          </Campo>
        )}

        <Campo label="Usuario">
          <input
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            autoFocus={needsSetup || modoProveedor || !!negocio}
            autoComplete="username"
          />
        </Campo>
        <Campo label="Contraseña">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? "new-password" : "current-password"}
          />
        </Campo>
        {needsSetup && (
          <Campo label="Repetir contraseña">
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </Campo>
        )}

        <button className="btn primario" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} disabled={cargando}>
          {cargando ? "Ingresando…" : needsSetup ? "Crear usuario" : "Ingresar"}
        </button>

        {!needsSetup && (
          <button
            type="button"
            className="link-discreto"
            onClick={() => { setModoProveedor((v) => !v); setError(null); }}
          >
            {modoProveedor ? "Volver al acceso normal" : "Soy el proveedor del sistema"}
          </button>
        )}
      </form>
    </div>
  );
}
