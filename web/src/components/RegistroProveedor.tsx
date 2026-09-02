import { useState } from "react";
import { api } from "../api";
import { Cargando, Error, useCarga } from "./ui";

interface Sesion {
  id: string; negocio_id: string; negocio_nombre: string | null; admin: string;
  modo: "lectura" | "edicion"; motivo: string | null;
  iniciada_en: string; cerrada_en: string | null; cambios: number;
}
interface Movimiento {
  id: number; negocio_nombre: string | null; usuario: string; accion: string;
  entidad: string; detalle: string | null; creado_en: string;
  valor_anterior: string | null; valor_nuevo: string | null;
  sesion_soporte: string | null;
}

function cuando(iso: string): string {
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Muestra "de X a Y" leyendo el JSON, sin mostrarle JSON a nadie. */
function comparacion(anterior: string | null, nuevo: string | null): string | null {
  if (!anterior && !nuevo) return null;
  try {
    const a = anterior ? JSON.parse(anterior) : {};
    const b = nuevo ? JSON.parse(nuevo) : {};
    const campos = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    const partes = campos
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map((k) => `${k}: ${fmt(a[k])} → ${fmt(b[k])}`);
    return partes.length ? partes.join(" · ") : null;
  } catch {
    return null;
  }
}
function fmt(v: unknown): string {
  if (v == null) return "—";
  // Los importes se guardan en centavos en toda la base.
  if (typeof v === "number" && v > 999) return `$${(v / 100).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;
  return String(v);
}

/**
 * El registro de lo que pasó: visitas de soporte y acciones sensibles de todos
 * los clientes. Es la única pantalla que cruza negocios.
 */
export function RegistroProveedor() {
  const [pestana, setPestana] = useState<"visitas" | "acciones">("visitas");
  const [accion, setAccion] = useState("");

  return (
    <>
      <div className="btn-grupo" style={{ marginBottom: 14 }}>
        <button className={`btn ${pestana === "visitas" ? "primario" : ""}`} onClick={() => setPestana("visitas")}>
          Mis visitas de soporte
        </button>
        <button className={`btn ${pestana === "acciones" ? "primario" : ""}`} onClick={() => setPestana("acciones")}>
          Acciones sensibles
        </button>
      </div>
      {pestana === "visitas" ? <Visitas /> : <Acciones accion={accion} onAccion={setAccion} />}
    </>
  );
}

function Visitas() {
  const { data, error, cargando } = useCarga<{ sesiones: Sesion[] }>(
    () => api.get("/api/super/soporte/sesiones"),
    []
  );
  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  const lista = data?.sesiones ?? [];
  if (lista.length === 0) {
    return <p className="mut">Todavía no entraste a la cuenta de ningún cliente.</p>;
  }
  return (
    <>
      <p className="mut" style={{ marginTop: 0 }}>
        Cada vez que entrás a la cuenta de un cliente queda registrado acá, con lo que tocaste.
      </p>
      <div className="tabla-wrap">
        <table className="tabla">
          <thead>
            <tr><th>Cuándo</th><th>Cliente</th><th>Modo</th><th className="num">Cambios</th><th>Motivo</th></tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id}>
                <td>{cuando(s.iniciada_en)}{!s.cerrada_en && <span className="badge parcial" style={{ marginLeft: 6 }}>abierta</span>}</td>
                <td>{s.negocio_nombre ?? "—"}</td>
                <td><span className={`badge ${s.modo === "lectura" ? "pagada" : "impaga"}`}>{s.modo === "lectura" ? "Sólo lectura" : "Edición"}</span></td>
                <td className="num">{s.cambios || "—"}</td>
                <td className="mut">{s.motivo ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Acciones({ accion, onAccion }: { accion: string; onAccion: (v: string) => void }) {
  const { data, error, cargando } = useCarga<{ movimientos: Movimiento[]; acciones: string[] }>(
    () => api.get(`/api/super/auditoria${accion ? `?accion=${encodeURIComponent(accion)}` : ""}`),
    [accion]
  );
  if (cargando) return <Cargando />;
  if (error) return <Error msg={error} />;
  const lista = data?.movimientos ?? [];

  return (
    <>
      <div className="campo" style={{ maxWidth: 260, marginBottom: 12 }}>
        <label>Filtrar por acción</label>
        <select value={accion} onChange={(e) => onAccion(e.target.value)}>
          <option value="">Todas</option>
          {(data?.acciones ?? []).map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <div className="tabla-wrap">
        <table className="tabla">
          <thead>
            <tr><th>Cuándo</th><th>Cliente</th><th>Quién</th><th>Qué hizo</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            {lista.map((m) => {
              const cambio = comparacion(m.valor_anterior, m.valor_nuevo);
              return (
                <tr key={m.id}>
                  <td>{cuando(m.creado_en)}</td>
                  <td>{m.negocio_nombre ?? "—"}</td>
                  <td>
                    {m.usuario}
                    {m.sesion_soporte && <span className="badge impaga" style={{ marginLeft: 6 }}>soporte</span>}
                  </td>
                  <td>{m.accion.replace(/_/g, " ")}</td>
                  <td className="mut">
                    {cambio ?? m.detalle ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lista.length === 0 && <p className="mut">No hay movimientos con ese filtro.</p>}
    </>
  );
}
