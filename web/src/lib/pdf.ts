// Genera un PDF de un presupuesto, con el mismo contenido que PresupuestoPDF
// (el que se imprime con window.print()) pero armado a mano con jsPDF, para
// poder entregarlo como archivo real — así se puede compartir directo por
// WhatsApp con compartirArchivo(), en vez de depender del diálogo de
// impresión del navegador (que no da un archivo con el que hacer nada).
//
// jsPDF pesa bastante: se importa dinámicamente adentro de la función, así
// que nadie paga ese peso hasta el momento en que realmente genera un PDF
// (mismo criterio que ya se usa en el proyecto para recharts/react-joyride).
import { pesos, fecha } from "../format";
import { negocio } from "./negocio";
import { conReintento } from "./cargarModulo";
import type { DatosInforme } from "../excel";

const ANCHO_A4 = 210;
const MARGEN = 15;
const DERECHA = ANCHO_A4 - MARGEN;
/** Renglón del pie de página (la hoja A4 mide 297mm de alto). */
const PIE_Y = 285;
/** Hasta acá se puede dibujar contenido sin pisar el pie. */
const LIMITE_INFERIOR = PIE_Y - 8;

/** "data:image/jpeg;base64,..." → "JPEG" (lo que pide jsPDF.addImage). */
function formatoDeDataUri(dataUri: string): string {
  const m = /^data:image\/(\w+);base64,/.exec(dataUri);
  const ext = (m?.[1] ?? "jpeg").toUpperCase();
  return ext === "JPG" ? "JPEG" : ext;
}

export async function generarPdfPresupuesto(data: any): Promise<Blob> {
  const { jsPDF } = await conReintento(() => import("jspdf"));
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const neg = negocio();
  const p = data.presupuesto;
  const items = data.items ?? [];

  let y = 18;

  // ── Encabezado: logo + negocio (izq), "PRESUPUESTO N°…" (der) ──
  let xTexto = MARGEN;
  if (neg.logo) {
    try {
      doc.addImage(neg.logo, formatoDeDataUri(neg.logo), MARGEN, y - 6, 16, 16);
      xTexto = MARGEN + 20;
    } catch {
      // Formato de imagen que jsPDF no reconoce: se sigue sin logo, no rompe el PDF.
    }
  }
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
  doc.text(neg.nombre, xTexto, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  if (neg.rubro) doc.text(neg.rubro, xTexto, y + 5);
  doc.text(`Tel: ${neg.telefono ?? "—"} · ${neg.instagram ?? ""}`, xTexto, y + 10);

  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(13);
  doc.text("PRESUPUESTO", DERECHA, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(`N° ${String(p.numero).padStart(6, "0")}`, DERECHA, y + 5, { align: "right" });
  doc.setFontSize(9).setTextColor(110);
  doc.text(fecha(p.fecha), DERECHA, y + 10, { align: "right" });

  y += 20;
  doc.setDrawColor(220).line(MARGEN, y, DERECHA, y);
  y += 8;

  // ── Cliente ──
  doc.setTextColor(20).setFontSize(10);
  doc.text(`Cliente: ${p.cliente_nombre}`, MARGEN, y);
  y += 6;
  if (p.valido_hasta) {
    doc.text(`Válido hasta: ${fecha(p.valido_hasta)}`, MARGEN, y);
    y += 6;
  }
  y += 2;

  // ── Trabajo a medida (sin renglones): la descripción libre ES el producto ──
  if (items.length === 0 && p.nota) {
    doc.setFontSize(10);
    const lineas = doc.splitTextToSize(p.nota, DERECHA - MARGEN);
    doc.text(lineas, MARGEN, y);
    y += lineas.length * 5 + 6;

    if (p.croquis) {
      try {
        const props = doc.getImageProperties(p.croquis);
        const anchoMax = DERECHA - MARGEN;
        const altoMax = 90; // no dejar que una foto vertical se coma toda la hoja
        let w = anchoMax;
        let h = (props.height / props.width) * w;
        if (h > altoMax) { h = altoMax; w = (props.width / props.height) * h; }
        if (y + h > LIMITE_INFERIOR) { doc.addPage(); y = 20; }
        doc.addImage(p.croquis, formatoDeDataUri(p.croquis), MARGEN, y, w, h);
        y += h + 8;
      } catch {
        // Formato de imagen que jsPDF no reconoce: se sigue sin la foto, no rompe el PDF.
      }
    }
  } else if (items.length > 0) {
    // ── Tabla de renglones, armada a mano (sin plugin de autotable) ──
    doc.setFillColor(240, 240, 240).rect(MARGEN, y, DERECHA - MARGEN, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(80);
    doc.text("Cant.", MARGEN + 2, y + 5);
    doc.text("Detalle", MARGEN + 20, y + 5);
    doc.text("P. unit.", DERECHA - 38, y + 5, { align: "right" });
    doc.text("Subtotal", DERECHA - 2, y + 5, { align: "right" });
    y += 11;
    doc.setFont("helvetica", "normal").setTextColor(20);
    for (const it of items) {
      if (y > LIMITE_INFERIOR) {
        doc.addPage();
        y = 20;
      }
      doc.text(String(it.cantidad), MARGEN + 2, y);
      const nombre = String(it.nombre_herramienta);
      doc.text(nombre.length > 55 ? nombre.slice(0, 54) + "…" : nombre, MARGEN + 20, y);
      doc.text(pesos(it.precio_unitario), DERECHA - 38, y, { align: "right" });
      doc.text(pesos(it.subtotal), DERECHA - 2, y, { align: "right" });
      y += 6;
    }
    y += 4;
  }

  // El bloque de cierre (línea + totales + nota + atendido) no se puede
  // partir al medio: si no entra en lo que queda de hoja, empieza en una
  // nueva. Sin esto, un presupuesto de ~33 renglones terminaba con el TOTAL
  // pisando el pie de página y la nota cortada por el borde del papel.
  const altoNota = items.length > 0 && p.nota ? doc.splitTextToSize(`Nota: ${p.nota}`, DERECHA - MARGEN).length * 5 + 4 : 0;
  const altoCierre = 8 + 6 + (p.descuento > 0 ? 6 : 0) + 12 + altoNota + (p.atendido_por_nombre ? 6 : 0);
  if (y + altoCierre > LIMITE_INFERIOR) {
    doc.addPage();
    y = 20;
  }

  doc.setDrawColor(220).line(MARGEN, y, DERECHA, y);
  y += 8;

  // ── Totales ──
  doc.setFontSize(10).setTextColor(80);
  doc.text("Subtotal", DERECHA - 38, y, { align: "right" });
  doc.setTextColor(20).text(pesos(p.subtotal), DERECHA - 2, y, { align: "right" });
  y += 6;
  if (p.descuento > 0) {
    doc.setTextColor(80).text("Descuento", DERECHA - 38, y, { align: "right" });
    // Guion común, NO el signo menos Unicode (−): la fuente estándar del PDF
    // no lo tiene y sale dibujado como un carácter raro.
    doc.setTextColor(20).text(`- ${pesos(p.descuento)}`, DERECHA - 2, y, { align: "right" });
    y += 6;
  }
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(20);
  doc.text("TOTAL", DERECHA - 38, y, { align: "right" });
  doc.text(pesos(p.total), DERECHA - 2, y, { align: "right" });
  y += 12;

  if (items.length > 0 && p.nota) {
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(80);
    const lineas = doc.splitTextToSize(`Nota: ${p.nota}`, DERECHA - MARGEN);
    doc.text(lineas, MARGEN, y);
    y += lineas.length * 5 + 4;
  }

  if (p.atendido_por_nombre) {
    doc.setFontSize(8).setTextColor(130);
    doc.text(`Atendido por ${p.atendido_por_nombre}`, MARGEN, y);
  }

  // El pie va en TODAS las hojas, no sólo en la última: si el presupuesto
  // ocupa dos carillas, la primera también tiene que decir de quién es.
  const hojas = doc.getNumberOfPages();
  for (let i = 1; i <= hojas; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(150);
    doc.text(`Presupuesto sujeto a cambios de precio sin previo aviso — ${neg.nombre}`, MARGEN, PIE_Y);
    if (hojas > 1) doc.text(`Hoja ${i} de ${hojas}`, DERECHA, PIE_Y, { align: "right" });
  }

  return doc.output("blob");
}

/**
 * Informe del período en PDF: el mismo contenido que el Excel, pero para
 * imprimir o mandar. Una hoja con el resumen arriba (lo vendido, los gastos
 * y lo que quedó) y abajo el detalle por producto y por categoría de gasto.
 */
export async function generarPdfInforme(d: DatosInforme): Promise<Blob> {
  const { jsPDF } = await conReintento(() => import("jspdf"));
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const neg = negocio();
  const r = d.resumen;
  let y = 18;

  // ── Encabezado ──
  let xTexto = MARGEN;
  if (neg.logo) {
    try {
      doc.addImage(neg.logo, formatoDeDataUri(neg.logo), MARGEN, y - 6, 16, 16);
      xTexto = MARGEN + 20;
    } catch {
      // Formato que jsPDF no reconoce: sigue sin logo.
    }
  }
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
  doc.text(neg.nombre, xTexto, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  if (neg.rubro) doc.text(neg.rubro, xTexto, y + 5);

  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(13);
  doc.text("INFORME DEL PERÍODO", DERECHA, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  const rango = d.desde || d.hasta
    ? `${d.desde ? fecha(d.desde) : "el principio"} — ${d.hasta ? fecha(d.hasta) : "hoy"}`
    : "Todo el historial";
  doc.text(rango, DERECHA, y + 6, { align: "right" });

  y += 20;
  doc.setDrawColor(210).line(MARGEN, y, DERECHA, y);
  y += 9;

  // ── Resumen: dos columnas, concepto a la izquierda y monto a la derecha ──
  const linea = (campo: string, valor: string, fuerte = false) => {
    doc.setFont("helvetica", fuerte ? "bold" : "normal").setFontSize(fuerte ? 11 : 10);
    doc.setTextColor(fuerte ? 20 : 80);
    doc.text(campo, MARGEN, y);
    doc.text(valor, DERECHA, y, { align: "right" });
    y += fuerte ? 8 : 6.5;
  };

  linea("Vendido", pesos(r.total_vendido));
  linea("Costo de la mercadería", `- ${pesos(r.costo_estimado)}`);
  linea("Ganancia sobre lo vendido", pesos(r.ganancia_estimada), true);
  doc.setFontSize(8).setTextColor(130);
  doc.text(`margen ${r.margen_pct}%`, DERECHA, y - 4, { align: "right" });

  if (r.resultado != null) {
    y += 2;
    linea("Gastos del período", `- ${pesos(r.gastos)}`);
    doc.setDrawColor(210).line(MARGEN, y - 2, DERECHA, y - 2);
    y += 3;
    linea("RESULTADO", pesos(r.resultado), true);
  }

  // ── Gastos por categoría ──
  if (d.gastosPorCategoria.length > 0) {
    y += 5;
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(20);
    doc.text("Gastos por categoría", MARGEN, y);
    y += 6;
    for (const g of d.gastosPorCategoria) {
      if (y > LIMITE_INFERIOR) break;
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(80);
      doc.text(g.categoria, MARGEN + 2, y);
      doc.text(pesos(g.monto), DERECHA, y, { align: "right" });
      y += 5.5;
    }
  }

  // ── Productos que más ganancia dejaron ──
  if (d.productos.length > 0 && y < LIMITE_INFERIOR - 20) {
    y += 5;
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(20);
    doc.text("Productos con más ganancia", MARGEN, y);
    y += 6;
    doc.setFontSize(8).setTextColor(130);
    doc.text("Producto", MARGEN + 2, y);
    doc.text("U.", MARGEN + 105, y, { align: "right" });
    doc.text("Vendido", MARGEN + 140, y, { align: "right" });
    doc.text("Ganancia", DERECHA, y, { align: "right" });
    y += 5;
    for (const p of d.productos.slice(0, 20)) {
      if (y > LIMITE_INFERIOR) break;
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(80);
      // El nombre se recorta para no pisar la columna de unidades.
      doc.text(String(p.nombre).slice(0, 52), MARGEN + 2, y);
      doc.text(String(p.unidades_vendidas), MARGEN + 105, y, { align: "right" });
      doc.text(pesos(p.vendido), MARGEN + 140, y, { align: "right" });
      doc.text(pesos(p.ganancia), DERECHA, y, { align: "right" });
      y += 5.5;
    }
  }

  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(140);
  doc.text(
    `${neg.nombre} · Informe generado el ${fecha(new Date().toISOString().slice(0, 10))}`,
    MARGEN,
    PIE_Y
  );

  return doc.output("blob");
}

/**
 * Lista de precios en PDF: código, producto, rubro y precio. Pensada para
 * compartir por WhatsApp con compartirArchivo() — un archivo de verdad, no
 * el texto plano que arma waListaDePrecios (que además se corta cuando hay
 * muchos productos).
 */
export async function generarPdfListaPrecios(
  herramientas: any[],
  tipo: "minorista" | "mayorista",
  vocab: { singular: string; plural: string }
): Promise<Blob> {
  const { jsPDF } = await conReintento(() => import("jspdf"));
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const neg = negocio();

  const conPrecio = herramientas
    .filter((h) => h.activo && (tipo === "mayorista" ? h.precio_mayor : h.precio) > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const X_PRODUCTO = MARGEN + 2;
  const X_RUBRO = MARGEN + 110;
  const X_PRECIO = DERECHA;

  function dibujarEncabezadoTabla(y: number): number {
    doc.setFillColor(240, 240, 240).rect(MARGEN, y, DERECHA - MARGEN, 7, "F");
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(80);
    doc.text(vocab.singular, X_PRODUCTO, y + 5);
    doc.text("Rubro", X_RUBRO, y + 5);
    doc.text("Precio", X_PRECIO, y + 5, { align: "right" });
    return y + 11;
  }

  let y = 18;

  // ── Encabezado: logo + negocio (izq), "LISTA DE PRECIOS" (der) ──
  let xTexto = MARGEN;
  if (neg.logo) {
    try {
      doc.addImage(neg.logo, formatoDeDataUri(neg.logo), MARGEN, y - 6, 16, 16);
      xTexto = MARGEN + 20;
    } catch {
      // Formato de imagen que jsPDF no reconoce: se sigue sin logo.
    }
  }
  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
  doc.text(neg.nombre, xTexto, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  if (neg.rubro) doc.text(neg.rubro, xTexto, y + 5);
  doc.text(`Tel: ${neg.telefono ?? "—"} · ${neg.instagram ?? ""}`, xTexto, y + 10);

  doc.setTextColor(20).setFont("helvetica", "bold").setFontSize(13);
  doc.text("LISTA DE PRECIOS", DERECHA, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(110);
  doc.text(tipo === "mayorista" ? "Mayorista" : "Minorista", DERECHA, y + 5, { align: "right" });
  doc.text(fecha(new Date().toISOString().slice(0, 10)), DERECHA, y + 10, { align: "right" });

  y += 20;
  doc.setDrawColor(220).line(MARGEN, y, DERECHA, y);
  y += 8;

  if (conPrecio.length === 0) {
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(110);
    doc.text("Todavía no hay productos con precio cargado.", MARGEN, y);
  } else {
    y = dibujarEncabezadoTabla(y);
    doc.setFont("helvetica", "normal").setTextColor(20);
    for (const h of conPrecio) {
      if (y > LIMITE_INFERIOR) {
        doc.addPage();
        y = dibujarEncabezadoTabla(20);
        doc.setFont("helvetica", "normal").setTextColor(20);
      }
      doc.setFontSize(9);
      const nombre = String(h.nombre);
      doc.text(nombre.length > 58 ? nombre.slice(0, 57) + "…" : nombre, X_PRODUCTO, y);
      doc.text(h.rubro ? String(h.rubro).slice(0, 22) : "—", X_RUBRO, y);
      doc.text(pesos(tipo === "mayorista" ? h.precio_mayor : h.precio), X_PRECIO, y, { align: "right" });
      y += 6;
    }
  }

  const hojas = doc.getNumberOfPages();
  for (let i = 1; i <= hojas; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(150);
    doc.text(
      `${neg.nombre} · ${conPrecio.length} ${(conPrecio.length === 1 ? vocab.singular : vocab.plural).toLowerCase()} · ${fecha(new Date().toISOString().slice(0, 10))}`,
      MARGEN,
      PIE_Y
    );
    if (hojas > 1) doc.text(`Hoja ${i} de ${hojas}`, DERECHA, PIE_Y, { align: "right" });
  }

  return doc.output("blob");
}
