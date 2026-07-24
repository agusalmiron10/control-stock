import qrcode from "qrcode-generator";

/**
 * QR en SVG puro (sin canvas, sin llamadas de red — todo se genera en el
 * navegador). Se usa en los comprobantes y presupuestos para volver directo
 * a ese pedido dentro de la app escaneándolo con el celu.
 */
export function QRCode({ value, size = 92 }: { value: string; size?: number }) {
  const qr = qrcode(0, "M"); // 0 = tamaño automático según el largo del texto
  qr.addData(value);
  qr.make();

  const cantidad = qr.getModuleCount();
  const celda = size / cantidad;
  const modulos: { x: number; y: number }[] = [];
  for (let fila = 0; fila < cantidad; fila++) {
    for (let col = 0; col < cantidad; col++) {
      if (qr.isDark(fila, col)) modulos.push({ x: col * celda, y: fila * celda });
    }
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Código QR">
      <rect x={0} y={0} width={size} height={size} fill="#fff" />
      <g fill="#111827">
        {modulos.map((m, i) => (
          <rect key={i} x={m.x} y={m.y} width={celda + 0.5} height={celda + 0.5} />
        ))}
      </g>
    </svg>
  );
}
