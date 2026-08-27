import { useEffect, useState } from "react";

export interface Filtros {
  buscar: string;
  desde: string;
  hasta: string;
}

export const FILTROS_VACIOS: Filtros = { buscar: "", desde: "", hasta: "" };

/** Devuelve los filtros como query string, salteando los vacíos. */
export function comoQuery(f: Filtros, extra?: Record<string, string>): string {
  const qs = new URLSearchParams();
  if (f.buscar.trim()) qs.set("buscar", f.buscar.trim());
  if (f.desde) qs.set("desde", f.desde);
  if (f.hasta) qs.set("hasta", f.hasta);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) qs.set(k, v);
  return qs.toString();
}

/** Atajos de fecha: es lo que se usa en la práctica, no elegir dos fechas. */
function rango(dias: number): { desde: string; hasta: string } {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - dias);
  return { desde: desde.toISOString().slice(0, 10), hasta: hoy.toISOString().slice(0, 10) };
}

interface Props {
  valor: Filtros;
  onCambiar: (f: Filtros) => void;
  /** Qué se busca, para el texto de ayuda del campo. */
  placeholder?: string;
  /** Contenido extra a la derecha (por ejemplo, un filtro de estado). */
  children?: React.ReactNode;
}

/**
 * Barra de filtros compartida por las pantallas de comprobantes (facturas,
 * presupuestos y en su momento remitos), para que se busquen todas igual.
 *
 * La búsqueda se manda con un retraso corto: si se disparara en cada tecla,
 * escribir "Corralón" serían ocho consultas y la lista parpadearía.
 */
export function FiltroComprobantes({ valor, onCambiar, placeholder, children }: Props) {
  const [texto, setTexto] = useState(valor.buscar);

  useEffect(() => { setTexto(valor.buscar); }, [valor.buscar]);

  useEffect(() => {
    if (texto === valor.buscar) return;
    const t = setTimeout(() => onCambiar({ ...valor, buscar: texto }), 350);
    return () => clearTimeout(t);
  }, [texto]);

  const hayFiltro = valor.buscar.trim() !== "" || valor.desde !== "" || valor.hasta !== "";

  return (
    <div className="barra-filtros">
      <div className="campo" style={{ flex: "1 1 240px", minWidth: 200 }}>
        <label>Buscar</label>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={placeholder ?? "Nombre del cliente o número"}
        />
      </div>

      <div className="campo">
        <label>Desde</label>
        <input type="date" value={valor.desde} onChange={(e) => onCambiar({ ...valor, desde: e.target.value })} />
      </div>
      <div className="campo">
        <label>Hasta</label>
        <input type="date" value={valor.hasta} onChange={(e) => onCambiar({ ...valor, hasta: e.target.value })} />
      </div>

      <div className="campo">
        <label>&nbsp;</label>
        <div className="btn-grupo">
          <button className="btn chico" onClick={() => onCambiar({ ...valor, ...rango(30) })}>30 días</button>
          <button className="btn chico" onClick={() => onCambiar({ ...valor, ...rango(365) })}>1 año</button>
          {hayFiltro && (
            <button className="btn chico" onClick={() => onCambiar(FILTROS_VACIOS)}>Limpiar</button>
          )}
        </div>
      </div>

      {children}
    </div>
  );
}
