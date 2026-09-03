import { useState } from "react";
import { api } from "../api";
import { Campo, Error } from "../components/ui";

const FEATURES = [
  "Funciona aunque no haya señal",
  "Cuenta corriente y cobranzas al día",
  "Un sistema, todos tus negocios",
];

interface OpcionNegocio {
  id: string; // id real del negocio, o "proveedor" si es la cuenta del sistema
  nombre: string;
}

/** Pantalla de acceso. Si needsSetup, crea el primer usuario. */
export function Auth({ needsSetup, onListo }: { needsSetup: boolean; onListo: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  // Rarísimo: el mismo usuario y contraseña existen en más de un negocio.
  const [opciones, setOpciones] = useState<OpcionNegocio[] | null>(null);

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
        const r = await api.post<{ ok?: true; eligeNegocio?: true; opciones?: OpcionNegocio[] }>(
          "/api/auth/login",
          { usuario, password }
        );
        if (r.eligeNegocio) {
          setOpciones(r.opciones ?? []);
          setCargando(false);
          return;
        }
      }
      onListo();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function elegirNegocio(negocioId: string) {
    setError(null);
    setCargando(true);
    try {
      await api.post("/api/auth/login", { usuario, password, negocio_id: negocioId });
      onListo();
    } catch (err: any) {
      setError(err.message);
      setOpciones(null);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="auth-screen">
      <aside className="auth-brand" aria-hidden="true">
        <div className="auth-brand-glow" />
        <div className="auth-brand-content">
          <div className="auth-badge">🔧</div>
          <h1>Stockeate</h1>
          <p>Vendé, cobrá y controlá tu stock — todo en un solo lugar.</p>
          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f}><span className="auth-check">✓</span>{f}</li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="auth-form-side">
        {opciones ? (
          <div className="auth-card">
            <div className="auth-badge auth-badge-movil">🔧</div>
            <h2>¿Cuál de tus negocios?</h2>
            <p className="auth-sub">Tenés cuenta en más de uno con los mismos datos.</p>
            <Error msg={error} />
            <div className="auth-opciones">
              {opciones.map((o) => (
                <button key={o.id} type="button" className="auth-opcion" disabled={cargando} onClick={() => elegirNegocio(o.id)}>
                  {o.nombre}
                </button>
              ))}
            </div>
            <button type="button" className="link-discreto" style={{ marginTop: 16 }} onClick={() => setOpciones(null)}>
              Volver
            </button>
          </div>
        ) : (
          <form className="auth-card" onSubmit={enviar}>
            <div className="auth-badge auth-badge-movil">🔧</div>
            <h2>{needsSetup ? "Creá tu cuenta" : "Bienvenido de nuevo"}</h2>
            <p className="auth-sub">
              {needsSetup ? "Es sólo esta vez: creá el primer usuario y tu negocio queda listo." : "Ingresá con tu usuario y contraseña."}
            </p>
            <Error msg={error} />

            {needsSetup && (
              <Campo label="Nombre del negocio">
                <input
                  value={nombreNegocio}
                  onChange={(e) => setNombreNegocio(e.target.value)}
                  placeholder="Ej: Ferretería El Tornillo"
                  autoFocus
                />
              </Campo>
            )}

            <Campo label="Usuario">
              <input
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                autoFocus={needsSetup}
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

            <button className="btn primario auth-submit" disabled={cargando}>
              {cargando ? <span className="auth-spinner" /> : null}
              {cargando ? "Ingresando…" : needsSetup ? "Crear usuario" : "Ingresar"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
