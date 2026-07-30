import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "./api";
import { useRuta, navegar } from "./lib/router";
import { Auth } from "./pages/Auth";
import { Panel } from "./pages/Panel";
import { Herramientas } from "./pages/Herramientas";
import { ProductoFicha } from "./pages/ProductoFicha";
import { Clientes } from "./pages/Clientes";
import { ClienteFicha } from "./pages/ClienteFicha";
import { Ventas } from "./pages/Ventas";
import { NuevaVenta } from "./pages/NuevaVenta";
import { MapaClientes } from "./pages/MapaClientes";
import { VentaRapida } from "./pages/VentaRapida";
import { Pendientes } from "./pages/Pendientes";
import { useEsMovil } from "./lib/pantalla";
import { Presupuestos } from "./pages/Presupuestos";
import { NuevoPresupuesto } from "./pages/NuevoPresupuesto";
import { PresupuestoDetalle } from "./pages/PresupuestoDetalle";
import { Pagos } from "./pages/Pagos";
import { Cobranzas } from "./pages/Cobranzas";
import { Produccion } from "./pages/Produccion";
import { Reportes } from "./pages/Reportes";
import { Ajustes } from "./pages/Ajustes";
import { Auditoria } from "./pages/Auditoria";
import type { Rol } from "./lib/rol";
import { RolContext } from "./lib/rol";
import { SyncIndicator } from "./components/SyncIndicator";
import { BuscadorGlobal } from "./components/BuscadorGlobal";
import { iniciarSync } from "./offline/sync";
import { guardarSesionCacheada, leerSesionCacheada, borrarSesionCacheada } from "./offline/cache";
import { leerTema, aplicarTema, siguienteTema, type Tema } from "./lib/tema";

const ICONO_TEMA: Record<Tema, string> = { claro: "☀️", oscuro: "🌙", auto: "🖥️" };
const LABEL_TEMA: Record<Tema, string> = { claro: "Claro", oscuro: "Oscuro", auto: "Automático" };

interface Estado {
  needsSetup: boolean;
  authenticated: boolean;
  usuario: string | null;
  rol: Rol | null;
}

const NAV = [
  ["/panel", "Panel"],
  ["/herramientas", "Herramientas"],
  ["/clientes", "Clientes"],
  ["/mapa-clientes", "Mapa"],
  ["/ventas", "Ventas"],
  ["/pendientes", "Pendientes"],
  ["/presupuestos", "Presupuestos"],
  ["/pagos", "Pagos"],
  ["/cobranzas", "Cobranzas"],
  ["/produccion", "Producción"],
  ["/reportes", "Reportes"],
  ["/ajustes", "Ajustes"],
] as const;

export function App() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [tema, setTema] = useState<Tema>(() => leerTema());
  const ruta = useRuta();

  function cambiarTema() {
    const t = siguienteTema(tema);
    aplicarTema(t);
    setTema(t);
  }

  useEffect(() => {
    setMenuAbierto(false);
  }, [ruta.path]);

  const cargarEstado = useCallback(() => {
    api
      .get<Estado>("/api/auth/status")
      .then((data) => {
        setEstado(data);
        if (data.authenticated && data.usuario && data.rol) void guardarSesionCacheada({ usuario: data.usuario, rol: data.rol });
        else void borrarSesionCacheada();
      })
      .catch(async (err) => {
        if (err instanceof ApiError) {
          // El servidor respondió: la sesión realmente no es válida (401).
          await borrarSesionCacheada();
          setEstado({ needsSetup: false, authenticated: false, usuario: null, rol: null });
          return;
        }
        // Sin red: no podemos confirmar la cookie contra el servidor. Si
        // hay una sesión conocida de la última vez que sí hubo señal,
        // entramos igual — apenas vuelva la conexión se revalida sola.
        const cache = await leerSesionCacheada();
        setEstado(
          cache
            ? { needsSetup: false, authenticated: true, usuario: cache.usuario, rol: cache.rol }
            : { needsSetup: false, authenticated: false, usuario: null, rol: null }
        );
      });
  }, []);

  useEffect(() => {
    cargarEstado();
    const onNoAuth = () => setEstado((e) => (e ? { ...e, authenticated: false } : e));
    window.addEventListener("no-autenticado", onNoAuth);
    window.addEventListener("online", cargarEstado);
    return () => {
      window.removeEventListener("no-autenticado", onNoAuth);
      window.removeEventListener("online", cargarEstado);
    };
  }, [cargarEstado]);

  useEffect(() => {
    if (estado?.authenticated) iniciarSync();
  }, [estado?.authenticated]);

  async function salir() {
    await api.post("/api/auth/logout").catch(() => {});
    setEstado((e) => (e ? { ...e, authenticated: false } : e));
  }

  if (!estado) return <div className="spinner">Cargando…</div>;

  if (estado.needsSetup || !estado.authenticated) {
    return <Auth needsSetup={estado.needsSetup} onListo={cargarEstado} />;
  }

  const base = "/" + (ruta.parts[0] ?? "panel");
  const nav = estado.rol === "dueño" ? [...NAV, ["/auditoria", "Auditoría"] as const] : NAV;

  return (
    <div className="app">
      <header className="topbar-movil">
        <button
          className="menu-toggle"
          aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setMenuAbierto((v) => !v)}
        >
          {menuAbierto ? "✕" : "☰"}
        </button>
        <div className="marca">🔧 Control de Stock</div>
        <SyncIndicator />
      </header>

      {menuAbierto && <div className="menu-fondo" onClick={() => setMenuAbierto(false)} />}

      <aside className={`sidebar ${menuAbierto ? "abierta" : ""}`}>
        <div className="sidebar-marca">🔧 Control de Stock</div>
        <BuscadorGlobal />
        <nav>
          {nav.map(([path, label]) => (
            <a key={path} href={`#${path}`} className={base === path ? "activo" : ""}>
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-pie">
          <div className="solo-escritorio"><SyncIndicator /></div>
          <button className="btn-tema" onClick={cambiarTema} title="Cambiar tema">
            {ICONO_TEMA[tema]} Tema: {LABEL_TEMA[tema]}
          </button>
          <div className="usuario">
            {estado.usuario}
            <button onClick={salir}>Salir</button>
          </div>
        </div>
      </aside>

      <main className="contenido">
        <RolContext.Provider value={estado.rol ?? "dueño"}>
          <Vista ruta={ruta} />
        </RolContext.Provider>
      </main>
    </div>
  );
}

function Vista({ ruta }: { ruta: ReturnType<typeof useRuta> }) {
  const [seccion, id, sub] = ruta.parts;
  const esMovil = useEsMovil();
  switch (seccion) {
    case undefined:
    case "panel":
      return <Panel />;
    case "herramientas":
      return (id && id !== "null") ? <ProductoFicha id={id} /> : <Herramientas />;
    case "clientes":
      return id ? <ClienteFicha id={id} /> : <Clientes />;
    case "mapa-clientes":
      return <MapaClientes />;
    case "ventas":
      return id === "nueva" ? (esMovil ? <VentaRapida /> : <NuevaVenta />) : <Ventas />;
    case "pendientes":
      return <Pendientes />;
    case "presupuestos":
      return id === "nuevo" ? <NuevoPresupuesto /> : id ? <PresupuestoDetalle id={Number(id)} /> : <Presupuestos />;
    case "pagos":
      return <Pagos />;
    case "cobranzas":
      return <Cobranzas />;
    case "produccion":
      return <Produccion />;
    case "reportes":
      return <Reportes />;
    case "ajustes":
      return <Ajustes />;
    case "auditoria":
      return <Auditoria />;
    default:
      void sub;
      navegar("/panel");
      return null;
  }
}
