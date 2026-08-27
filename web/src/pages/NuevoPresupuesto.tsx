import { useMemo, useState } from "react";
import { api } from "../api";
import { pesos, aCentavos, aPesos, hoyISO } from "../format";
import { Cargando, Error, Campo, useCarga } from "../components/ui";
import { BuscadorCliente } from "../components/BuscadorCliente";
import { navegar } from "../lib/router";

interface Reng { herramienta_id: string; cantidad: string; precio: string }

export function NuevoPresupuesto() {
  const clientesQ = useCarga<any>(() => api.get("/api/clientes"), []);
  const herrQ = useCarga<any>(() => api.get("/api/herramientas"), []);
  const [clientesExtra, setClientesExtra] = useState<any[]>([]);
  const clientes = useMemo(() => [...(clientesQ.data?.clientes ?? []), ...clientesExtra], [clientesQ.data, clientesExtra]);

  const [clienteId, setClienteId] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [validoHasta, setValidoHasta] = useState("");
  const [tipoPrecio, setTipoPrecio] = useState<"minorista" | "mayorista">("minorista");
  const [items, setItems] = useState<Reng[]>([{ herramienta_id: "", cantidad: "1", precio: "" }]);
  const [descTipo, setDescTipo] = useState<"monto" | "porcentaje">("monto");
  const [descValor, setDescValor] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const herramientas: any[] = herrQ.data?.herramientas ?? [];
  const hMap = useMemo(() => new Map(herramientas.map((h) => [String(h.id), h])), [herramientas]);

  const subtotal = items.reduce((acc, it) => acc + (Number(it.cantidad) || 0) * aCentavos(it.precio || "0"), 0);
  const descuentoCent = descTipo === "monto" ? aCentavos(descValor || "0") : Math.round((subtotal * (Number(descValor) || 0)) / 100);
  const descuento = Math.min(Math.max(0, descuentoCent), subtotal);
  const total = subtotal - descuento;

  function precioDe(h: any): number {
    if (!h) return 0;
    return tipoPrecio === "mayorista" && h.precio_mayor > 0 ? h.precio_mayor : h.precio;
  }
  function setItem(i: number, patch: Partial<Reng>) {
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  }
  function elegirHerramienta(i: number, hid: string) {
    const h = hMap.get(hid);
    setItem(i, { herramienta_id: hid, precio: h ? String(aPesos(precioDe(h))) : "" });
  }
  function agregarReng() { setItems((a) => [...a, { herramienta_id: "", cantidad: "1", precio: "" }]); }
  function quitarReng(i: number) { setItems((a) => (a.length > 1 ? a.filter((_, j) => j !== i) : a)); }

  async function enviar() {
    setError(null);
    if (!clienteId) { setError("Elegí un cliente."); return; }
    const validos = items.filter((it) => it.herramienta_id && Number(it.cantidad) > 0);
    if (validos.length === 0) { setError("Agregá al menos un renglón."); return; }

    setGuardando(true);
    const body: any = {
      cliente_id: clienteId,
      fecha,
      valido_hasta: validoHasta || undefined,
      items: validos.map((it) => ({ herramienta_id: it.herramienta_id, cantidad: Number(it.cantidad), precio_unitario: aCentavos(it.precio || "0") })),
      nota,
    };
    if (descValor && Number(descValor) > 0) body.descuento = { tipo: descTipo, valor: descTipo === "monto" ? aCentavos(descValor) : Number(descValor) };

    try {
      const r = await api.post<any>("/api/presupuestos", body);
      navegar(`/presupuestos/${r.id}`);
    } catch (err: any) {
      setError(err.message);
      setGuardando(false);
    }
  }

  if (clientesQ.cargando || herrQ.cargando) return <Cargando />;

  return (
    <div>
      <div className="encabezado-seccion">
        <div>
          <a href="#/presupuestos">← Presupuestos</a>
          <h1 style={{ marginTop: 4 }}>Nuevo presupuesto</h1>
        </div>
      </div>

      <Error msg={error} />

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
            </Campo>
            <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
            <Campo label="Válido hasta (opcional)"><input type="date" value={validoHasta} onChange={(e) => setValidoHasta(e.target.value)} /></Campo>
            <Campo label="Lista de precios">
              <select value={tipoPrecio} onChange={(e) => setTipoPrecio(e.target.value as any)}>
                <option value="minorista">Minorista</option>
                <option value="mayorista">Mayorista</option>
              </select>
            </Campo>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Renglones</h2>
        <div className="tabla-wrap solo-escritorio">
          <table className="tabla">
            <thead>
              <tr><th style={{ minWidth: 200 }}>Herramienta</th><th className="num">Cantidad</th><th className="num">Precio unit. ($)</th><th className="num">Subtotal</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const cant = Number(it.cantidad) || 0;
                const sub = cant * aCentavos(it.precio || "0");
                return (
                  <tr key={i}>
                    <td>
                      <select value={it.herramienta_id} onChange={(e) => elegirHerramienta(i, e.target.value)}>
                        <option value="">Elegí…</option>
                        {herramientas.map((hh) => <option key={hh.id} value={hh.id}>{hh.codigo} — {hh.nombre}</option>)}
                      </select>
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

        {/* En celular la tabla de 5 columnas no entra sin scroll horizontal
            (el botón de quitar quedaba fuera de vista) — cada renglón pasa a
            ser una mini-tarjeta con los campos apilados. */}
        <div className="card-body solo-movil reng-lista">
          {items.map((it, i) => {
            const cant = Number(it.cantidad) || 0;
            const sub = cant * aCentavos(it.precio || "0");
            return (
              <div className="reng-card" key={i}>
                <div className="reng-card-fila">
                  <select value={it.herramienta_id} onChange={(e) => elegirHerramienta(i, e.target.value)}>
                    <option value="">Elegí…</option>
                    {herramientas.map((hh) => <option key={hh.id} value={hh.id}>{hh.codigo} — {hh.nombre}</option>)}
                  </select>
                  <button className="btn chico" onClick={() => quitarReng(i)} disabled={items.length === 1}>Quitar</button>
                </div>
                <div className="reng-card-fila">
                  <Campo label="Cantidad"><input className="num" type="number" min={1} value={it.cantidad} onChange={(e) => setItem(i, { cantidad: e.target.value })} /></Campo>
                  <Campo label="Precio unit. ($)"><input className="num" type="number" step="0.01" min={0} value={it.precio} onChange={(e) => setItem(i, { precio: e.target.value })} /></Campo>
                </div>
                <div className="reng-card-subtotal">Subtotal <b>{pesos(sub)}</b></div>
              </div>
            );
          })}
        </div>

        <div className="card-body">
          <button className="btn" onClick={agregarReng}>+ Agregar renglón</button>
        </div>
      </div>

      <div className="card">
        <h2>Descuento y nota</h2>
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
          </div>
          <Campo label="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
        </div>
      </div>

      <div className="card">
        <div className="card-body totales-envio">
          <div className="dt-list" style={{ gridTemplateColumns: "auto auto" }}>
            <dt>Subtotal</dt><dd>{pesos(subtotal)}</dd>
            <dt>Descuento</dt><dd>{pesos(descuento)}</dd>
            <dt><b>Total</b></dt><dd><b>{pesos(total)}</b></dd>
          </div>
          <button className="btn primario" style={{ fontSize: 16, padding: "10px 20px" }} disabled={guardando} onClick={enviar}>
            {guardando ? "Guardando…" : "Crear presupuesto"}
          </button>
        </div>
      </div>
    </div>
  );
}
