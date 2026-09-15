import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { pesos, aCentavos, aPesos, hoyISO, numero } from "../format";
import { Cargando, Error, Campo, Confirmar, useCarga } from "../components/ui";
import { BuscadorCliente } from "../components/BuscadorCliente";
import { FacturarTrasVenta } from "../components/FacturarTrasVenta";
import { useFacturacionLista } from "../lib/facturacion";
import { navegar } from "../lib/router";
import { BarraEscaneo } from "../components/BarraEscaneo";
import { CrearProductoExpress } from "../components/CrearProductoExpress";
import { Comprobante } from "../components/Comprobante";
import { useCapacidades, useModulo } from "../lib/config";

interface Reng {
  herramienta_id: string;
  cantidad: string;
  precio: string;
  /** Una serie por unidad, sólo para productos marcados como que la llevan. */
  series?: string[];
  /** Renglón agregado por el escáner o el buscador: se muestra como ticket
   *  (nombre fijo + stepper), no como fila para elegir de un desplegable.
   *  Sólo el renglón manual (el que abre "+ Agregar manualmente") es un
   *  <select> — es el único caso donde de verdad hace falta elegir. */
  manual: boolean;
}

// Los seis entran cómodos en la grilla del panel de cierre — a diferencia
// de la fila de botones que había antes, acá no hace falta esconder ninguno
// detrás de un "Otro medio".
const MEDIOS = ["efectivo", "mercado_pago", "tarjeta", "transferencia", "cheque", "otro"];
const ETIQUETA_MEDIO: Record<string, string> = {
  efectivo: "Efectivo", mercado_pago: "Mercado Pago", tarjeta: "Tarjeta",
  transferencia: "Transferencia", cheque: "Cheque", otro: "Otro",
};
const ICONO_MEDIO: Record<string, string> = {
  efectivo: "💵", mercado_pago: "📲", tarjeta: "💳",
  transferencia: "🔁", cheque: "🧾", otro: "⋯",
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
  // Acopio: el cliente paga esto ahora pero se lo lleva de a poco después.
  // Sólo tiene sentido ofrecerlo si el negocio tiene los dos módulos que
  // hacen falta — vender reteniendo y, después, remitar el retiro. Ojo: los
  // dos useModulo() se llaman siempre, sin && de por medio, porque son hooks
  // (no se pueden llamar condicionalmente).
  const moduloAcopio = useModulo("acopio");
  const moduloRemitos = useModulo("remitos");
  const hayAcopio = moduloAcopio && moduloRemitos;
  const [esAcopio, setEsAcopio] = useState(false);
  // La mayoría de las ventas se cobran ahí mismo, en el mostrador: arrancar
  // en "no paga nada" obligaba a tocar el desplegable en todas las ventas,
  // cuando lo normal es lo contrario.
  const [pagoModo, setPagoModo] = useState<"nada" | "total" | "mitad" | "libre">("total");
  const [pagoLibre, setPagoLibre] = useState("");
  const [pagoMedio, setPagoMedio] = useState("efectivo");
  // Con cuánto paga en mano, sólo para calcular el vuelto — nunca se manda
  // al servidor: lo que se registra como pago sigue siendo pagoCent, no
  // esto. Se limpia solo si deja de pagar en efectivo, para no mostrar un
  // vuelto viejo si vuelve a elegir "Efectivo" más tarde.
  const [recibido, setRecibido] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarNeg, setConfirmarNeg] = useState<string | null>(null);
  const [confirmarVaciar, setConfirmarVaciar] = useState(false);
  const [ventaGuardada, setVentaGuardada] = useState<{ id: string; numero: number } | null>(null);
  /**
   * La venta que se acaba de cerrar, congelada para la pantalla de
   * confirmación. Va aparte del formulario (que se vacía) porque después de
   * cobrar hay que seguir viendo qué se vendió y —sobre todo— cuánto vuelto
   * dar, mientras se le devuelve la plata al cliente.
   */
  const [ventaHecha, setVentaHecha] = useState<{
    id: string; numero: number; clienteId: string; clienteNombre: string;
    items: { nombre: string; cantidad: number; subtotal: number }[];
    total: number; pagado: number; vuelto: number | null;
  } | null>(null);
  const [verComprobante, setVerComprobante] = useState(false);
  const [avisoFactura, setAvisoFactura] = useState<string | null>(null);
  // Resalta un instante el renglón recién agregado (escáner o buscador):
  // confirmación visual rápida, sin tener que leer el nombre para saber si
  // entró. Se apaga solo.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 700);
    return () => clearTimeout(t);
  }, [flashId]);

  function elegirMedio(m: string) {
    setPagoMedio(m);
    if (m !== "efectivo") setRecibido("");
  }
  // Productos creados en el acto desde la caja: se suman a la lista sin
  // recargarla, así el renglón que se acaba de agregar los encuentra.
  const [herrExtra, setHerrExtra] = useState<any[]>([]);
  const [crearExpress, setCrearExpress] = useState<{ codigoBarras: string | null; nombre: string } | null>(null);
  const facturacion = useFacturacionLista();
  const { venta_fraccionada, requiere_numero_serie } = useCapacidades();

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

  // Vuelto: sólo una cuenta para el cajero, con lo que puso en "recibido".
  // No cambia pagoCent ni lo que se manda al guardar la venta.
  const recibidoCent = recibido.trim() ? aCentavos(recibido) : null;
  const vuelto = recibidoCent !== null ? recibidoCent - pagoCent : null;

  /** Billetes comunes en la calle, sólo los que superan lo que hay que
   *  cobrar (uno menor no sirve para calcular vuelto). El primero siempre
   *  es el monto justo. */
  function billetesSugeridos(montoCent: number): number[] {
    const FIJOS = [200000, 500000, 1000000, 2000000]; // $2.000 / $5.000 / $10.000 / $20.000
    return [montoCent, ...FIJOS.filter((b) => b > montoCent).slice(0, 3)];
  }

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
      // Si el negocio usa Acopio, lo comprometido en otros acopios tampoco
      // se puede vender de nuevo — mismo criterio que valida el servidor.
      const disponible = h ? (h.stock_disponible ?? h.stock) : 0;
      if (h && cant > disponible) out.push(`${h.nombre} (hay ${disponible} disponible, pedís ${cant})`);
    }
    return out;
  }, [items, hMap]);

  function precioDe(h: any, tipo = tipoPrecio, cantidad = 1): number {
    if (!h) return 0;
    // Mayorista si tiene precio > 0; si no, cae al minorista.
    const base = tipo === "mayorista" && h.precio_mayor > 0 ? h.precio_mayor : h.precio;
    // Precio por cantidad: gana el tramo más alto que la cantidad alcance.
    // Los tramos sólo vienen si el negocio tiene la capacidad prendida, así
    // que acá no hace falta preguntar nada más.
    const tramos: { desde_cantidad: number; precio: number }[] = h.escalas ?? [];
    const tramo = tramos
      .filter((t) => cantidad >= t.desde_cantidad)
      .sort((a, b) => b.desde_cantidad - a.desde_cantidad)[0];
    return tramo ? tramo.precio : base;
  }
  function setItem(i: number, patch: Partial<Reng>) {
    setItems((arr) =>
      arr.map((it, j) => {
        if (j !== i) return it;
        const siguiente = { ...it, ...patch };
        // Si cambió la cantidad y el producto tiene tramos, se recalcula el
        // precio solo: es justamente para lo que sirve el precio por
        // cantidad, que el de mostrador no tenga que acordarse del descuento.
        const h = hMap.get(siguiente.herramienta_id);
        if (patch.cantidad !== undefined && h?.escalas?.length) {
          siguiente.precio = String(aPesos(precioDe(h, tipoPrecio, Number(siguiente.cantidad) || 1)));
        }
        // Las series son una por unidad: si baja la cantidad hay que
        // recortarlas. Si no, quedan en el estado (la pantalla deja de
        // mostrarlas, pero se mandarían igual) y se manda una venta de 2
        // unidades con 3 series.
        if (patch.cantidad !== undefined && siguiente.series?.length) {
          siguiente.series = siguiente.series.slice(0, Math.max(0, Math.trunc(Number(siguiente.cantidad) || 0)));
        }
        return siguiente;
      })
    );
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
        return h ? { ...it, precio: String(aPesos(precioDe(h, tipo, Number(it.cantidad) || 1))) } : it;
      })
    );
  }
  /**
   * Suma un producto a la venta. Si ya está en el ticket le sube la
   * cantidad (que es lo que uno espera al pasar dos veces el mismo
   * artículo por el lector); si no, agrega un renglón de ticket nuevo.
   */
  function sumarProducto(h: any) {
    setFlashId(h.id);
    setItems((arr) => {
      const i = arr.findIndex((it) => it.herramienta_id === h.id);
      if (i >= 0) {
        return arr.map((it, j) => {
          if (j !== i) return it;
          const cantidad = (Number(it.cantidad) || 0) + 1;
          // Pasar el mismo producto dos veces por el lector puede cruzar un
          // tramo: el precio tiene que seguir a la cantidad también acá.
          return {
            ...it,
            cantidad: String(cantidad),
            precio: h.escalas?.length ? String(aPesos(precioDe(h, tipoPrecio, cantidad))) : it.precio,
          };
        });
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
  /** Empezar de nuevo de un tirón, en vez de sacar renglón por renglón. */
  function vaciar() {
    setItems([]);
    setDescValor("");
    setDescOtro(false);
    setNota("");
    setRecibido("");
    setEsAcopio(false);
    setConfirmarVaciar(false);
  }

  function validar(): string | null {
    if (!clienteId) return "Elegí un cliente.";
    const validos = items.filter((it) => it.herramienta_id && Number(it.cantidad) > 0);
    if (validos.length === 0) return "Escaneá o agregá al menos un producto.";
    // Si un producto lleva serie, tienen que estar todas: media venta con
    // series es peor que ninguna (no sirve para la garantía).
    if (requiere_numero_serie) {
      for (const it of validos) {
        const h = hMap.get(it.herramienta_id);
        if (!h?.requiere_serie) continue;
        const faltan = (Number(it.cantidad) || 0) - (it.series ?? []).filter((x) => x.trim() !== "").length;
        if (faltan > 0) return `Falta cargar ${faltan} número(s) de serie de ${h.nombre}.`;
      }
    }
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

  // La gran mayoría de las ventas son de mostrador — pedir que se busque
  // "Consumidor Final" a mano cada vez es fricción de sobra. Se preselecciona
  // solo al entrar; si vende a un cliente con cuenta, lo cambia buscándolo.
  useEffect(() => {
    void elegirMostrador();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        .map((it) => ({
          herramienta_id: it.herramienta_id,
          cantidad: Number(it.cantidad),
          precio_unitario: aCentavos(it.precio || "0"),
          series: (it.series ?? [])
            .slice(0, Math.max(0, Math.trunc(Number(it.cantidad) || 0)))
            .filter((x) => x.trim() !== ""),
        })),
      nota,
      permitir_stock_negativo: force || faltantes.length === 0 ? force : false,
      es_acopio: hayAcopio && esAcopio,
    };
    if (descValor && Number(descValor) > 0) body.descuento = { tipo: descTipo, valor: descTipo === "monto" ? aCentavos(descValor) : Number(descValor) };
    if (pagoModo !== "nada" && pagoCent > 0) body.pago_inicial = { monto: pagoCent, medio: pagoMedio };

    try {
      const r = await api.post<{ id: string; numero: number }>("/api/ventas", body);
      // Se congela lo vendido ANTES de vaciar el formulario: es lo que va a
      // mostrar la confirmación.
      setVentaHecha({
        id: r.id,
        numero: r.numero,
        clienteId,
        clienteNombre: clientes.find((c: any) => String(c.id) === String(clienteId))?.nombre ?? "Cliente",
        items: items
          .filter((it) => it.herramienta_id && Number(it.cantidad) > 0)
          .map((it) => ({
            nombre: hMap.get(it.herramienta_id)?.nombre ?? "",
            cantidad: Number(it.cantidad),
            subtotal: Number(it.cantidad) * aCentavos(it.precio || "0"),
          })),
        total,
        pagado: pagoModo !== "nada" ? pagoCent : 0,
        // Sólo si de verdad hay algo que devolver, y sólo en efectivo.
        vuelto: pagoMedio === "efectivo" && vuelto !== null && vuelto > 0 ? vuelto : null,
      });
      // Si el negocio factura, se ofrece hacerlo acá mismo en vez de tener que
      // ir a buscar la venta después.
      if (facturacion.listo) setVentaGuardada(r);
      setGuardando(false);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  /** Volver al formulario vacío para cobrarle al que sigue. */
  function otraVenta() {
    setVentaHecha(null);
    setVentaGuardada(null);
    setAvisoFactura(null);
    setVerComprobante(false);
    setClienteId("");
    setItems([]);
    setDescValor("");
    setDescOtro(false);
    setNota("");
    setRecibido("");
    setEsAcopio(false);
    setPagoModo("total");
    setError(null);
  }

  if (clientesQ.cargando || herrQ.cargando) return <Cargando />;

  /**
   * Venta cerrada. No se vuelve al formulario solo ni se salta a otra
   * pantalla: primero se confirma qué pasó (y cuánto vuelto dar), y desde
   * acá se elige qué sigue. Lo que más veces sigue en un mostrador es otra
   * venta, así que ese es el botón principal.
   */
  if (ventaHecha) {
    return (
      <div>
        <div className="encabezado-seccion">
          <div>
            <a href="#/ventas">← Ventas</a>
            <h1 style={{ marginTop: 4 }}>Venta #{ventaHecha.numero} guardada</h1>
          </div>
        </div>

        {avisoFactura && <div className="ok-box">{avisoFactura}</div>}

        {ventaHecha.vuelto !== null && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-body">
              <div className="rot">Vuelto</div>
              <div className="val" style={{ fontSize: 34 }}>{pesos(ventaHecha.vuelto)}</div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-body">
            <p style={{ marginTop: 0 }}><b>{ventaHecha.clienteNombre}</b></p>
            {ventaHecha.items.map((it, i) => (
              <p key={i} className="mut" style={{ marginBottom: 4 }}>
                {numero(it.cantidad)} × {it.nombre} — {pesos(it.subtotal)}
              </p>
            ))}
            <p style={{ marginTop: 10 }}><b>Total: {pesos(ventaHecha.total)}</b></p>
            {ventaHecha.pagado > 0
              ? <p className="mut">Pagó: {pesos(ventaHecha.pagado)}</p>
              : <p className="mut">Queda en cuenta corriente.</p>}
          </div>
        </div>

        <div className="btn-grupo" style={{ marginTop: 14 }}>
          <button className="btn primario" onClick={otraVenta}>+ Otra venta</button>
          <button className="btn" onClick={() => setVerComprobante(true)}>Comprobante</button>
          {facturacion.listo && !avisoFactura && (
            <button className="btn" onClick={() => setVentaGuardada({ id: ventaHecha.id, numero: ventaHecha.numero })}>
              Facturar
            </button>
          )}
          <button className="btn" onClick={() => navegar(`/clientes/${ventaHecha.clienteId}`)}>
            Ver ficha del cliente
          </button>
        </div>

        {verComprobante && (
          <Comprobante ventaId={ventaHecha.id} onCerrar={() => setVerComprobante(false)} />
        )}
        {ventaGuardada && (
          <FacturarTrasVenta
            venta={ventaGuardada}
            onListo={(mensaje) => { setVentaGuardada(null); if (mensaje) setAvisoFactura(mensaje); }}
          />
        )}
      </div>
    );
  }

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

      <div className="pos-venta">
        <div className="pos-principal">
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
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Productos</span>
              {items.length > 0 && (
                <button type="button" className="btn chico" style={{ textTransform: "none", letterSpacing: "normal", fontWeight: 500 }}
                  onClick={() => setConfirmarVaciar(true)}>
                  Vaciar
                </button>
              )}
            </div>
            {/* El ticket va PRIMERO, antes del buscador: es lo que ya está
                cargado, y con el catálogo entero mostrándose debajo del
                buscador (ver BarraEscaneo) quedaba enterrado más abajo —
                para bajar o subir una cantidad había que primero pasar por
                toda la lista para agregar más. Así queda a la vista apenas
                se toca algo. */}
            {items.length > 0 && (
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
                          onChange={(e) => setItem(i, { cantidad: e.target.value })} style={{ maxWidth: 80 }}
                          step={venta_fraccionada ? "0.001" : "1"} />
                        <input className="num" type="number" step="0.01" min={0} value={it.precio}
                          onChange={(e) => setItem(i, { precio: e.target.value })} style={{ maxWidth: 110 }} placeholder="Precio" />
                        <span className="num ticket-sub">{pesos(sub)}</span>
                        <button className="btn chico" onClick={() => quitarReng(i)} aria-label="Quitar">✕</button>
                      </div>
                    );
                  }

                  // Una serie por unidad: si el producto la lleva, se piden tantas
                  // casillas como unidades tenga el renglón.
                  const pideSeries = requiere_numero_serie && !!h?.requiere_serie;
                  const series = it.series ?? [];

                  return (
                    <div className={`ticket-fila ${h?.id === flashId ? "ticket-fila-flash" : ""}`} key={i}>
                      <div className="ticket-nombre">
                        {h?.nombre ?? "Producto"}
                        {falta && <div className="stock-bajo" style={{ fontSize: 12 }}>Stock insuficiente (hay {numero(h!.stock)})</div>}
                        {pideSeries && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                            {Array.from({ length: Math.max(0, Math.trunc(cant)) }).map((_, u) => (
                              <input
                                key={u}
                                value={series[u] ?? ""}
                                onChange={(e) => setItem(i, {
                                  series: Array.from({ length: Math.max(0, Math.trunc(cant)) },
                                    (_, k) => (k === u ? e.target.value : series[k] ?? "")),
                                })}
                                placeholder={`Serie ${u + 1}`}
                                style={{ maxWidth: 160, fontSize: 13 }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="ticket-stepper">
                        <button type="button" onClick={() => cambiarCantidad(i, -1)} aria-label="Restar uno">−</button>
                        <input className="num" type="number" min={1} value={it.cantidad}
                          onChange={(e) => setItem(i, { cantidad: e.target.value })}
                          step={venta_fraccionada ? "0.001" : "1"} />
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

            <div className="card-body" style={{ paddingBottom: 0 }}>
              <BarraEscaneo
                herramientas={herramientas}
                onElegir={sumarProducto}
                onNoEncontrado={(d) => setCrearExpress(d)}
              />
            </div>

            {items.length === 0 && (
              <div className="card-body">
                <p className="mut" style={{ margin: 0 }}>
                  Escaneá o buscá arriba para empezar a cargar el ticket.
                </p>
              </div>
            )}

            <div className="card-body">
              <button className="btn" onClick={agregarReng}>+ Agregar manualmente</button>
              <span className="mut" style={{ fontSize: 12.5, marginLeft: 8 }}>
                Para cuando no tenés el código a mano y no lo encontrás por nombre.
              </span>
            </div>
          </div>

          {faltantes.length > 0 && (
            <div className="pill-alerta">
              Ojo con el stock: {faltantes.join("; ")}. Podés vender igual (quedará en rojo).
            </div>
          )}
        </div>

        {/* El cierre de venta: en una pantalla ancha queda fijo al costado
            (sticky), siempre a la vista mientras se sigue cargando el
            ticket. Adentro, sólo .pos-cierre-scroll se desborda — el pie
            con el total y "Confirmar venta" no se mueve nunca, así tocar
            un producto no obliga a bajar para poder cobrar. En el celular
            pasa a ser una tarjeta más, y la barra fija de abajo de toda la
            página vuelve a hacer ese trabajo. */}
        <aside className="pos-cierre">
        <div className="pos-cierre-scroll">
          <p className="pos-cierre-titulo">Cierre de venta</p>

          <div className="pos-resumen">
            <div className="pos-resumen-linea">
              <span>{items.length} producto{items.length === 1 ? "" : "s"}</span>
              <span>{pesos(subtotal)}</span>
            </div>
            {descuento > 0 && (
              <div className="pos-resumen-linea">
                <span>Descuento</span>
                <span>− {pesos(descuento)}</span>
              </div>
            )}
            {pagoModo !== "nada" && total - pagoCent > 0 && (
              <div className="pos-resumen-linea debe">
                <span>Queda debiendo</span>
                <span>{pesos(Math.max(0, total - pagoCent))}</span>
              </div>
            )}
          </div>

          <div className="pos-seccion">
            <label className="pos-label">Pago en este momento</label>
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
                onChange={(e) => setPagoLibre(e.target.value)} placeholder="Monto ($)" style={{ maxWidth: 200 }} autoFocus />
            )}
          </div>

          {pagoModo !== "nada" && (
            <div className="pos-seccion">
              <label className="pos-label">Medio de pago</label>
              <div className="pos-medios">
                {MEDIOS.map((m) => (
                  <button key={m} type="button"
                    className={`pos-medio ${pagoMedio === m ? "activo" : ""}`}
                    onClick={() => elegirMedio(m)}>
                    <span className="pos-medio-icono">{ICONO_MEDIO[m]}</span>
                    {ETIQUETA_MEDIO[m]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Calculadora de vuelto: sólo para el que cobra, no cambia nada
              de lo que se manda a guardar. Es lo que más tiempo ahorra en
              el mostrador — nadie quiere sacar la cuenta de cabeza con el
              cliente esperando. */}
          {pagoModo !== "nada" && pagoMedio === "efectivo" && pagoCent > 0 && (
            <div className="pos-seccion">
              <label className="pos-label">Paga en efectivo con…</label>
              <div className="btn-grupo">
                {billetesSugeridos(pagoCent).map((b, idx) => (
                  <button key={b} type="button"
                    className={`btn chico ${recibidoCent === b ? "primario" : ""}`}
                    onClick={() => setRecibido(String(aPesos(b)))}>
                    {idx === 0 ? `Justo (${pesos(b)})` : pesos(b)}
                  </button>
                ))}
              </div>
              <input className="num" type="number" step="0.01" min={0} value={recibido}
                onChange={(e) => setRecibido(e.target.value)} placeholder="Otro monto recibido ($)" style={{ maxWidth: 200 }} />
              {vuelto !== null && (
                <div className={`pos-vuelto ${vuelto >= 0 ? "ok" : "falta"}`}>
                  {vuelto >= 0 ? <>Vuelto <b>{pesos(vuelto)}</b></> : <>Todavía falta <b>{pesos(-vuelto)}</b></>}
                </div>
              )}
            </div>
          )}

          {hayAcopio && (
            <div className="pos-seccion">
              <label className="campo check">
                <input type="checkbox" checked={esAcopio} onChange={(e) => setEsAcopio(e.target.checked)} />
                Es un acopio
              </label>
              {esAcopio && (
                <p className="mut" style={{ marginTop: 4 }}>
                  El cliente paga esto ahora, pero se lo lleva de a poco más adelante. El stock queda
                  reservado (no se le puede vender a otro) pero sigue en el depósito hasta cada retiro —
                  se descuenta recién cuando hagas el remito de esa entrega.
                </p>
              )}
            </div>
          )}

          <div className="pos-seccion">
            <label className="pos-label">Descuento</label>
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
              <div style={{ display: "flex", gap: 6 }}>
                <select value={descTipo} onChange={(e) => setDescTipo(e.target.value as any)} style={{ maxWidth: 130 }}>
                  <option value="monto">Monto ($)</option>
                  <option value="porcentaje">Porcentaje (%)</option>
                </select>
                <input className="num" type="number" step="0.01" min={0} value={descValor} onChange={(e) => setDescValor(e.target.value)} placeholder="0" style={{ maxWidth: 160 }} />
              </div>
            )}
          </div>

          <div className="pos-seccion">
            <Campo label="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
          </div>
        </div>

        <div className="pos-cierre-pie">
          <div className="btv-cifras">
            <span className="mut">
              {items.length} producto{items.length === 1 ? "" : "s"}
              {descuento > 0 && ` · Desc. ${pesos(descuento)}`}
            </span>
            <span className="btv-total">{pesos(total)}</span>
          </div>
          <button className="btn primario pos-finalizar" disabled={guardando || total < 0 || items.length === 0} onClick={() => enviar(false)}>
            {guardando ? "Guardando…" : "Confirmar venta"}
          </button>
        </div>
        </aside>
      </div>

      {/* Fija abajo de todo, sólo en el celular (en escritorio el panel de
          al lado ya deja el total y el botón siempre a la vista). */}
      <div className="barra-total-venta pos-barra-movil">
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

      {confirmarVaciar && (
        <Confirmar
          mensaje={`¿Vaciar el ticket? Se van a borrar ${items.length} producto${items.length === 1 ? "" : "s"} cargado${items.length === 1 ? "" : "s"}.`}
          textoConfirmar="Vaciar" peligro
          onSi={vaciar} onNo={() => setConfirmarVaciar(false)}
        />
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

    </div>
  );
}
