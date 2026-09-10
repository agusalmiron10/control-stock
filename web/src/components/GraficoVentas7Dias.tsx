import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { diaCorto, fecha, pesos, pesosCompacto } from "../format";

export interface VentaDia {
  fecha: string; // "YYYY-MM-DD"
  total: number; // centavos
  cant: number;
}

/** El cuadrito que aparece al pasar el mouse por una barra. */
function TooltipVenta({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: VentaDia = payload[0].payload;
  return (
    <div className="card" style={{ padding: "8px 12px", boxShadow: "var(--sombra-media)" }}>
      <div style={{ fontWeight: 600 }}>{fecha(d.fecha)}</div>
      <div>{pesos(d.total)}</div>
      <div className="mut">{d.cant} {d.cant === 1 ? "venta" : "ventas"}</div>
    </div>
  );
}

/**
 * Facturación de los últimos 7 días, en barras. Vive en el Panel: la idea es
 * que de un vistazo se note si hoy vendió más o menos que el resto de la
 * semana, sin tener que ir a Reportes a buscarlo.
 */
export function GraficoVentas7Dias({ datos }: { datos: VentaDia[] }) {
  const hayVentas = datos.some((d) => d.total > 0);

  return (
    <div className="card">
      <div className="card-header">Ventas de los últimos 7 días</div>
      <div className="card-body" style={{ height: 220 }}>
        {!hayVentas ? (
          <p className="mut" style={{ margin: 0 }}>Todavía no hay ventas esta semana.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--borde)" />
              <XAxis
                dataKey="fecha"
                tickFormatter={(f) => diaCorto(f)}
                tick={{ fill: "var(--texto-suave)", fontSize: 12 }}
                axisLine={{ stroke: "var(--borde)" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => pesosCompacto(v)}
                tick={{ fill: "var(--texto-suave)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <Tooltip content={<TooltipVenta />} cursor={{ fill: "var(--acento-suave)" }} />
              <Bar dataKey="total" fill="var(--acento)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
