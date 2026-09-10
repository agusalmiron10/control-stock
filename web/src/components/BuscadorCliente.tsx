import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";

/**
 * Selector de cliente con búsqueda por nombre (no solo desplegable) y alta
 * rápida si no existe. Se usa en los formularios de escritorio de Nueva
 * venta y Nuevo presupuesto.
 *
 * La lista se dibuja con un portal directo a <body>, posicionada "a mano"
 * según dónde está el input. Si se dibujara adentro del formulario normal,
 * quedaría atrapada dentro de la tarjeta (`.card { overflow: hidden }`, para
 * que las esquinas redondeadas no se vean rotas) y se cortaba a mitad de
 * lista en vez de flotar por encima de todo, como corresponde a un
 * desplegable.
 */
export function BuscadorCliente({
  clientes,
  clienteId,
  onElegir,
  onClienteNuevo,
}: {
  clientes: any[];
  clienteId: string;
  onElegir: (id: string) => void;
  onClienteNuevo: (cliente: { id: string; nombre: string }) => void;
}) {
  const [buscar, setBuscar] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const cliente = clientes.find((c) => c.id === clienteId);
  const q = buscar.trim().toLowerCase();
  const filtrados = (q ? clientes.filter((c) => c.nombre.toLowerCase().includes(q)) : clientes).slice(0, 40);
  const hayExacto = clientes.some((c) => c.nombre.toLowerCase() === q);

  // Se recalcula cada vez que se abre (el formulario puede haber scrolleado
  // o cambiado de tamaño desde la última vez).
  useLayoutEffect(() => {
    if (!abierto || !inputRef.current) return;
    const actualizar = () => {
      const r = inputRef.current!.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    actualizar();
    window.addEventListener("scroll", actualizar, true);
    window.addEventListener("resize", actualizar);
    return () => {
      window.removeEventListener("scroll", actualizar, true);
      window.removeEventListener("resize", actualizar);
    };
  }, [abierto]);

  function elegir(id: string) {
    onElegir(id);
    setBuscar("");
    setAbierto(false);
    setError(null);
  }

  async function agregarNuevo() {
    const nombre = buscar.trim();
    if (!nombre) return;
    setCreando(true);
    setError(null);
    try {
      const r = await api.post<any>("/api/clientes", { nombre });
      onClienteNuevo({ id: r.id, nombre });
      elegir(r.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="bc">
      {cliente ? (
        <div className="bc-elegido" role="button" tabIndex={0}
          onClick={() => { onElegir(""); setAbierto(true); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onElegir(""); setAbierto(true); } }}>
          <span>{cliente.nombre}</span>
          <button type="button" className="btn chico" onClick={(e) => { e.stopPropagation(); onElegir(""); setAbierto(true); }}>Cambiar</button>
        </div>
      ) : (
        <input
          ref={inputRef}
          value={buscar}
          onChange={(e) => { setBuscar(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          placeholder="Buscar cliente por nombre…"
          autoComplete="off"
        />
      )}
      {abierto && !cliente && pos && createPortal(
        <>
          <div className="bc-fondo" onClick={() => setAbierto(false)} />
          <div className="bc-lista" style={{ top: pos.top, left: pos.left, width: pos.width }}>
            {filtrados.map((c) => (
              <button type="button" key={c.id} className="bc-opcion" onClick={() => elegir(c.id)}>{c.nombre}</button>
            ))}
            {filtrados.length === 0 && <p className="mut bc-vacio">Sin coincidencias.</p>}
            {q && !hayExacto && (
              <button type="button" className="bc-opcion bc-nuevo" disabled={creando} onClick={agregarNuevo}>
                {creando ? "Agregando…" : `+ Agregar "${buscar.trim()}" como cliente nuevo`}
              </button>
            )}
          </div>
        </>,
        document.body
      )}
      {error && <p className="error-box" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}
