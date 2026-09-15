// Gráfico de barras liviano (sin librerías externas), consistente con la
// paleta sobria de la app. Pensado para series cortas (6-24 puntos).
//
// Hecho con flex y no con SVG: un <svg> con viewBox fijo se escala entero
// para entrar, así que en una pantalla ancha las barras quedaban como una
// islita de 420px centrada en una tarjeta de 1600, con todo vacío a los
// lados. Con flex, cada columna se reparte el ancho que haya.

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

  return (
    // El mínimo por columna es lo que separa los dos casos: con 6 meses el
    // gráfico entra y las columnas se reparten todo el ancho; con 54 días
    // (la deuda diaria) se pasa del ancho y scrollea de costado, que es
    // preferible a amontonar 54 fechas ilegibles.
    <div className="bar-chart-wrap">
      <div className="bar-chart" style={{ height: alto, minWidth: datos.length * 44 }}>
        {datos.map((d) => (
          <div className="bc-col" key={d.label} title={`${d.label}: ${formato(d.valor)}`}>
            <div className="bc-valor">{d.valor > 0 ? etiquetar(d.valor) : ""}</div>
            <div className="bc-area">
              <div
                className="bc-barra"
                style={{ height: `${Math.max(2, (d.valor / max) * 100)}%`, background: color }}
              />
            </div>
            <div className="bc-label">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
