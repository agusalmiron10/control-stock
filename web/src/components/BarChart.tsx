// Gráfico de barras liviano en SVG puro (sin librerías externas), consistente
// con la paleta sobria de la app. Pensado para series cortas (6-24 puntos).

interface Punto { label: string; valor: number }

export function BarChart({
  datos,
  color = "var(--acento)",
  formato,
  formatoEtiqueta,
  alto = 160,
}: {
  datos: Punto[];
  color?: string;
  /** Formato completo, usado en el tooltip al pasar el mouse. */
  formato: (n: number) => string;
  /** Formato corto para la etiqueta arriba de cada barra (por defecto, igual a `formato`). */
  formatoEtiqueta?: (n: number) => string;
  alto?: number;
}) {
  if (datos.length === 0) return null;
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const etiquetar = formatoEtiqueta ?? formato;
  const ancho = 70;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${datos.length * ancho} ${alto}`} style={{ width: "100%", height: alto, minWidth: datos.length * 55 }}>
        {datos.map((d, i) => {
          const h = Math.max(2, (d.valor / max) * (alto - 34));
          const x = i * ancho + 13;
          const y = alto - 22 - h;
          return (
            <g key={d.label}>
              <title>{`${d.label}: ${formato(d.valor)}`}</title>
              <rect x={x} y={y} width={44} height={h} rx={3} fill={color} />
              <text x={x + 22} y={y - 6} textAnchor="middle" fontSize="11" fontFamily="var(--mono)" fill="var(--texto)">
                {d.valor > 0 ? etiquetar(d.valor) : ""}
              </text>
              <text x={x + 22} y={alto - 6} textAnchor="middle" fontSize="11" fill="var(--texto-suave)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
