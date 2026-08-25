import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "./api";
import { useRuta, navegar } from "./lib/router";
import { Auth } from "./pages/Auth";
import { Proveedor } from "./pages/Proveedor";
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
import { RolContext, esDueno } from "./lib/rol";
import { SyncIndicator } from "./components/SyncIndicator";
import { BuscadorGlobal } from "./components/BuscadorGlobal";
import { iniciarSync } from "./offline/sync";
import { guardarSesionCacheada, leerSesionCacheada, borrarSesionCacheada, asegurarCacheDelNegocio } from "./offline/cache";
import { leerTema, aplicarTema, siguienteTema, type Tema } from "./lib/tema";
import {
  ConfigContext, CONFIG_INICIAL, setConfig, type ConfigNegocio, type Modulo,
} from "./lib/config";

const ICONO_TEMA: Record<Tema, string> = { claro: "☀️", oscuro: "🌙", auto: "🖥️" };
const LABEL_TEMA: Record<Tema, string> = { claro: "Claro", oscuro: "Oscuro", auto: "Automático" };

interface Estado {
  needsSetup: boolean;
  authenticated: boolean;
  usuario: string | null;
  rol: Rol | null;
  /** El negocio de esta sesión. null = proveedor que todavía no entró a ninguno. */
  negocio: { id: string; nombre: string; codigo: string } | null;
}

/**
 * El menú se arma según los módulos activos de este negocio: una ferretería
 * no ve "Producción", un kiosko no ve "Presupuestos" ni "Cobranzas".
 */
function construirNav(cfg: ConfigNegocio, esDueno: boolean): [string, string][] {
  const nav: [string, string][] = [
    ["/panel", "Panel"],
    ["/herramientas", cfg.vocabulario.producto_plural],
    ["/clientes", "Clientes"],
    ["/mapa-clientes", "Mapa"],
    ["/ventas", "Ventas"],
  ];
  if (cfg.modulos.venta_rapida) nav.push(["/pendientes", "Pendientes"]);
  if (cfg.modulos.presupuestos) nav.push(["/presupuestos", "Presupuestos"]);
  nav.push(["/pagos", "Pagos"]);
  if (cfg.modulos.cuenta_corriente) nav.push(["/cobranzas", "Cobranzas"]);
  if (cfg.modulos.produccion) nav.push(["/produccion", "Producción"]);
  nav.push(["/reportes", "Reportes"], ["/ajustes", "Ajustes"]);
  if (esDueno && cfg.modulos.auditoria) nav.push(["/auditoria", "Auditoría"]);
  return nav;
}

/** Secciones que dependen de un módulo: si está apagado, la ruta no existe. */
const MODULO_DE_SECCION: Record<string, Modulo> = {
  pendientes: "venta_rapida",
  presupuestos: "presupuestos",
  cobranzas: "cuenta_corriente",
  produccion: "produccion",
  auditoria: "auditoria",
};

export function App() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [tema, setTema] = useState<Tema>(() => leerTema());
  const [cfg, setCfg] = useState<ConfigNegocio>(CONFIG_INICIAL);
  const ruta = useRuta();

  /** La config define el menú y el vocabulario, así que se recarga al guardar en Ajustes. */
  const cargarConfig = useCallback(() => {
    api
      .get<ConfigNegocio>("/api/config")
      .then((c) => {
        setConfig(c); // copia para el código que no es React (WhatsApp, PDFs)
        setCfg(c);
      })
      .catch(() => {});
  }, []);

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
        // Antes que nada: si cambió el negocio, la caché del anterior se tira.
        void asegurarCacheDelNegocio(data.negocio?.id ?? null);
        if (data.authenticated && data.usuario && data.rol) void guardarSesionCacheada({ usuario: data.usuario, rol: data.rol, negocio: data.negocio });
        else void borrarSesionCacheada();
      })
      .catch(async (err) => {
        if (err instanceof ApiError) {
          // El servidor respondió: la sesión realmente no es válida (401).
          await borrarSesionCacheada();
          setEstado({ needsSetup: false, authenticated: false, usuario: null, rol: null, negocio: null });
          return;
        }
        // Sin red: no podemos confirmar la cookie contra el servidor. Si
        // hay una sesión conocida de la última vez que sí hubo señal,
        // entramos igual — apenas vuelva la conexión se revalida sola.
        const cache = await leerSesionCacheada();
        setEstado(
          cache
            ? { needsSetup: false, authenticated: true, usuario: cache.usuario, rol: cache.rol, negocio: cache.negocio ?? null }
            : { needsSetup: false, authenticated: false, usuario: null, rol: null, negocio: null }
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

  // La config es POR NEGOCIO: hay que releerla cada vez que cambia, no sólo
  // al entrar. Si no, el proveedor que salta de un cliente a otro se queda
  // con el menú y el vocabulario del anterior.
  useEffect(() => {
    if (estado?.authenticated && estado.negocio) {
      iniciarSync();
      cargarConfig();
    }
  }, [estado?.authenticated, estado?.negocio?.id, cargarConfig]);

  useEffect(() => {
    const onCambio = () => cargarConfig();
    window.addEventListener("config-cambiada", onCambio);
    return () => window.removeEventListener("config-cambiada", onCambio);
  }, [cargarConfig]);

  async function salir() {
    await api.post("/api/auth/logout").catch(() => {});
    setEstado((e) => (e ? { ...e, authenticated: false } : e));
  }

  /** El proveedor vuelve a su cartera de clientes sin cerrar sesión. */
  async function volverAProveedor() {
    await api.post("/api/super/salir").catch(() => {});
    cargarEstado();
  }

  if (!estado) return <div className="spinner">Cargando…</div>;

  // Sin negocio no hay app: sólo el proveedor puede estar "adentro" sin uno,
  // y para él la pantalla es otra. Esto también atrapa las sesiones cacheadas
  // de antes del multi-negocio.
  const sinNegocio = estado.authenticated && !estado.negocio && estado.rol !== "super";

  if (estado.needsSetup || !estado.authenticated || sinNegocio) {
    return <Auth needsSetup={estado.needsSetup} onListo={cargarEstado} />;
  }

  // Proveedor del sistema que todavía no entró a ningún negocio: le mostramos
  // su cartera de clientes. La app de adentro no tendría qué datos mostrar.
  if (estado.rol === "super" && !estado.negocio) {
    return <Proveedor onEntrar={cargarEstado} />;
  }

  const base = "/" + (ruta.parts[0] ?? "panel");
  const nav = construirNav(cfg, esDueno(estado.rol ?? "dueño"));

  // Estoy mirando los datos de un cliente: tiene que quedar clarísimo, para
  // no confundir su negocio con el mío ni cargar algo en el lugar equivocado.
  const enSoporte = estado.rol === "super" && !!estado.negocio;

  return (
    <div className={`app ${enSoporte ? "modo-soporte" : ""}`}>
      {enSoporte && (
        <div className="barra-soporte">
          <span>Estás dentro de <strong>{estado.negocio!.nombre}</strong> como proveedor.</span>
          <button onClick={volverAProveedor}>Volver a mis clientes</button>
        </div>
      )}
      <header className="topbar-movil">
        <button
          className="menu-toggle"
          aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setMenuAbierto((v) => !v)}
        >
          {menuAbierto ? "✕" : "☰"}
        </button>
        <div className="marca">🔧 {cfg.negocio.nombre}</div>
        <SyncIndicator />
      </header>

      {menuAbierto && <div className="menu-fondo" onClick={() => setMenuAbierto(false)} />}

      <aside className={`sidebar ${menuAbierto ? "abierta" : ""}`}>
        <div className="sidebar-marca">🔧 {cfg.negocio.nombre}</div>
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
        <ConfigContext.Provider value={cfg}>
          <RolContext.Provider value={estado.rol ?? "dueño"}>
            <Vista ruta={ruta} cfg={cfg} />
          </RolContext.Provider>
        </ConfigContext.Provider>
      </main>
    </div>
  );
}

function Vista({ ruta, cfg }: { ruta: ReturnType<typeof useRuta>; cfg: ConfigNegocio }) {
  const [seccion, id, sub] = ruta.parts;
  const esMovil = useEsMovil();

  // Si alguien entra por URL a una sección de un módulo apagado, no existe.
  const moduloNecesario = seccion ? MODULO_DE_SECCION[seccion] : undefined;
  useEffect(() => {
    if (moduloNecesario && !cfg.modulos[moduloNecesario]) navegar("/panel");
  }, [moduloNecesario, cfg]);
  if (moduloNecesario && !cfg.modulos[moduloNecesario]) return null;

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
