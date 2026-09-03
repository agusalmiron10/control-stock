import { useMemo, useState } from "react";
import { api } from "../api";
import { pesos, aCentavos, aPesos, hoyISO, numero } from "../format";
import { Cargando, Error, Campo, Confirmar, useCarga } from "../components/ui";
import { BuscadorCliente } from "../components/BuscadorCliente";
import { FacturarTrasVenta } from "../components/FacturarTrasVenta";
import { useFacturacionLista } from "../lib/facturacion";
import { navegar } from "../lib/router";
import { BarraEscaneo } from "../components/BarraEscaneo";
import { CrearProductoExpress } from "../components/CrearProductoExpress";

interface Reng {
  herramienta_id: string;
  cantidad: string;
  precio: string;
  /** Renglón agregado por el escáner o el buscador: se muestra como ticket
   *  (nombre fijo + stepper), no como fila para elegir de un desplegable.
   *  Sólo el renglón manual (el que abre "+ Agregar manualmente") es un
   *  <select> — es el único caso donde de verdad hace falta elegir. */
  manual: boolean;
}

const MEDIOS = ["efectivo", "mercado_pago", "transferencia", "cheque", "otro"];
/** Los dos que se usan en el 90% de las ventas de mostrador: botón directo,
 *  sin abrir un desplegable. El resto vive detrás de "Otro medio". */
const MEDIOS_RAPIDOS = ["efectivo", "mercado_pago"];
const ETIQUETA_MEDIO: Record<string, string> = {
  efectivo: "Efectivo", mercado_pago: "Mercado Pago", transferencia: "Transferencia",
  cheque: "Cheque", otro: "Otro",
};
/** Porcentajes más pedidos en el mostrador. "Otro" abre el monto/porcentaje libre. */
const DESCUENTOS_RAPIDOS = [0, 5, 10];

export function NuevaVenta() {
  const clientesQ = useCarga<any>(() => api.get("/api/clientes"), []);
  const herrQ = useCarga<any>(() => api.get("/api/herramientas"), []);
  const [clientesExtra, setClientesExtra] = useState<any[]>([]);
  const clientes = useMemo(() => [...(clientesQ.data?.clientes ?? []), ...clientesExtra], [clientesQ.data, clientesExtra]);

  const [clienteId, setClienteId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [tipoPrecio, setTipoPrecio] = useState<"minorista" | "mayorista">("minorista");
  // Empieza vacío a propósito: la primera acción tiene que ser escanear o
  // buscar, no completar un formulario. El desplegable manual es un
  // agregado deliberado (botón aparte), no el punto de partida.
  const [items, setItems] = useState<Reng[]>([]);
  const [descTipo, setDescTipo] = useState<"monto" | "porcentaje">("porcentaje");
  const [descValor, setDescValor] = useState("");
  const [descOtro, setDescOtro] = useState(false);
  const [nota, setNota] = useState("");
  // La mayoría de las ventas se cobran ahí mismo, en el mostrador: arrancar
  // en "no paga nada" obligaba a tocar el desplegable en todas las ventas,
  // cuando lo normal es lo contrario.
  const [pagoModo, setPagoModo] = useState<"nada" | "total" | "mitad" | "libre">("total");
  const [pagoLibre, setPagoLibre] = useState("");
  const [pagoMedio, setPagoMedio] = useState("efectivo");
  const [medioOtro, setMedioOtro] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarNeg, setConfirmarNeg] = useState<string | null>(null);
  const [ventaGuardada, setVentaGuardada] = useState<{ id: string; numero: number } | null>(null);
  // Productos creados en el acto desde la caja: se suman a la lista sin
  // recargarla, así el renglón que se acaba de agregar los encuentra.
  const [herrExtra, setHerrExtra] = useState<any[]>([]);
  const [crearExpress, setCrearExpress] = useState<{ codigoBarras: string | null; nombre: string } | null>(null);
  const facturacion = useFacturacionLista();

  const herramientas: any[] = useMemo(
    () => [...(herrQ.data?.herramientas ?? []), ...herrExtra],
    [herrQ.data, herrExtra]
  );
  const hMap = useMemo(() => new Map(herramientas.map((h) => [String(h.id), h])), [herramientas]);

  // Cálculos de montos (en centavos).
  const subtotal = items.reduce((acc, it) => {
    const cant = Number(it.cantidad) || 0;
    return acc + cant * aCentavos(it.precio || "0");
  }, 0);
  const descuentoCent =
    descTipo === "monto"
      ? aCentavos(descValor || "0")
      : Math.round((subtotal * (Number(descValor) || 0)) / 100);
  const descuento = Math.min(Math.max(0, descuentoCent), subtotal);
  const total = subtotal - descuento;

  const pagoCent =
    pagoModo === "total" ? total : pagoModo === "mitad" ? Math.round(total / 2) : pagoModo === "libre" ? aCentavos(pagoLibre || "0") : 0;

  // Faltantes de stock (agregando por herramienta).
  const faltantes = useMemo(() => {
    const ped = new Map<string, number>();
    for (const it of items) {
      if (!it.herramienta_id) continue;
      ped.set(it.herramienta_id, (ped.get(it.herramienta_id) ?? 0) + (Number(it.cantidad) || 0));
    }
    const out: string[] = [];
    for (const [hid, cant] of ped) {
      const h = hMap.get(hid);
      if (h && cant > h.stock) out.push(`${h.nombre} (hay ${h.stock}, pedís ${cant})`);
    }
    return out;
  }, [items, hMap]);

  function precioDe(h: any, tipo = tipoPrecio): number {
    if (!h) return 0;
    // Mayorista si tiene precio > 0; si no, cae al minorista.
    return tipo === "mayorista" && h.precio_mayor > 0 ? h.precio_mayor : h.precio;
  }
  function setItem(i: number, patch: Partial<Reng>) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }
  function elegirHerramienta(i: number, hid: string) {
    const h = hMap.get(hid);
    setItem(i, { herramienta_id: hid, precio: h ? String(aPesos(precioDe(h))) : "" });
  }
  function cambiarTipoPrecio(tipo: "minorista" | "mayorista") {
    setTipoPrecio(tipo);
    // Reprecia los renglones que ya tienen herramienta elegida.
    setItems((arr) =>
      arr.map((it) => {
        const h = hMap.get(it.herramienta_id);
        return h ? { ...it, precio: String(aPesos(precioDe(h, tipo))) } : it;
      })
    );
  }
  /**
   * Suma un producto a la venta. Si ya está en el ticket le sube la
   * cantidad (que es lo que uno espera al pasar dos veces el mismo
   * artículo por el lector); si no, agrega un renglón de ticket nuevo.
   */
  function sumarProducto(h: any) {
    setItems((arr) => {
      const i = arr.findIndex((it) => it.herramienta_id === h.id);
      if (i >= 0) {
        return arr.map((it, j) => (j === i ? { ...it, cantidad: String((Number(it.cantidad) || 0) + 1) } : it));
      }
      return [...arr, { herramienta_id: h.id, cantidad: "1", precio: String(aPesos(precioDe(h))), manual: false }];
    });
  }

  /** Sube o baja de a uno con el stepper. Llegar a 0 saca el renglón. */
  function cambiarCantidad(i: number, delta: number) {
    setItems((arr) =>
      arr
        .map((it, j) => (j === i ? { ...it, cantidad: String(Math.max(0, (Number(it.cantidad) || 0) + delta)) } : it))
        .filter((it) => Number(it.cantidad) > 0)
    );
  }

  /** El renglón manual: para el caso raro de no tener el código a mano y no
   *  encontrarlo por nombre. Es el único que se elige de un desplegable. */
  function agregarReng() { setItems((a) => [...a, { herramienta_id: "", cantidad: "1", precio: "", manual: true }]); }
  function quitarReng(i: number) { setItems((a) => a.filter((_, j) => j !== i)); }

  function validar(): string | null {
    if (!clienteId) return "Elegí un cliente.";
    const validos = items.filter((it) => it.herramienta_id && Number(it.cantidad) > 0);
    if (validos.length === 0) return "Escaneá o agregá al menos un producto.";
    return null;
  }

  /** Elegir el Consumidor Final del negocio (se crea solo la primera vez) y
   *  dejar el cobro en "paga todo", que es lo normal en el mostrador. */
  async function elegirMostrador() {
    try {
      const cf = await api.get<{ id: string; nombre: string }>("/api/clientes/mostrador");
      setClientesExtra((arr) => (arr.some((x) => x.id === cf.id) ? arr : [...arr, cf]));
      setClienteId(cf.id);
      setPagoModo("total");
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function enviar(force: boolean) {
    const v = validar();
    if (v) { setError(v); return; }
    if (faltantes.length > 0 && !force) {
      setConfirmarNeg(`No alcanza el stock de: ${faltantes.join("; ")}. ¿Vender igual? El stock quedará en negativo (marcado en rojo).`);
      return;
    }
    setConfirmarNeg(null);
    setError(null);
    setGuardando(true);
    const body: any = {
      cliente_id: clienteId,
      fecha,
      items: items
        .filter((it) => it.herramienta_id && Number(it.cantidad) > 0)
        .map((it) => ({ herramienta_id: it.herramienta_id, cantidad: Number(it.cantidad), precio_unitario: aCentavos(it.precio || "0") })),
      nota,
      permitir_stock_negativo: force || faltantes.length === 0 ? force : false,
    };
    if (descValor && Number(descValor) > 0) body.descuento = { tipo: descTipo, valor: descTipo === "monto" ? aCentavos(descValor) : Number(descValor) };
    if (pagoModo !== "nada" && pagoCent > 0) body.pago_inicial = { monto: pagoCent, medio: pagoMedio };

    try {
      const r = await api.post<{ id: string; numero: number }>("/api/ventas", body);
      // Si el negocio factura, se ofrece hacerlo acá mismo en vez de tener que
      // ir a buscar la venta después.
      if (facturacion.listo) { setVentaGuardada(r); setGuardando(false); return; }
      navegar(`/clientes/${clienteId}`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  if (clientesQ.cargando || herrQ.cargando) return <Cargando />;

  const sinClientes = clientes.length === 0;
  const sinHerr = herramientas.length === 0;

  return (
    <div>
      <div className="encabezado-seccion">
        <div>
          <a href="#/ventas">← Ventas</a>
          <h1 style={{ marginTop: 4 }}>Nueva venta</h1>
        </div>
      </div>

      <Error msg={error} />
      {(sinClientes || sinHerr) && (
        <div className="pill-alerta">
          {sinClientes && <div>Primero necesitás <a href="#/clientes">cargar un cliente</a>.</div>}
          {sinHerr && <div>Primero necesitás <a href="#/herramientas">cargar una herramienta</a>.</div>}
        </div>
      )}

      <div className="card">
        <div className="card-body">
          <div className="fila">
            <Campo label="Cliente">
              <BuscadorCliente
                clientes={clientes}
                clienteId={clienteId}
                onElegir={setClienteId}
                onClienteNuevo={(c) => setClientesExtra((arr) => [...arr, c])}
              />
              {/* Para el que entra, paga y se va: no hay que inventarle una ficha. */}
              <button type="button" className="btn chico" style={{ marginTop: 6 }} onClick={elegirMostrador}>
                Venta de mostrador (consumidor final)
              </button>
            </Campo>
            <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
            <Campo label="Lista de precios">
              <select value={tipoPrecio} onChange={(e) => cambiarTipoPrecio(e.target.value as any)}>
                <option value="minorista">Minorista</option>
                <option value="mayorista">Mayorista</option>
              </select>
            </Campo>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Productos</h2>
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <BarraEscaneo
            herramientas={herramientas}
            onElegir={sumarProducto}
            onNoEncontrado={(d) => setCrearExpress(d)}
          />
        </div>

        {items.length === 0 ? (
          <div className="card-body">
            <p className="mut" style={{ margin: 0 }}>
              Escaneá o buscá arriba para empezar a cargar el ticket.
            </p>
          </div>
        ) : (
          <div className="ticket-venta">
            {items.map((it, i) => {
              const cant = Number(it.cantidad) || 0;
              const sub = cant * aCentavos(it.precio || "0");
              const h = hMap.get(it.herramienta_id);
              const falta = h && cant > h.stock;

              if (it.manual) {
                // El único caso donde de verdad hace falta elegir de una
                // lista: no se sabe el código ni se encontró por nombre.
                return (
                  <div className="ticket-fila ticket-fila-manual" key={i}>
                    <select value={it.herramienta_id} onChange={(e) => elegirHerramienta(i, e.target.value)}>
                      <option value="">Elegí un producto…</option>
                      {herramientas.map((hh) => <option key={hh.id} value={hh.id}>{hh.codigo} — {hh.nombre} (stock {hh.stock})</option>)}
                    </select>
                    <input className="num" type="number" min={1} value={it.cantidad}
                      onChange={(e) => setItem(i, { cantidad: e.target.value })} style={{ maxWidth: 80 }} />
                    <input className="num" type="number" step="0.01" min={0} value={it.precio}
                      onChange={(e) => setItem(i, { precio: e.target.value })} style={{ maxWidth: 110 }} placeholder="Precio" />
                    <span className="num ticket-sub">{pesos(sub)}</span>
                    <button className="btn chico" onClick={() => quitarReng(i)} aria-label="Quitar">✕</button>
                  </div>
                );
              }

              return (
                <div className="ticket-fila" key={i}>
                  <div className="ticket-nombre">
                    {h?.nombre ?? "Producto"}
                    {falta && <div className="stock-bajo" style={{ fontSize: 12 }}>Stock insuficiente (hay {numero(h!.stock)})</div>}
                  </div>
                  <div className="ticket-stepper">
                    <button type="button" onClick={() => cambiarCantidad(i, -1)} aria-label="Restar uno">−</button>
                    <input className="num" type="number" min={1} value={it.cantidad}
                      onChange={(e) => setItem(i, { cantidad: e.target.value })} />
                    <button type="button" onClick={() => cambiarCantidad(i, 1)} aria-label="Sumar uno">+</button>
                  </div>
                  <input className="num ticket-precio" type="number" step="0.01" min={0} value={it.precio}
                    onChange={(e) => setItem(i, { precio: e.target.value })} />
                  <span className="num ticket-sub">{pesos(sub)}</span>
                  <button className="btn chico" onClick={() => quitarReng(i)} aria-label="Quitar">✕</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="card-body">
          <button className="btn" onClick={agregarReng}>+ Agregar manualmente</button>
          <span className="mut" style={{ fontSize: 12.5, marginLeft: 8 }}>
            Para cuando no tenés el código a mano y no lo encontrás por nombre.
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Descuento, pago y nota</h2>
        <div className="card-body">
          <div className="fila">
            <Campo label="Pago en este momento">
              <div className="btn-grupo">
                <button type="button" className={`btn chico ${pagoModo === "total" ? "primario" : ""}`} onClick={() => setPagoModo("total")}>
                  Paga todo
                </button>
                <button type="button" className={`btn chico ${pagoModo === "mitad" ? "primario" : ""}`} onClick={() => setPagoModo("mitad")}>
                  Paga la mitad
                </button>
                <button type="button" className={`btn chico ${pagoModo === "nada" ? "primario" : ""}`} onClick={() => setPagoModo("nada")}>
                  No paga ahora
                </button>
                <button type="button" className={`btn chico ${pagoModo === "libre" ? "primario" : ""}`} onClick={() => setPagoModo("libre")}>
                  Otro monto
                </button>
              </div>
              {pagoModo === "libre" && (
                <input className="num" type="number" step="0.01" min={0} value={pagoLibre}
                  onChange={(e) => setPagoLibre(e.target.value)} placeholder="Monto ($)" style={{ marginTop: 8, maxWidth: 200 }} autoFocus />
              )}
            </Campo>

            {pagoModo !== "nada" && (
              <Campo label="Medio de pago">
                <div className="btn-grupo">
                  {MEDIOS_RAPIDOS.map((m) => (
                    <button key={m} type="button"
                      className={`btn chico ${!medioOtro && pagoMedio === m ? "primario" : ""}`}
                      onClick={() => { setPagoMedio(m); setMedioOtro(false); }}>
                      {ETIQUETA_MEDIO[m]}
                    </button>
                  ))}
                  <button type="button" className={`btn chico ${medioOtro ? "primario" : ""}`} onClick={() => setMedioOtro(true)}>
                    Otro medio
                  </button>
                </div>
                {medioOtro && (
                  <select value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)} style={{ marginTop: 8, maxWidth: 220 }}>
                    {MEDIOS.map((m) => <option key={m} value={m}>{ETIQUETA_MEDIO[m]}</option>)}
                  </select>
                )}
              </Campo>
            )}
          </div>

          <Campo label="Descuento">
            <div className="btn-grupo">
              {DESCUENTOS_RAPIDOS.map((p) => (
                <button key={p} type="button"
                  className={`btn chico ${!descOtro && descTipo === "porcentaje" && Number(descValor || 0) === p ? "primario" : ""}`}
                  onClick={() => { setDescTipo("porcentaje"); setDescValor(p === 0 ? "" : String(p)); setDescOtro(false); }}>
                  {p === 0 ? "Sin descuento" : `${p}%`}
                </button>
              ))}
              <button type="button" className={`btn chico ${descOtro ? "primario" : ""}`} onClick={() => setDescOtro(true)}>
                Otro
              </button>
            </div>
            {descOtro && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <select value={descTipo} onChange={(e) => setDescTipo(e.target.value as any)} style={{ maxWidth: 130 }}>
                  <option value="monto">Monto ($)</option>
                  <option value="porcentaje">Porcentaje (%)</option>
                </select>
                <input className="num" type="number" step="0.01" min={0} value={descValor} onChange={(e) => setDescValor(e.target.value)} placeholder="0" />
              </div>
            )}
          </Campo>

          <Campo label="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
        </div>
      </div>

      {faltantes.length > 0 && (
        <div className="pill-alerta">
          Ojo con el stock: {faltantes.join("; ")}. Podés vender igual (quedará en rojo).
        </div>
      )}

      {/* Fija abajo de todo: el total y el botón de cerrar la venta siempre a
          la vista, sin tener que bajar hasta el final de la página. */}
      <div className="barra-total-venta">
        <div className="btv-cifras">
          <span className="mut">
            {items.length} producto{items.length === 1 ? "" : "s"}
            {descuento > 0 && ` · Desc. ${pesos(descuento)}`}
            {pagoModo !== "nada" && total - pagoCent > 0 && ` · Debe ${pesos(Math.max(0, total - pagoCent))}`}
          </span>
          <span className="btv-total">{pesos(total)}</span>
        </div>
        <button className="btn primario" disabled={guardando || total < 0 || items.length === 0} onClick={() => enviar(false)}>
          {guardando ? "Guardando…" : "Confirmar venta"}
        </button>
      </div>

      {confirmarNeg && (
        <Confirmar mensaje={confirmarNeg} textoConfirmar="Vender igual" peligro
          onSi={() => enviar(true)} onNo={() => setConfirmarNeg(null)} />
      )}

      {crearExpress && (
        <CrearProductoExpress
          codigoBarras={crearExpress.codigoBarras}
          nombreInicial={crearExpress.nombre}
          onCerrar={() => setCrearExpress(null)}
          onCreado={(h) => {
            setHerrExtra((arr) => [...arr, h]);
            sumarProducto(h);
            setCrearExpress(null);
          }}
        />
      )}

      {ventaGuardada && (
        <FacturarTrasVenta venta={ventaGuardada} onListo={() => navegar(`/clientes/${clienteId}`)} />
      )}
    </div>
  );
}
