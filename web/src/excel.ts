// Generación de archivos .xlsx en el navegador (no consume CPU del Worker).
// Uso el motor de SheetJS con soporte de estilos (xlsx-js-style, API idéntica a xlsx),
// para poder poner encabezados en negrita además de anchos, moneda y fechas.
import * as XLSX from "xlsx-js-style";
import { api } from "./api";
import { nombreArchivo, hoyISO } from "./format";

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
export async function exportarCliente(clienteId: number): Promise<void> {
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
