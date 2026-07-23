import { useState } from "react";
import { api } from "../api";
import { Campo, Error } from "../components/ui";

/** Pantalla de acceso. Si needsSetup, crea el primer usuario. */
export function Auth({ needsSetup, onListo }: { needsSetup: boolean; onListo: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

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
        await api.post("/api/auth/setup", { usuario, password });
      } else {
        await api.post("/api/auth/login", { usuario, password });
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
          {needsSetup ? "Creá tu usuario para empezar." : "Ingresá con tu usuario y contraseña."}
        </p>
        <Error msg={error} />
        <Campo label="Usuario">
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus autoComplete="username" />
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
      </form>
    </div>
  );
}
