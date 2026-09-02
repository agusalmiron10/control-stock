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

interface Reng { herramienta_id: string; cantidad: string; precio: string }

const MEDIOS = ["efectivo", "transferencia", "cheque", "otro"];

export function NuevaVenta() {
  const clientesQ = useCarga<any>(() => api.get("/api/clientes"), []);
  const herrQ = useCarga<any>(() => api.get("/api/herramientas"), []);
  const [clientesExtra, setClientesExtra] = useState<any[]>([]);
  const clientes = useMemo(() => [...(clientesQ.data?.clientes ?? []), ...clientesExtra], [clientesQ.data, clientesExtra]);

  const [clienteId, setClienteId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [tipoPrecio, setTipoPrecio] = useState<"minorista" | "mayorista">("minorista");
  const [items, setItems] = useState<Reng[]>([{ herramienta_id: "", cantidad: "1", precio: "" }]);
  const [descTipo, setDescTipo] = useState<"monto" | "porcentaje">("monto");
  const [descValor, setDescValor] = useState("");
  const [nota, setNota] = useState("");
  const [pagoModo, setPagoModo] = useState<"nada" | "total" | "mitad" | "libre">("nada");
  const [pagoLibre, setPagoLibre] = useState("");
  const [pagoMedio, setPagoMedio] = useState("efectivo");
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
   * Suma un producto a la venta. Si ya está en un renglón le sube la cantidad
   * (que es lo que uno espera al pasar dos veces el mismo artículo por el
   * lector) y si no, ocupa el primer renglón vacío antes de crear uno nuevo.
   */
  function sumarProducto(h: any) {
    setItems((arr) => {
      const i = arr.findIndex((it) => it.herramienta_id === h.id);
      if (i >= 0) {
        return arr.map((it, j) => (j === i ? { ...it, cantidad: String((Number(it.cantidad) || 0) + 1) } : it));
      }
      const reng: Reng = { herramienta_id: h.id, cantidad: "1", precio: String(aPesos(precioDe(h))) };
      const vacio = arr.findIndex((it) => !it.herramienta_id);
      if (vacio >= 0) return arr.map((it, j) => (j === vacio ? reng : it));
      return [...arr, reng];
    });
  }

  function agregarReng() { setItems((a) => [...a, { herramienta_id: "", cantidad: "1", precio: "" }]); }
  function quitarReng(i: number) { setItems((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a)); }

  function validar(): string | null {
    if (!clienteId) return "Elegí un cliente.";
    const validos = items.filter((it) => it.herramienta_id && Number(it.cantidad) > 0);
    if (validos.length === 0) return "Agregá al menos un renglón con herramienta y cantidad.";
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
        <div className="tabla-wrap">
          <table className="tabla">
            <thead>
              <tr><th style={{ minWidth: 200 }}>Herramienta</th><th className="num">Cantidad</th>
                <th className="num">Precio unit. ($)</th><th className="num">Subtotal</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const cant = Number(it.cantidad) || 0;
                const sub = cant * aCentavos(it.precio || "0");
                const h = hMap.get(it.herramienta_id);
                const falta = h && cant > h.stock;
                return (
                  <tr key={i}>
                    <td>
                      <select value={it.herramienta_id} onChange={(e) => elegirHerramienta(i, e.target.value)}>
                        <option value="">Elegí…</option>
                        {herramientas.map((hh) => <option key={hh.id} value={hh.id}>{hh.codigo} — {hh.nombre} (stock {hh.stock})</option>)}
                      </select>
                      {falta && <div className="stock-bajo" style={{ fontSize: 12 }}>Stock insuficiente (hay {numero(h!.stock)})</div>}
                    </td>
                    <td className="num" style={{ maxWidth: 110 }}>
                      <input className="num" type="number" min={1} value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} />
                    </td>
                    <td className="num" style={{ maxWidth: 140 }}>
                      <input className="num" type="number" step="0.01" min={0} value={it.precio} onChange={(e) => setItem(i, { precio: e.target.value })} />
                    </td>
                    <td className="num">{pesos(sub)}</td>
                    <td className="acc"><button className="btn chico" onClick={() => quitarReng(i)} disabled={items.length === 1}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-body">
          <button className="btn" onClick={agregarReng}>+ Agregar renglón</button>
        </div>
      </div>

      <div className="card">
        <h2>Descuento, pago y nota</h2>
        <div className="card-body">
          <div className="fila">
            <Campo label="Descuento">
              <div style={{ display: "flex", gap: 6 }}>
                <select value={descTipo} onChange={(e) => setDescTipo(e.target.value as any)} style={{ maxWidth: 130 }}>
                  <option value="monto">Monto ($)</option>
                  <option value="porcentaje">Porcentaje (%)</option>
                </select>
                <input className="num" type="number" step="0.01" min={0} value={descValor} onChange={(e) => setDescValor(e.target.value)} placeholder="0" />
              </div>
            </Campo>
            <Campo label="Pago en este momento">
              <select value={pagoModo} onChange={(e) => setPagoModo(e.target.value as any)}>
                <option value="nada">No paga nada ahora</option>
                <option value="total">Paga el total</option>
                <option value="mitad">Paga la mitad</option>
                <option value="libre">Monto libre</option>
              </select>
            </Campo>
            {pagoModo === "libre" && (
              <Campo label="Monto del pago ($)">
                <input className="num" type="number" step="0.01" min={0} value={pagoLibre} onChange={(e) => setPagoLibre(e.target.value)} />
              </Campo>
            )}
            {pagoModo !== "nada" && (
              <Campo label="Medio de pago">
                <select value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)}>
                  {MEDIOS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Campo>
            )}
          </div>
          <Campo label="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
        </div>
      </div>

      {faltantes.length > 0 && (
        <div className="pill-alerta">
          Ojo con el stock: {faltantes.join("; ")}. Podés vender igual (quedará en rojo).
        </div>
      )}

      <div className="card">
        <div className="card-body totales-envio">
          <div className="dt-list" style={{ gridTemplateColumns: "auto auto" }}>
            <dt>Subtotal</dt><dd>{pesos(subtotal)}</dd>
            <dt>Descuento</dt><dd>{pesos(descuento)}</dd>
            <dt><b>Total</b></dt><dd><b>{pesos(total)}</b></dd>
            {pagoModo !== "nada" && (<><dt>Paga ahora</dt><dd className="saldado">{pesos(pagoCent)}</dd>
              <dt>Queda debiendo</dt><dd className={total - pagoCent > 0 ? "debe" : "saldado"}>{pesos(Math.max(0, total - pagoCent))}</dd></>)}
          </div>
          <button className="btn primario" style={{ fontSize: 16, padding: "10px 20px" }} disabled={guardando || total < 0} onClick={() => enviar(false)}>
            {guardando ? "Guardando…" : "Confirmar venta"}
          </button>
        </div>
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
