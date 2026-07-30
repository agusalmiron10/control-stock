import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { pesos } from "../format";
import { navegar } from "../lib/router";

interface Resultados {
  clientes: { id: string; nombre: string }[];
  herramientas: { id: string; codigo: string; nombre: string }[];
  ventas: { id: string; numero: number; total: number; cliente_id: string; cliente_nombre: string }[];
}

const VACIO: Resultados = { clientes: [], herramientas: [], ventas: [] };

/** Buscador único (sidebar): clientes, herramientas o N° de venta. */
export function BuscadorGlobal() {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [resultados, setResultados] = useState<Resultados>(VACIO);
  const [buscando, setBuscando] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const texto = q.trim();
    if (texto.length < 2) { setResultados(VACIO); setBuscando(false); return; }
    setBuscando(true);
    timer.current = setTimeout(() => {
      api.get<Resultados>(`/api/buscar?q=${encodeURIComponent(texto)}`)
        .then(setResultados)
        .catch(() => setResultados(VACIO))
        .finally(() => setBuscando(false));
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  function ir(path: string) {
    navegar(path);
    setQ("");
    setAbierto(false);
    setResultados(VACIO);
  }

  const hayResultados = resultados.clientes.length + resultados.herramientas.length + resultados.ventas.length > 0;

  return (
    <div className="bg-buscador">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        placeholder="🔎 Buscar…"
        autoComplete="off"
      />
      {abierto && q.trim().length >= 2 && (
        <>
          <div className="bg-fondo" onClick={() => setAbierto(false)} />
          <div className="bg-lista">
            {buscando && <p className="mut bg-vacio">Buscando…</p>}
            {!buscando && !hayResultados && <p className="mut bg-vacio">Sin resultados.</p>}
            {resultados.clientes.length > 0 && (
              <>
                <div className="bg-grupo">Clientes</div>
                {resultados.clientes.map((c) => (
                  <button key={c.id} className="bg-opcion" onClick={() => ir(`/clientes/${c.id}`)}>{c.nombre}</button>
                ))}
              </>
            )}
            {resultados.herramientas.length > 0 && (
              <>
                <div className="bg-grupo">Herramientas</div>
                {resultados.herramientas.map((h) => (
                  <button key={h.id} className="bg-opcion" onClick={() => ir(`/herramientas/${h.id}`)}>
                    {h.codigo} — {h.nombre}
                  </button>
                ))}
              </>
            )}
            {resultados.ventas.length > 0 && (
              <>
                <div className="bg-grupo">Ventas</div>
                {resultados.ventas.map((v) => (
                  <button key={v.id} className="bg-opcion" onClick={() => ir(`/clientes/${v.cliente_id}`)}>
                    Venta #{v.numero} — {v.cliente_nombre} ({pesos(v.total)})
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
