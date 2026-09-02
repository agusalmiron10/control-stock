import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { pesos } from "../format";
import { normalizarTexto } from "../format";
import { useLectorDeCodigos } from "../lib/usarLector";

interface Props {
  /** Productos ya cargados, para sugerir mientras se tipea. */
  herramientas: any[];
  /** Se llama con el producto elegido (por lector, por click o por Enter). */
  onElegir: (herramienta: any) => void;
  /** El código escaneado no existe: hay que ofrecer crearlo. */
  onNoEncontrado: (datos: { codigoBarras: string | null; nombre: string }) => void;
}

/**
 * La barra donde vive el mostrador: se escanea o se tipea, y el producto cae
 * en la venta. El foco se queda acá salvo que el cajero lo mueva a propósito.
 */
export function BarraEscaneo({ herramientas, onElegir, onNoEncontrado }: Props) {
  const [texto, setTexto] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // El lector global cubre el caso de que el foco se haya ido a un botón.
  useLectorDeCodigos((codigo) => { void resolverCodigo(codigo); });

  useEffect(() => { input.current?.focus(); }, []);

  /** Pregunta al servidor, porque con miles de productos el navegador no los tiene todos. */
  async function resolverCodigo(codigo: string) {
    setBuscando(true);
    setAviso(null);
    try {
      const r = await api.get<{ herramienta: any }>(`/api/herramientas/por-codigo/${encodeURIComponent(codigo)}`);
      onElegir(r.herramienta);
      setTexto("");
    } catch {
      // No está: en vez de un error muerto, se ofrece crearlo en el acto.
      onNoEncontrado({ codigoBarras: /^[0-9]{6,}$/.test(codigo) ? codigo : null, nombre: /^[0-9]{6,}$/.test(codigo) ? "" : codigo });
      setTexto("");
    } finally {
      setBuscando(false);
      input.current?.focus();
    }
  }

  const q = normalizarTexto(texto.trim());
  const coincidencias = q.length < 2 ? [] : herramientas
    .filter((h) => h.activo && (normalizarTexto(h.nombre).includes(q) || normalizarTexto(h.codigo).includes(q)))
    .slice(0, 6);

  function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    // Una sola coincidencia por nombre: es esa, no hace falta preguntar.
    if (coincidencias.length === 1) { onElegir(coincidencias[0]); setTexto(""); return; }
    void resolverCodigo(t);
  }

  return (
    <div className="barra-escaneo">
      <form onSubmit={alEnviar} className="be-form">
        <span className="be-icono" aria-hidden>▮▮▮</span>
        <input
          ref={input}
          className="be-input"
          value={texto}
          placeholder="Pasá el lector por el código, o escribí el nombre del producto"
          onChange={(e) => { setTexto(e.target.value); setAviso(null); }}
          aria-label="Escanear o buscar producto"
        />
        <button className="btn primario" type="submit" disabled={buscando || !texto.trim()}>
          {buscando ? "Buscando…" : "Agregar"}
        </button>
      </form>

      {aviso && <div className="mut">{aviso}</div>}

      {coincidencias.length > 0 && (
        <div className="be-sugerencias">
          {coincidencias.map((h) => (
            <button key={h.id} type="button" className="be-sug" onClick={() => { onElegir(h); setTexto(""); input.current?.focus(); }}>
              <span className="be-sug-nombre">{h.nombre}</span>
              <span className="mut">{h.codigo} · stock {h.stock}</span>
              <span className="be-sug-precio">{pesos(h.precio)}</span>
            </button>
          ))}
        </div>
      )}

      {q.length >= 2 && coincidencias.length === 0 && (
        <div className="be-sugerencias">
          <button
            type="button"
            className="be-sug be-crear"
            onClick={() => onNoEncontrado({ codigoBarras: null, nombre: texto.trim() })}
          >
            + Crear "{texto.trim()}" y agregarlo a la venta
          </button>
        </div>
      )}
    </div>
  );
}
