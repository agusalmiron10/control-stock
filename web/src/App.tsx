import { useEffect, useState, useCallback, useRef } from "react";
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
import { Facturas } from "./pages/Facturas";
import { Compras } from "./pages/Compras";
import { Remitos } from "./pages/Remitos";
import { Proveedores } from "./pages/Proveedores";
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
import { RolContext, PermisosContext, esDueno } from "./lib/rol";
import { SyncIndicator } from "./components/SyncIndicator";
import { BuscadorGlobal } from "./components/BuscadorGlobal";
import { iniciarSync } from "./offline/sync";
import { guardarSesionCacheada, leerSesionCacheada, borrarSesionCacheada, asegurarCacheDelNegocio } from "./offline/cache";
import { leerTema, aplicarTema, siguienteTema, type Tema } from "./lib/tema";
import {
  ConfigContext, CONFIG_INICIAL, setConfig, moduloVisible, type ConfigNegocio, type Modulo,
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
  /** Módulos que el dueño le habilitó a este usuario. null = sin restricción. */
  modulosPermitidos: string[] | null;
  /** Foto de perfil de ESTA sesión — cada usuario sube y borra la suya propia. */
  foto: string | null;
}

/**
 * El menú se arma según los módulos activos de este negocio (una ferretería
 * no ve "Producción", un kiosko no ve "Presupuestos") Y según lo que el
 * dueño le haya habilitado a este usuario en particular.
 *
 * Va agrupado, no en una lista larga: con todos los módulos prendidos son 16
 * entradas, y nadie tiene un mapa mental de 16 cajones sueltos. Los grupos
 * siguen cómo se piensa el trabajo —lo de todos los días, los papeles, el
 * depósito, el negocio— y no cómo está armado el sistema por dentro.
 */
export interface GrupoNav {
  titulo: string;
  items: [string, string][];
}

function construirNav(cfg: ConfigNegocio, permisos: string[] | null, esDueno: boolean): GrupoNav[] {
  const puede = (m: Modulo) => moduloVisible(cfg.modulos[m], permisos, m);

  const diaADia: [string, string][] = [["/ventas", "Ventas"], ["/clientes", "Clientes"]];
  if (puede("venta_rapida")) diaADia.push(["/pendientes", "Pendientes"]);
  if (puede("cuenta_corriente")) diaADia.push(["/cobranzas", "Cobranzas"]);
  diaADia.push(["/pagos", "Pagos"]);

  const comprobantes: [string, string][] = [];
  if (puede("presupuestos")) comprobantes.push(["/presupuestos", "Presupuestos"]);
  if (puede("remitos")) comprobantes.push(["/remitos", "Remitos"]);
  if (puede("facturacion_electronica")) comprobantes.push(["/facturas", "Facturas"]);

  const deposito: [string, string][] = [["/herramientas", cfg.vocabulario.producto_plural]];
  if (puede("compras")) deposito.push(["/compras", "Compras"], ["/proveedores", "Proveedores"]);
  if (puede("produccion")) deposito.push(["/produccion", "Producción"]);

  const negocio: [string, string][] = [["/panel", "Panel"], ["/reportes", "Reportes"], ["/mapa-clientes", "Mapa"]];
  negocio.push(["/ajustes", "Ajustes"]);
  if (esDueno && puede("auditoria")) negocio.push(["/auditoria", "Auditoría"]);

  return [
    { titulo: "Día a día", items: diaADia },
    { titulo: "Comprobantes", items: comprobantes },
    { titulo: "Depósito", items: deposito },
    { titulo: "El negocio", items: negocio },
  ].filter((g) => g.items.length > 0);
}

/** Secciones que dependen de un módulo: si está apagado, la ruta no existe. */
const MODULO_DE_SECCION: Record<string, Modulo> = {
  pendientes: "venta_rapida",
  presupuestos: "presupuestos",
  cobranzas: "cuenta_corriente",
  produccion: "produccion",
  auditoria: "auditoria",
  facturas: "facturacion_electronica",
  remitos: "remitos",
  compras: "compras",
  proveedores: "compras",
};

export function App() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [tema, setTema] = useState<Tema>(() => leerTema());
  const [cfg, setCfg] = useState<ConfigNegocio>(CONFIG_INICIAL);
  const [fotoAmpliada, setFotoAmpliada] = useState(false);
  const ruta = useRuta();

  // Cerrar el visor de la foto con Escape, como cualquier ventana.
  useEffect(() => {
    if (!fotoAmpliada) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setFotoAmpliada(false); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [fotoAmpliada]);

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
        if (data.authenticated && data.usuario && data.rol) {
          void guardarSesionCacheada({ usuario: data.usuario, rol: data.rol, negocio: data.negocio, modulosPermitidos: data.modulosPermitidos, foto: data.foto });
        } else void borrarSesionCacheada();
      })
      .catch(async (err) => {
        if (err instanceof ApiError) {
          // El servidor respondió: la sesión realmente no es válida (401).
          await borrarSesionCacheada();
          setEstado({ needsSetup: false, authenticated: false, usuario: null, rol: null, negocio: null, modulosPermitidos: null, foto: null });
          return;
        }
        // Sin red: no podemos confirmar la cookie contra el servidor. Si
        // hay una sesión conocida de la última vez que sí hubo señal,
        // entramos igual — apenas vuelva la conexión se revalida sola.
        const cache = await leerSesionCacheada();
        setEstado(
          cache
            ? { needsSetup: false, authenticated: true, usuario: cache.usuario, rol: cache.rol, negocio: cache.negocio ?? null, modulosPermitidos: cache.modulosPermitidos ?? null, foto: cache.foto ?? null }
            : { needsSetup: false, authenticated: false, usuario: null, rol: null, negocio: null, modulosPermitidos: null, foto: null }
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

  // La foto es la única cosa acá que un empleado puede cambiar él mismo —
  // se refleja al toque en el sidebar, sin esperar a la próxima carga.
  useEffect(() => {
    const onFoto = () => cargarEstado();
    window.addEventListener("foto-cambiada", onFoto);
    return () => window.removeEventListener("foto-cambiada", onFoto);
  }, [cargarEstado]);

  // La barra de soporte va fija arriba (fuera del flujo), así que hay que
  // reservarle el alto exacto. Se mide en vivo en vez de hardcodearlo: cambia
  // si el texto se parte en dos líneas (celular) o si el nombre del negocio
  // es largo. Va acá arriba, antes de cualquier return: los hooks tienen que
  // ejecutarse siempre, y en el mismo orden, en todos los renders.
  const barraSoporte = useRef<HTMLDivElement | null>(null);
  const hayBarraSoporte = estado?.rol === "super" && !!estado?.negocio;
  useEffect(() => {
    const el = barraSoporte.current;
    if (!hayBarraSoporte || !el) {
      document.documentElement.style.removeProperty("--alto-soporte");
      return;
    }
    const medir = () =>
      document.documentElement.style.setProperty("--alto-soporte", `${el.offsetHeight}px`);
    medir();
    // Dos vías a propósito: ResizeObserver capta los cambios de alto que no
    // vienen de la ventana (fuentes que cargan tarde, textos largos), pero no
    // dispara en todos los navegadores cuando sólo cambia el viewport — y ahí
    // es justamente cuando el texto pasa de una a dos líneas. El listener de
    // resize cubre ese caso.
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, [hayBarraSoporte, estado?.negocio?.nombre]);

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
  const nav = construirNav(cfg, estado.modulosPermitidos, esDueno(estado.rol ?? "dueño"));

  // Estoy mirando los datos de un cliente: tiene que quedar clarísimo, para
  // no confundir su negocio con el mío ni cargar algo en el lugar equivocado.
  const enSoporte = estado.rol === "super" && !!estado.negocio;


  return (
    <div className={`app ${enSoporte ? "modo-soporte" : ""}`}>
      {enSoporte && (
        <div className="barra-soporte" ref={barraSoporte}>
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
        {/* En el celular el menú está cerrado, así que vender tiene que estar
            en la barra de arriba o queda a dos toques igual que antes. */}
        <button className="btn-vender-movil" onClick={() => navegar("/ventas/nueva")}>
          + Vender
        </button>
        <SyncIndicator />
      </header>

      {menuAbierto && <div className="menu-fondo" onClick={() => setMenuAbierto(false)} />}

      <aside className={`sidebar ${menuAbierto ? "abierta" : ""}`}>
        {/* Arriba de todo: quién sos, con tu foto. Antes esto estaba abajo
            del todo y había que buscarlo. */}
        <div className="sidebar-cabecera">
          {estado.foto ? (
            <button
              className="avatar-boton"
              onClick={() => setFotoAmpliada(true)}
              title="Ver la foto en grande"
              aria-label="Ver tu foto de perfil en grande"
            >
              <img src={estado.foto} alt="" className="avatar" />
            </button>
          ) : (
            <span className="avatar avatar-vacio">👤</span>
          )}
          <div className="sidebar-cabecera-txt">
            <strong>{estado.usuario}</strong>
            <span>{cfg.negocio.nombre}</span>
          </div>
        </div>
        <BuscadorGlobal />
        {/* Vender es lo que se hace cincuenta veces por día y estaba a tres
            clics (menú → Ventas → Nueva venta). Acá queda a uno. En el
            celular se abre la venta rápida, que es la pensada para el
            mostrador. */}
        <button className="btn-vender" onClick={() => navegar("/ventas/nueva")}>
          <span className="btn-vender-mas">+</span> Vender
        </button>

        <nav>
          {nav.map((grupo) => (
            <div className="nav-grupo" key={grupo.titulo}>
              <div className="nav-grupo-titulo">{grupo.titulo}</div>
              {grupo.items.map(([path, label]) => (
                <a key={path} href={`#${path}`} className={base === path ? "activo" : ""}>
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-pie">
          <div className="solo-escritorio"><SyncIndicator /></div>
          <button className="btn-tema" onClick={cambiarTema} title="Cambiar tema">
            {ICONO_TEMA[tema]} Tema: {LABEL_TEMA[tema]}
          </button>
          {/* El usuario y su foto ahora van arriba; acá queda sólo el salir. */}
          <div className="usuario">
            <button onClick={salir}>Cerrar sesión</button>
          </div>
        </div>
      </aside>

      <main className="contenido">
        <ConfigContext.Provider value={cfg}>
          <RolContext.Provider value={estado.rol ?? "dueño"}>
            <PermisosContext.Provider value={estado.modulosPermitidos}>
              <Vista ruta={ruta} cfg={cfg} permisos={estado.modulosPermitidos} />
            </PermisosContext.Provider>
          </RolContext.Provider>
        </ConfigContext.Provider>
      </main>

      {/* Visor de la foto de perfil: se cierra tocando en cualquier lado o con Escape. */}
      {fotoAmpliada && estado.foto && (
        <div className="foto-zoom" onClick={() => setFotoAmpliada(false)}>
          <img src={estado.foto} alt="Tu foto de perfil" />
          <button className="foto-zoom-cerrar" aria-label="Cerrar">✕</button>
        </div>
      )}
    </div>
  );
}

function Vista({ ruta, cfg, permisos }: { ruta: ReturnType<typeof useRuta>; cfg: ConfigNegocio; permisos: string[] | null }) {
  const [seccion, id, sub] = ruta.parts;
  const esMovil = useEsMovil();

  // Si alguien entra por URL a una sección apagada, o que no tiene habilitada, no existe.
  const moduloNecesario = seccion ? MODULO_DE_SECCION[seccion] : undefined;
  const tieneAcceso = !moduloNecesario || moduloVisible(cfg.modulos[moduloNecesario], permisos, moduloNecesario);
  useEffect(() => {
    if (!tieneAcceso) navegar("/panel");
  }, [tieneAcceso]);
  if (!tieneAcceso) return null;

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
    case "facturas":
      return <Facturas />;
    case "remitos":
      return <Remitos />;
    case "pagos":
      return <Pagos />;
    case "cobranzas":
      return <Cobranzas />;
    case "produccion":
      return <Produccion />;
    case "compras":
      return <Compras />;
    case "proveedores":
      return <Proveedores />;
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
