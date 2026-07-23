import { useEffect, useState, useCallback } from "react";
import { api } from "./api";
import { useRuta, navegar } from "./lib/router";
import { Auth } from "./pages/Auth";
import { Panel } from "./pages/Panel";
import { Herramientas } from "./pages/Herramientas";
import { ProductoFicha } from "./pages/ProductoFicha";
import { Clientes } from "./pages/Clientes";
import { ClienteFicha } from "./pages/ClienteFicha";
import { Ventas } from "./pages/Ventas";
import { NuevaVenta } from "./pages/NuevaVenta";
import { Pagos } from "./pages/Pagos";
import { Cobranzas } from "./pages/Cobranzas";
import { Reportes } from "./pages/Reportes";
import { Ajustes } from "./pages/Ajustes";

interface Estado {
  needsSetup: boolean;
  authenticated: boolean;
  usuario: string | null;
}

const NAV = [
  ["/panel", "Panel"],
  ["/herramientas", "Herramientas"],
  ["/clientes", "Clientes"],
  ["/ventas", "Ventas"],
  ["/pagos", "Pagos"],
  ["/cobranzas", "Cobranzas"],
  ["/reportes", "Reportes"],
  ["/ajustes", "Ajustes"],
] as const;

export function App() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const ruta = useRuta();

  useEffect(() => {
    setMenuAbierto(false);
  }, [ruta.path]);

  const cargarEstado = useCallback(() => {
    api
      .get<Estado>("/api/auth/status")
      .then(setEstado)
      .catch(() => setEstado({ needsSetup: false, authenticated: false, usuario: null }));
  }, []);

  useEffect(() => {
    cargarEstado();
    const onNoAuth = () => setEstado((e) => (e ? { ...e, authenticated: false } : e));
    window.addEventListener("no-autenticado", onNoAuth);
    return () => window.removeEventListener("no-autenticado", onNoAuth);
  }, [cargarEstado]);

  async function salir() {
    await api.post("/api/auth/logout").catch(() => {});
    setEstado((e) => (e ? { ...e, authenticated: false } : e));
  }

  if (!estado) return <div className="spinner">Cargando…</div>;

  if (estado.needsSetup || !estado.authenticated) {
    return <Auth needsSetup={estado.needsSetup} onListo={cargarEstado} />;
  }

  const base = "/" + (ruta.parts[0] ?? "panel");

  return (
    <div className="app">
      <header className="topbar">
        <div className="marca">🔧 Control de Stock</div>
        <button
          className="menu-toggle"
          aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setMenuAbierto((v) => !v)}
        >
          {menuAbierto ? "✕" : "☰"}
        </button>
        <nav className={menuAbierto ? "abierta" : ""}>
          {NAV.map(([path, label]) => (
            <a key={path} href={`#${path}`} className={base === path ? "activo" : ""}>
              {label}
            </a>
          ))}
          <a className="nav-salir-movil" onClick={salir}>Salir ({estado.usuario})</a>
        </nav>
        <div className="usuario">
          {estado.usuario}
          <button onClick={salir}>Salir</button>
        </div>
      </header>
      {menuAbierto && <div className="menu-fondo" onClick={() => setMenuAbierto(false)} />}
      <main className="contenido">
        <Vista ruta={ruta} />
      </main>
    </div>
  );
}

function Vista({ ruta }: { ruta: ReturnType<typeof useRuta> }) {
  const [seccion, id, sub] = ruta.parts;
  switch (seccion) {
    case undefined:
    case "panel":
      return <Panel />;
    case "herramientas":
      return id ? <ProductoFicha id={Number(id)} /> : <Herramientas />;
    case "clientes":
      return id ? <ClienteFicha id={Number(id)} /> : <Clientes />;
    case "ventas":
      return id === "nueva" ? <NuevaVenta /> : <Ventas />;
    case "pagos":
      return <Pagos />;
    case "cobranzas":
      return <Cobranzas />;
    case "reportes":
      return <Reportes />;
    case "ajustes":
      return <Ajustes />;
    default:
      void sub;
      navegar("/panel");
      return null;
  }
}
