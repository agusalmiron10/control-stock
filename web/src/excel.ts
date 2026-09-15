// Generación de archivos .xlsx en el navegador (no consume CPU del Worker).
// Uso el motor de SheetJS con soporte de estilos (xlsx-js-style, API idéntica a xlsx),
// para poder poner encabezados en negrita además de anchos, moneda y fechas.
import * as XLSX from "xlsx-js-style";
import { api } from "./api";
import { nombreArchivo, hoyISO, hora } from "./format";

type Tipo = "text" | "money" | "int" | "date";
interface Col {
  key: string;
  header: string;
  width: number;
  tipo?: Tipo;
}

const FMT_MONEDA = '"$"\\ #,##0.00';
const FMT_ENTERO = "#,##0";
const FMT_FECHA = "dd/mm/yyyy";

const estiloHeader = {
  font: { bold: true, color: { rgb: "111827" } },
  fill: { fgColor: { rgb: "E5E7EB" } },
  alignment: { horizontal: "left", vertical: "center" },
  border: { bottom: { style: "thin", color: { rgb: "9CA3AF" } } },
};

function fechaCell(iso: string | null | undefined): XLSX.CellObject {
  if (!iso) return { t: "s", v: "" };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return { t: "s", v: String(iso) };
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return { t: "d", v: d, z: FMT_FECHA };
}

function celda(valor: unknown, tipo: Tipo): XLSX.CellObject {
  if (tipo === "money") {
    const n = (Number(valor) || 0) / 100;
    return { t: "n", v: n, z: FMT_MONEDA, s: { alignment: { horizontal: "right" } } };
  }
  if (tipo === "int") {
    return { t: "n", v: Number(valor) || 0, z: FMT_ENTERO, s: { alignment: { horizontal: "right" } } };
  }
  if (tipo === "date") return fechaCell(valor as string);
  return { t: "s", v: valor == null ? "" : String(valor) };
}

/** Construye una hoja a partir de columnas + filas. */
function hoja(cols: Col[], filas: Record<string, unknown>[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const nCols = cols.length;
  const nRows = filas.length + 1;

  // Encabezados.
  cols.forEach((c, j) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: j });
    ws[addr] = { t: "s", v: c.header, s: estiloHeader };
  });

  // Datos.
  filas.forEach((fila, i) => {
    cols.forEach((c, j) => {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: j });
      ws[addr] = celda(fila[c.key], c.tipo ?? "text");
    });
  });

  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, nRows - 1), c: nCols - 1 } });
  ws["!cols"] = cols.map((c) => ({ wch: c.width }));
  ws["!rows"] = [{ hpt: 20 }];
  return ws;
}

/** Hoja de resumen tipo campo/valor. */
function hojaResumen(titulo: string, pares: { campo: string; valor: unknown; tipo?: Tipo }[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  ws[XLSX.utils.encode_cell({ r: 0, c: 0 })] = { t: "s", v: titulo, s: { font: { bold: true, sz: 13 } } };
  pares.forEach((p, i) => {
    const r = i + 2;
    ws[XLSX.utils.encode_cell({ r, c: 0 })] = { t: "s", v: p.campo, s: { font: { bold: true } } };
    ws[XLSX.utils.encode_cell({ r, c: 1 })] = celda(p.valor, p.tipo ?? "text");
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: pares.length + 2, c: 1 } });
  ws["!cols"] = [{ wch: 24 }, { wch: 30 }];
  return ws;
}

function descargar(wb: XLSX.WorkBook, prefijo: string): void {
  XLSX.writeFile(wb, nombreArchivo(prefijo));
}

// ── A. Excel de un cliente ──────────────────────────────────
export async function exportarCliente(clienteId: string): Promise<void> {
  const d = await api.get<any>(`/api/export/cliente/${clienteId}`);
  const wb = XLSX.utils.book_new();
  const cl = d.cliente;
  const r = d.resumen;

  XLSX.utils.book_append_sheet(
    wb,
    hojaResumen(`Cliente: ${cl.nombre}`, [
      { campo: "Localidad", valor: cl.localidad ?? "—" },
      { campo: "Teléfono", valor: cl.telefono ?? "—" },
      { campo: "Email", valor: cl.email ?? "—" },
      { campo: "Total comprado", valor: r.total_comprado, tipo: "money" },
      { campo: "Total pagado", valor: r.total_pagado, tipo: "money" },
      { campo: "Saldo (debe)", valor: Math.max(0, r.saldo), tipo: "money" },
      { campo: "Saldo a favor", valor: r.saldo_a_favor, tipo: "money" },
      { campo: "Última compra", valor: r.ultima_compra, tipo: "date" },
      { campo: "Último pago", valor: r.ultimo_pago, tipo: "date" },
    ]),
    "Resumen"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "numero", header: "N°", width: 6, tipo: "int" },
        { key: "total", header: "Total", width: 14, tipo: "money" },
        { key: "pagado", header: "Pagado", width: 14, tipo: "money" },
        { key: "saldo", header: "Saldo", width: 14, tipo: "money" },
        { key: "estado", header: "Estado", width: 12 },
        { key: "nota", header: "Nota", width: 30 },
      ],
      d.ventas
    ),
    "Ventas"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "venta", header: "Venta N°", width: 9, tipo: "int" },
        { key: "herramienta", header: "Herramienta", width: 30 },
        { key: "cantidad", header: "Cant.", width: 8, tipo: "int" },
        { key: "precio_unitario", header: "Precio unit.", width: 14, tipo: "money" },
        { key: "subtotal", header: "Subtotal", width: 14, tipo: "money" },
      ],
      d.detalle
    ),
    "Detalle"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "monto", header: "Monto", width: 14, tipo: "money" },
        { key: "medio", header: "Medio", width: 14 },
        { key: "aplicado_a", header: "Aplicado a", width: 16 },
        { key: "nota", header: "Nota", width: 30 },
      ],
      d.pagos
    ),
    "Pagos"
  );

  descargar(wb, `cliente-${cl.nombre.replace(/\s+/g, "_")}`);
}

const LETRA_FACTURA: Record<number, string> = { 1: "A", 6: "B", 11: "C", 3: "A (NC)", 8: "B (NC)", 13: "C (NC)" };

/** Cómo mostrar el estado de facturación de una venta en una sola celda de texto. */
function facturacionTexto(v: { factura_estado: string | null; factura_tipo: number | null }): string {
  if (!v.factura_estado) return "Sin facturar";
  const letra = v.factura_tipo != null ? LETRA_FACTURA[v.factura_tipo] ?? "?" : "?";
  if (v.factura_estado === "autorizada") return `Factura ${letra}`;
  if (v.factura_estado === "rechazada") return `Rechazada (Factura ${letra})`;
  if (v.factura_estado === "huerfano") return `Sin confirmar (Factura ${letra})`;
  return `Pendiente (Factura ${letra})`;
}

/**
 * Excel de la lista de ventas tal como está en pantalla — mismo filtro que
 * el usuario tenga puesto en ese momento (por eso recibe las filas ya
 * traídas, no vuelve a pedirlas), con el estado de facturación explícito:
 * es justo el dato que "Ventas" no muestra en una columna propia, y es lo
 * primero que un contador va a pedir.
 */
export function exportarVentasLista(
  ventas: any[],
  filtro: { desde?: string; hasta?: string; cliente?: string }
): void {
  const wb = XLSX.utils.book_new();

  const resumen: { campo: string; valor: unknown; tipo?: Tipo }[] = [
    { campo: "Ventas listadas", valor: ventas.length, tipo: "int" },
    { campo: "Total", valor: ventas.reduce((s, v) => s + v.total, 0), tipo: "money" },
    { campo: "Pagado", valor: ventas.reduce((s, v) => s + v.pagado, 0), tipo: "money" },
    { campo: "Saldo", valor: ventas.reduce((s, v) => s + v.saldo, 0), tipo: "money" },
    { campo: "Facturadas", valor: ventas.filter((v) => v.factura_estado === "autorizada").length, tipo: "int" },
    { campo: "Sin facturar", valor: ventas.filter((v) => !v.factura_estado).length, tipo: "int" },
  ];
  if (filtro.desde) resumen.push({ campo: "Desde", valor: filtro.desde, tipo: "date" });
  if (filtro.hasta) resumen.push({ campo: "Hasta", valor: filtro.hasta, tipo: "date" });
  if (filtro.cliente) resumen.push({ campo: "Cliente", valor: filtro.cliente });
  resumen.push({ campo: "Generado", valor: hoyISO(), tipo: "date" });

  XLSX.utils.book_append_sheet(wb, hojaResumen("Ventas", resumen), "Resumen");

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "numero", header: "N°", width: 7, tipo: "int" },
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "hora", header: "Hora", width: 8 },
        { key: "cliente", header: "Cliente", width: 26 },
        { key: "total", header: "Total", width: 14, tipo: "money" },
        { key: "pagado", header: "Pagado", width: 14, tipo: "money" },
        { key: "saldo", header: "Saldo", width: 14, tipo: "money" },
        { key: "estado", header: "Estado", width: 12 },
        { key: "facturacion", header: "Facturación", width: 22 },
        { key: "nota", header: "Nota", width: 26 },
      ],
      ventas.map((v) => ({
        numero: v.numero,
        fecha: v.fecha,
        hora: hora(v.creado_en),
        cliente: v.cliente_nombre,
        total: v.total,
        pagado: v.pagado,
        saldo: v.saldo,
        estado: v.estado,
        facturacion: facturacionTexto(v),
        nota: v.nota ?? "",
      }))
    ),
    "Ventas"
  );

  descargar(wb, "ventas");
}

// ── B. Excel general ────────────────────────────────────────
export async function exportarGeneral(desde?: string, hasta?: string): Promise<void> {
  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);
  const d = await api.get<any>(`/api/export/general${qs.toString() ? `?${qs}` : ""}`);
  const wb = XLSX.utils.book_new();
  const r = d.resumen;

  XLSX.utils.book_append_sheet(
    wb,
    hojaResumen("Resumen del negocio", [
      { campo: "Total a cobrar", valor: r.total_a_cobrar, tipo: "money" },
      { campo: "Saldo a favor (total)", valor: r.saldo_a_favor_total, tipo: "money" },
      { campo: "Total comprado (histórico)", valor: r.total_comprado, tipo: "money" },
      { campo: "Total pagado (histórico)", valor: r.total_pagado, tipo: "money" },
      { campo: "Clientes", valor: r.clientes, tipo: "int" },
      { campo: "Herramientas", valor: r.herramientas, tipo: "int" },
      { campo: "Valor del stock (a costo)", valor: r.valor_stock_costo, tipo: "money" },
      { campo: "Rango desde", valor: r.desde, tipo: r.desde ? "date" : "text" },
      { campo: "Rango hasta", valor: r.hasta, tipo: r.hasta ? "date" : "text" },
      { campo: "Generado", valor: hoyISO(), tipo: "date" },
    ]),
    "Resumen"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "nombre", header: "Cliente", width: 26 },
        { key: "localidad", header: "Localidad", width: 16 },
        { key: "telefono", header: "Teléfono", width: 14 },
        { key: "total_comprado", header: "Total comprado", width: 15, tipo: "money" },
        { key: "total_pagado", header: "Total pagado", width: 15, tipo: "money" },
        { key: "debe", header: "Debe", width: 14, tipo: "money" },
        { key: "saldo_a_favor", header: "A favor", width: 14, tipo: "money" },
        { key: "cantidad_ventas", header: "Ventas", width: 8, tipo: "int" },
        { key: "ultima_compra", header: "Última compra", width: 13, tipo: "date" },
        { key: "ultimo_pago", header: "Último pago", width: 13, tipo: "date" },
      ],
      d.clientes
    ),
    "Clientes"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "numero", header: "N°", width: 6, tipo: "int" },
        { key: "cliente", header: "Cliente", width: 24 },
        { key: "subtotal", header: "Subtotal", width: 14, tipo: "money" },
        { key: "descuento", header: "Descuento", width: 13, tipo: "money" },
        { key: "total", header: "Total", width: 14, tipo: "money" },
        { key: "pagado", header: "Pagado", width: 14, tipo: "money" },
        { key: "saldo", header: "Saldo", width: 14, tipo: "money" },
        { key: "estado", header: "Estado", width: 11 },
        { key: "nota", header: "Nota", width: 26 },
      ],
      d.ventas
    ),
    "Ventas"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "venta", header: "Venta N°", width: 9, tipo: "int" },
        { key: "cliente", header: "Cliente", width: 24 },
        { key: "herramienta", header: "Herramienta", width: 28 },
        { key: "cantidad", header: "Cant.", width: 8, tipo: "int" },
        { key: "precio_unitario", header: "Precio unit.", width: 14, tipo: "money" },
        { key: "subtotal", header: "Subtotal", width: 14, tipo: "money" },
      ],
      d.detalle
    ),
    "Detalle de ventas"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "cliente", header: "Cliente", width: 24 },
        { key: "monto", header: "Monto", width: 14, tipo: "money" },
        { key: "medio", header: "Medio", width: 14 },
        { key: "aplicado_a", header: "Aplicado a", width: 16 },
        { key: "nota", header: "Nota", width: 26 },
      ],
      d.pagos
    ),
    "Pagos"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "codigo", header: "Código", width: 12 },
        { key: "nombre", header: "Herramienta", width: 30 },
        { key: "rubro", header: "Rubro", width: 16 },
        { key: "precio", header: "Precio minorista", width: 15, tipo: "money" },
        { key: "precio_mayor", header: "Precio mayorista", width: 15, tipo: "money" },
        { key: "stock", header: "Stock", width: 8, tipo: "int" },
        { key: "stock_minimo", header: "Stock mín.", width: 10, tipo: "int" },
        { key: "valor_stock", header: "Valor stock", width: 15, tipo: "money" },
        { key: "unidades_vendidas", header: "U. vendidas", width: 11, tipo: "int" },
      ],
      d.herramientas
    ),
    "Herramientas"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "herramienta", header: "Herramienta", width: 30 },
        { key: "tipo", header: "Tipo", width: 12 },
        { key: "cantidad", header: "Cantidad", width: 10, tipo: "int" },
        { key: "stock_resultante", header: "Stock result.", width: 12, tipo: "int" },
        { key: "referencia", header: "Referencia", width: 26 },
      ],
      d.movimientos
    ),
    "Movimientos de stock"
  );

  descargar(wb, "control-stock-general");
}

// ── C. Excel de lista de precios ────────────────────────────
export async function exportarPrecios(): Promise<void> {
  const d = await api.get<any>(`/api/export/precios`);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "rubro", header: "Rubro", width: 16 },
        { key: "codigo", header: "Código", width: 12 },
        { key: "herramienta", header: "Herramienta", width: 34 },
        { key: "precio", header: "Precio minorista", width: 16, tipo: "money" },
        { key: "precio_mayor", header: "Precio mayorista", width: 16, tipo: "money" },
        { key: "actualizado", header: "Actualizado", width: 13, tipo: "date" },
        { key: "stock", header: "Stock", width: 8, tipo: "int" },
      ],
      d.lista
    ),
    "Lista de precios"
  );

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "herramienta", header: "Herramienta", width: 30 },
        { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
        { key: "precio_anterior", header: "Precio anterior", width: 15, tipo: "money" },
        { key: "precio_nuevo", header: "Precio nuevo", width: 15, tipo: "money" },
        { key: "diferencia", header: "Diferencia", width: 14, tipo: "money" },
        { key: "variacion_pct", header: "Variación %", width: 11 },
        { key: "motivo", header: "Motivo", width: 28 },
      ],
      d.historial
    ),
    "Historial de precios"
  );

  descargar(wb, "lista-de-precios");
}

// ── D. Excel con todos los clientes ─────────────────────────
export async function exportarClientesTodos(): Promise<void> {
  const d = await api.get<any>(`/api/clientes?incluirArchivados=1`);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "nombre", header: "Nombre", width: 28 },
        { key: "localidad", header: "Localidad", width: 16 },
        { key: "direccion", header: "Dirección", width: 24 },
        { key: "telefono", header: "Teléfono", width: 16 },
        { key: "email", header: "Email", width: 22 },
        { key: "total_comprado", header: "Total comprado", width: 15, tipo: "money" },
        { key: "total_pagado", header: "Total pagado", width: 15, tipo: "money" },
        { key: "saldo", header: "Saldo", width: 15, tipo: "money" },
        { key: "notas", header: "Notas", width: 28 },
        { key: "estado", header: "Estado", width: 12 },
      ],
      (d.clientes ?? []).map((c: any) => ({ ...c, estado: c.activo ? "Activo" : "Archivado" }))
    ),
    "Clientes"
  );

  descargar(wb, "clientes");
}

// ── E. Excel solo con datos personales (sin montos) ─────────
export async function exportarClientesContacto(): Promise<void> {
  const d = await api.get<any>(`/api/clientes?incluirArchivados=1`);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "nombre", header: "Nombre", width: 28 },
        { key: "localidad", header: "Localidad", width: 16 },
        { key: "direccion", header: "Dirección", width: 24 },
        { key: "telefono", header: "Teléfono", width: 16 },
        { key: "email", header: "Email", width: 22 },
      ],
      (d.clientes ?? []).filter((c: any) => c.activo)
    ),
    "Clientes"
  );

  descargar(wb, "clientes-contacto");
}

// ── G. Informe del período (ventas, gastos y resultado) ─────
//
// Es el reporte que responde "¿cómo me fue del día X al día Y?": lo vendido,
// lo que costó la mercadería, lo que se gastó fuera de mercadería y lo que
// quedó. Se arma con las dos fuentes que ya existen —rentabilidad y
// gastos— en vez de un endpoint nuevo, así nunca puede decir algo distinto
// de lo que muestra la pantalla de Reportes.

export interface DatosInforme {
  resumen: any;
  productos: any[];
  gastos: any[];
  gastosPorCategoria: { categoria: string; monto: number }[];
  desde: string;
  hasta: string;
}

/** Junta lo que hace falta para el informe, en Excel o en PDF. */
export async function traerInforme(desde: string, hasta: string): Promise<DatosInforme> {
  const qs = new URLSearchParams();
  if (desde) qs.set("desde", desde);
  if (hasta) qs.set("hasta", hasta);
  const sufijo = qs.toString() ? `?${qs}` : "";

  const rent = await api.get<any>(`/api/reportes/rentabilidad${sufijo}`);
  // El detalle de gastos sólo existe si el negocio tiene el módulo; sin él
  // la ruta responde 404 y el informe sale igual, sin esa parte.
  let gastos: any[] = [];
  try {
    const g = await api.get<any>(`/api/gastos${sufijo}`);
    gastos = g.gastos ?? [];
  } catch {
    gastos = [];
  }

  return {
    resumen: rent.resumen,
    productos: (rent.productos ?? []).filter((p: any) => p.unidades_vendidas > 0),
    gastos,
    gastosPorCategoria: rent.gastos_por_categoria ?? [],
    desde,
    hasta,
  };
}

export async function exportarInforme(desde: string, hasta: string): Promise<void> {
  const d = await traerInforme(desde, hasta);
  const r = d.resumen;
  const wb = XLSX.utils.book_new();

  const resumen: { campo: string; valor: unknown; tipo?: Tipo }[] = [
    { campo: "Desde", valor: d.desde || "Desde el principio", tipo: d.desde ? "date" : "text" },
    { campo: "Hasta", valor: d.hasta || "Hasta hoy", tipo: d.hasta ? "date" : "text" },
    { campo: "Vendido", valor: r.total_vendido, tipo: "money" },
    { campo: "Costo de la mercadería", valor: r.costo_estimado, tipo: "money" },
    { campo: "Ganancia sobre lo vendido", valor: r.ganancia_estimada, tipo: "money" },
    { campo: "Margen %", valor: r.margen_pct, tipo: "text" },
  ];
  // El resultado sólo se escribe si el negocio lleva gastos: si no, sería
  // una ganancia que ignora alquiler y sueldos con nombre de resultado.
  if (r.resultado != null) {
    resumen.push(
      { campo: "Gastos del período", valor: r.gastos, tipo: "money" },
      { campo: "RESULTADO", valor: r.resultado, tipo: "money" }
    );
  }
  resumen.push(
    { campo: "Valor del stock (a costo)", valor: r.valor_stock_costo, tipo: "money" },
    { campo: "Generado", valor: hoyISO(), tipo: "date" }
  );
  XLSX.utils.book_append_sheet(wb, hojaResumen("Informe del período", resumen), "Resumen");

  XLSX.utils.book_append_sheet(
    wb,
    hoja(
      [
        { key: "nombre", header: "Producto", width: 30 },
        { key: "rubro", header: "Rubro", width: 16 },
        { key: "unidades_vendidas", header: "U. vendidas", width: 12, tipo: "int" },
        { key: "vendido", header: "Vendido", width: 14, tipo: "money" },
        { key: "costo_total", header: "Costo", width: 14, tipo: "money" },
        { key: "ganancia", header: "Ganancia", width: 14, tipo: "money" },
      ],
      d.productos
    ),
    "Ventas por producto"
  );

  if (d.gastos.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      hoja(
        [
          { key: "fecha", header: "Fecha", width: 12, tipo: "date" },
          { key: "categoria", header: "Categoría", width: 18 },
          { key: "descripcion", header: "Descripción", width: 34 },
          { key: "medio_pago", header: "Medio", width: 14 },
          { key: "monto", header: "Monto", width: 14, tipo: "money" },
        ],
        d.gastos
      ),
      "Gastos"
    );
  }

  descargar(wb, "informe");
}
