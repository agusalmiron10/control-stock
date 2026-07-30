import { useState } from "react";
import { api } from "../api";

/**
 * Selector de cliente con búsqueda por nombre (no solo desplegable) y alta
 * rápida si no existe. Se usa en los formularios de escritorio de Nueva
 * venta y Nuevo presupuesto.
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

  const cliente = clientes.find((c) => c.id === clienteId);
  const q = buscar.trim().toLowerCase();
  const filtrados = (q ? clientes.filter((c) => c.nombre.toLowerCase().includes(q)) : clientes).slice(0, 40);
  const hayExacto = clientes.some((c) => c.nombre.toLowerCase() === q);

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
        <div className="bc-elegido">
          <span>{cliente.nombre}</span>
          <button type="button" className="btn chico" onClick={() => { onElegir(""); setAbierto(true); }}>Cambiar</button>
        </div>
      ) : (
        <input
          value={buscar}
          onChange={(e) => { setBuscar(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          placeholder="Buscar cliente por nombre…"
          autoComplete="off"
        />
      )}
      {abierto && !cliente && (
        <>
          <div className="bc-fondo" onClick={() => setAbierto(false)} />
          <div className="bc-lista">
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
        </>
      )}
      {error && <p className="error-box" style={{ marginTop: 6 }}>{error}</p>}
    </div>
  );
}
