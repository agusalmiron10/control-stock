import { useEffect, useMemo, useState } from "react";
import { pesos, aCentavos, aPesos, hoyISO } from "../format";
import { obtenerClientes, obtenerHerramientas } from "../offline/listas";
import { agregarClienteReciente, leerClientesRecientes } from "../offline/cache";
import { api } from "../api";
import { encolarOperacion, calcularEstado } from "../offline/sync";
import { useFacturacionLista } from "../lib/facturacion";
import { EmitirFacturaModal } from "../components/EmitirFacturaModal";
import { waVenta } from "../lib/whatsapp";
import { navegar } from "../lib/router";
import { Cargando } from "../components/ui";
import { EscanerQR, hayEscanerQr } from "../components/EscanerQR";
import { idDeClienteDesdeQr } from "../lib/qr";

interface ItemCarrito { herramienta_id: string; nombre: string; cantidad: number; precio: number }

/** Venta rápida para el celular: pensada para cargar una venta en segundos,
 * sin señal si hace falta. Todo lo que toca guarda local primero (cola de
 * sincronización) — nunca espera a la red para dejar seguir. */
export function VentaRapida() {
  const [cargando, setCargando] = useState(true);
  const [clientes, setClientes] = useState<any[]>([]);
  const [herramientas, setHerramientas] = useState<any[]>([]);
  const [recientes, setRecientes] = useState<string[]>([]);
  const [deCache, setDeCache] = useState(false);

  const [clienteId, setClienteId] = useState<string | null>(null);
  const [buscarCliente, setBuscarCliente] = useState("");
  const [buscarHerr, setBuscarHerr] = useState("");
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [cobre, setCobre] = useState<"nada" | "todo" | "mitad" | "libre">("nada");
  const [montoLibre, setMontoLibre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState<{ cliente: any; items: ItemCarrito[]; total: number; pagado: number; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [escaneando, setEscaneando] = useState(false);
  const [facturable, setFacturable] = useState<string | null>(null);
  const [facturando, setFacturando] = useState(false);
  const [avisoFactura, setAvisoFactura] = useState<string | null>(null);
  const facturacion = useFacturacionLista();

  useEffect(() => {
    (async () => {
      const [c, h, rec] = await Promise.all([obtenerClientes(), obtenerHerramientas(), leerClientesRecientes()]);
      setClientes(c.items);
      setHerramientas(h.items);
      setRecientes(rec);
      setDeCache(c.deCache || h.deCache);
      setCargando(false);
    })();
  }, []);

  const clienteMap = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const cliente = clienteId ? clienteMap.get(clienteId) : null;

  const clientesFiltrados = useMemo(() => {
    const q = buscarCliente.trim().toLowerCase();
    const activos = clientes.filter((c) => c.activo !== 0);
    if (!q) {
      // Sin búsqueda: recientes primero, después el resto de la lista completa
      // (nunca vacío salvo que no haya ningún cliente cargado).
      const recientesObj = recientes.map((id) => clienteMap.get(id)).filter((c) => c && c.activo !== 0) as any[];
      const idsRecientes = new Set(recientesObj.map((c) => c.id));
      const resto = activos.filter((c) => !idsRecientes.has(c.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      return [...recientesObj, ...resto];
    }
    return activos.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [buscarCliente, clientes, clienteMap, recientes]);

  const herrFiltradas = useMemo(() => {
    const q = buscarHerr.trim().toLowerCase();
    const activas = herramientas.filter((h) => h.activo);
    if (!q) return activas;
    return activas.filter((h) => h.nombre.toLowerCase().includes(q) || h.codigo.toLowerCase().includes(q));
  }, [buscarHerr, herramientas]);

  const total = carrito.reduce((acc, it) => acc + it.cantidad * it.precio, 0);
  const pagado = cobre === "todo" ? total : cobre === "mitad" ? Math.round(total / 2) : cobre === "libre" ? aCentavos(montoLibre || "0") : 0;

  function elegirCliente(id: string) {
    setClienteId(id);
    setBuscarCliente("");
  }

  function alEscanearQr(texto: string) {
    setEscaneando(false);
    const cid = idDeClienteDesdeQr(texto);
    if (!cid || !clienteMap.has(cid)) {
      setError("Ese QR no corresponde a un cliente conocido.");
      return;
    }
    setError(null);
    elegirCliente(cid);
  }

  /** Consumidor Final del negocio, para el mostrador. Necesita señal la
   *  primera vez (hay que crearlo); después ya queda en la lista de clientes. */
  async function elegirMostrador() {
    const enLista = clientes.find((c: any) => c.es_consumidor_final);
    if (enLista) { elegirCliente(enLista.id); setCobre("todo"); return; }
    try {
      const cf = await api.get<{ id: string; nombre: string }>("/api/clientes/mostrador");
      setClientes((arr) => (arr.some((x: any) => x.id === cf.id) ? arr : [...arr, { ...cf, es_consumidor_final: 1 }]));
      elegirCliente(cf.id);
      setCobre("todo");
    } catch {
      setError("Para usar el mostrador por primera vez hace falta señal. Elegí un cliente de la lista.");
    }
  }

  async function agregarClienteNuevo() {
    const nombre = buscarCliente.trim();
    if (!nombre) return;
    const id = crypto.randomUUID();
    await encolarOperacion("cliente", id, { nombre });
    const nuevo = { id, nombre, telefono: null };
    setClientes((arr) => [...arr, nuevo]);
    elegirCliente(id);
  }

  function agregarHerramienta(h: any) {
    setCarrito((arr) => {
      const ya = arr.find((it) => it.herramienta_id === h.id);
      if (ya) return arr.map((it) => (it.herramienta_id === h.id ? { ...it, cantidad: it.cantidad + 1 } : it));
      return [...arr, { herramienta_id: h.id, nombre: h.nombre, cantidad: 1, precio: h.precio }];
    });
  }

  function cambiarCantidad(hid: string, delta: number) {
    setCarrito((arr) =>
      arr
        .map((it) => (it.herramienta_id === hid ? { ...it, cantidad: it.cantidad + delta } : it))
        .filter((it) => it.cantidad > 0)
    );
  }

  function cambiarPrecio(hid: string, precioPesos: string) {
    setCarrito((arr) => arr.map((it) => (it.herramienta_id === hid ? { ...it, precio: aCentavos(precioPesos) } : it)));
  }

  function nuevaVenta() {
    setClienteId(null);
    setBuscarCliente("");
    setBuscarHerr("");
    setCarrito([]);
    setCobre("nada");
    setMontoLibre("");
    setGuardada(null);
    setError(null);
    setFacturable(null);
    setFacturando(false);
    setAvisoFactura(null);
  }

  /** Espera (poco) a que la venta llegue al servidor para poder facturarla. */
  async function esperarSincronizacion(ventaId: string): Promise<void> {
    for (let i = 0; i < 15; i++) {
      const e = await calcularEstado();
      if (e.pendientes === 0 && e.online) { setFacturable(ventaId); return; }
      if (!e.online) return; // sin señal no se factura: se hace después
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function guardar() {
    if (!clienteId || carrito.length === 0) return;
    setError(null);
    setGuardando(true);
    const id = crypto.randomUUID();
    const payload: Record<string, unknown> = {
      cliente_id: clienteId,
      fecha: hoyISO(),
      origen: "celular",
      items: carrito.map((it) => ({ herramienta_id: it.herramienta_id, cantidad: it.cantidad, precio_unitario: it.precio })),
    };
    if (pagado > 0) payload.pago_inicial = { monto: pagado, medio: "efectivo" };

    try {
      await encolarOperacion("venta", id, payload);
      await agregarClienteReciente(clienteId);
      setGuardada({ cliente, items: carrito, total, pagado, id });
      // Facturar necesita que la venta ya esté en el servidor. Como acá se
      // guarda contra la cola (para que ande sin señal), se espera a que
      // termine de sincronizar antes de ofrecer el botón de facturar.
      if (facturacion.listo) void esperarSincronizacion(id);
    } catch (err: any) {
      setError(err.message ?? "No se pudo guardar. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <Cargando />;

  if (guardada) {
    return (
      <div className="venta-rapida">
        <div className="ok-box">
          Venta guardada. {deCache ? "Se sincroniza sola cuando vuelva la señal." : "Sincronizando…"}
        </div>
        {avisoFactura && <div className="ok-box">{avisoFactura}</div>}
        <div className="card">
          <div className="card-body">
            <p><b>{guardada.cliente?.nombre ?? "Cliente"}</b></p>
            {guardada.items.map((it) => (
              <p key={it.herramienta_id} className="mut">{it.cantidad} x {it.nombre} — {pesos(it.cantidad * it.precio)}</p>
            ))}
            <p style={{ marginTop: 8 }}><b>Total: {pesos(guardada.total)}</b></p>
            {guardada.pagado > 0 && <p className="mut">Pagó: {pesos(guardada.pagado)}</p>}
          </div>
        </div>
        <div className="btn-grupo" style={{ flexDirection: "column" }}>
          {guardada.cliente?.telefono && (
            <button
              className="btn wa"
              onClick={() =>
                waVenta(
                  guardada.cliente,
                  guardada.items.map((it) => ({ nombre: it.nombre, cantidad: it.cantidad, subtotal: it.cantidad * it.precio })),
                  guardada.total,
                  guardada.pagado
                )
              }
            >
              WhatsApp: mandar resumen
            </button>
          )}
          {facturable && !avisoFactura && (
            <button className="btn" onClick={() => setFacturando(true)}>Facturar esta venta</button>
          )}
          <button className="btn primario" onClick={nuevaVenta}>+ Nueva venta</button>
          <button className="btn" onClick={() => navegar("/panel")}>Terminar</button>
        </div>

        {facturando && facturable && (
          <EmitirFacturaModal
            ventaId={facturable}
            onCerrar={(mensaje) => { setFacturando(false); if (mensaje) setAvisoFactura(mensaje); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="venta-rapida">
      <div className="encabezado-seccion">
        <h1>Venta rápida</h1>
      </div>
      {deCache && <div className="pill-alerta">Sin conexión: mostrando la última lista guardada.</div>}
      {error && <div className="error-box">{error}</div>}

      {/* Cliente */}
      <div className="card">
        <div className="card-body">
          {cliente ? (
            <div className="vr-cliente-elegido">
              <span>👤 <b>{cliente.nombre}</b></span>
              <button className="btn chico" onClick={() => setClienteId(null)}>Cambiar</button>
            </div>
          ) : (
            <>
              <div className="vr-fila-buscar">
                <input
                  className="vr-buscar"
                  placeholder="Buscar cliente…"
                  value={buscarCliente}
                  onChange={(e) => setBuscarCliente(e.target.value)}
                  autoFocus
                />
                {hayEscanerQr() && (
                  <button className="btn vr-btn-qr" onClick={() => setEscaneando(true)} aria-label="Escanear QR de cliente">
                    📷 QR
                  </button>
                )}
              </div>
              <div className="vr-lista-clientes">
                {/* Para el que entra, paga y se va: no hay que inventarle una ficha. */}
                <button className="vr-fila-cliente vr-nuevo" onClick={elegirMostrador}>
                  Venta de mostrador (consumidor final)
                </button>
                {clientesFiltrados.length === 0 && <p className="mut">No hay clientes que coincidan.</p>}
                {clientesFiltrados.map((c: any) => (
                  <button key={c.id} className="vr-fila-cliente" onClick={() => elegirCliente(c.id)}>{c.nombre}</button>
                ))}
                {buscarCliente.trim() && !clientes.some((c) => c.nombre.toLowerCase() === buscarCliente.trim().toLowerCase()) && (
                  <button className="vr-fila-cliente vr-nuevo" onClick={agregarClienteNuevo}>
                    + Agregar "{buscarCliente.trim()}" como cliente nuevo
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Herramientas */}
      {cliente && (
        <div className="card">
          <div className="card-body">
            <input className="vr-buscar" placeholder="Buscar herramienta…" value={buscarHerr} onChange={(e) => setBuscarHerr(e.target.value)} />
            <div className="vr-grid-herr">
              {herrFiltradas.map((h) => {
                const enCarrito = carrito.find((it) => it.herramienta_id === h.id);
                return enCarrito ? (
                  <div key={h.id} className="vr-tarjeta-herr vr-en-carrito">
                    <div className="vr-nombre-herr">{h.nombre}</div>
                    <div className="vr-stepper">
                      <button onClick={() => cambiarCantidad(h.id, -1)}>−</button>
                      <span>{enCarrito.cantidad}</span>
                      <button onClick={() => cambiarCantidad(h.id, 1)}>+</button>
                    </div>
                    <input
                      className="num vr-precio"
                      type="number" step="0.01" min={0}
                      value={aPesos(enCarrito.precio)}
                      onChange={(e) => cambiarPrecio(h.id, e.target.value)}
                    />
                  </div>
                ) : (
                  <button key={h.id} className="vr-tarjeta-herr" onClick={() => agregarHerramienta(h)}>
                    <div className="vr-nombre-herr">{h.nombre}</div>
                    <div className="mut">{pesos(h.precio)}</div>
                  </button>
                );
              })}
              {herrFiltradas.length === 0 && <p className="mut">No hay herramientas para mostrar.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Cobré */}
      {carrito.length > 0 && (
        <div className="card">
          <div className="card-body">
            <p className="mut" style={{ marginTop: 0 }}>Total: <b>{pesos(total)}</b></p>
            <div className="vr-cobre-botones">
              <button className={`btn ${cobre === "nada" ? "primario" : ""}`} onClick={() => setCobre("nada")}>Nada</button>
              <button className={`btn ${cobre === "mitad" ? "primario" : ""}`} onClick={() => setCobre("mitad")}>Mitad</button>
              <button className={`btn ${cobre === "todo" ? "primario" : ""}`} onClick={() => setCobre("todo")}>Todo</button>
              <button className={`btn ${cobre === "libre" ? "primario" : ""}`} onClick={() => setCobre("libre")}>Otro monto</button>
            </div>
            {cobre === "libre" && (
              <input className="num" type="number" step="0.01" min={0} placeholder="Monto cobrado ($)"
                value={montoLibre} onChange={(e) => setMontoLibre(e.target.value)} style={{ marginTop: 8 }} autoFocus />
            )}
          </div>
        </div>
      )}

      {carrito.length > 0 && (
        <div className="vr-barra-guardar">
          <div>
            <div><b>{pesos(total)}</b></div>
            {pagado > 0 && <div className="mut">Cobrás {pesos(pagado)}, queda {pesos(Math.max(0, total - pagado))}</div>}
          </div>
          <button className="btn primario" disabled={guardando} onClick={guardar}>
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}

      {escaneando && <EscanerQR onDetectar={alEscanearQr} onCerrar={() => setEscaneando(false)} />}
    </div>
  );
}
