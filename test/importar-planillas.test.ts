/**
 * El lector de planillas ajenas. Cada caso de acá es una lista de proveedor
 * de verdad: el que la manda no sabe ni le importa cómo se llaman las
 * columnas en este sistema, así que el que se tiene que adaptar es el
 * sistema.
 */
import { describe, it, expect } from "vitest";
import { parsear } from "../web/src/components/ImportarProductos";

describe("parsear: listas que llegan como llegan", () => {
  it("la lista más común de todas: producto y precio, sin código", () => {
    const r = parsear("Producto,Precio\nMartillo carpintero,12500\nPinza universal,8900");
    expect(r.aviso).toBeUndefined();
    expect(r.filas).toEqual([
      { nombre: "Martillo carpintero", precio: "12500" },
      { nombre: "Pinza universal", precio: "8900" },
    ]);
    expect(r.columnas).toEqual(["Nombre", "Precio"]);
  });

  it("se saltea el título y las filas en blanco de arriba", () => {
    const r = parsear("LISTA DE PRECIOS - MAYO 2026\n\nCodigo,Nombre,Precio\nA1,Martillo,12500");
    expect(r.filas).toEqual([{ codigo: "A1", nombre: "Martillo", precio: "12500" }]);
  });

  it('entiende "P. UNITARIO" y "DESCRIPCION" en mayúsculas', () => {
    const r = parsear("ARTICULO,DESCRIPCION,P. UNITARIO\n001,Martillo,12500");
    expect(r.filas).toEqual([{ codigo: "001", nombre: "Martillo", precio: "12500" }]);
  });

  it('"Artículo" es el nombre cuando no hay descripción al lado', () => {
    const r = parsear("Articulo,Precio\nMartillo,12500");
    expect(r.filas).toEqual([{ nombre: "Martillo", precio: "12500" }]);
  });

  it('entiende "Importe" y "Valor" como precio', () => {
    expect(parsear("Detalle,Importe\nMartillo,12500").filas[0]).toEqual({ nombre: "Martillo", precio: "12500" });
    expect(parsear("Descripcion,Valor\nMartillo,12500").filas[0]).toEqual({ nombre: "Martillo", precio: "12500" });
  });

  it("acepta punto y coma y tabulación además de coma", () => {
    expect(parsear("Producto;Precio\nMartillo;12500").filas[0]).toEqual({ nombre: "Martillo", precio: "12500" });
    expect(parsear("Producto\tPrecio\nMartillo\t12500").filas[0]).toEqual({ nombre: "Martillo", precio: "12500" });
  });

  it("no se corta por una coma adentro de un nombre entre comillas", () => {
    const r = parsear('Producto,Precio\n"Caño 1/2"", negro",12500');
    expect(r.filas[0]).toEqual({ nombre: 'Caño 1/2", negro', precio: "12500" });
  });

  it("avisa cuando no hay ninguna columna que parezca el nombre", () => {
    const r = parsear("Fecha,Total\n01/05/2026,12500");
    expect(r.filas).toHaveLength(0);
    expect(r.aviso).toContain("nombre del producto");
  });

  it("avisa si no reconoció ninguna columna de precio, sin frenar la importación", () => {
    const r = parsear("Producto,Deposito\nMartillo,Galpon 2");
    expect(r.aviso).toBeUndefined();
    expect(r.columnas).toEqual(["Nombre"]);
    expect(r.columnas).not.toContain("Precio");
  });

  it("toma la primera de dos columnas de precio repetidas", () => {
    const r = parsear("Producto,Precio,Precio\nMartillo,12500,999");
    expect(r.filas[0]).toEqual({ nombre: "Martillo", precio: "12500" });
  });

  it("reconoce todas las columnas opcionales juntas", () => {
    const r = parsear("Codigo,Nombre,Precio,Mayorista,Costo,Stock,Rubro,IVA\nA1,Martillo,12500,11000,8000,7,Herramientas,21");
    expect(r.filas[0]).toEqual({
      codigo: "A1", nombre: "Martillo", precio: "12500", precio_mayor: "11000",
      costo: "8000", stock: "7", rubro: "Herramientas", iva_porcentaje: "21",
    });
  });

  it('"Herramienta" es el nombre del producto (la propia palabra del sistema)', () => {
    // Caso real: un usuario probó el importador con una planilla que usa el
    // mismo vocabulario que la app ("Herramienta" es el título de la
    // página). Antes esto no reconocía NINGUNA columna: ni el nombre ni el
    // precio, y la importación se rechazaba entera.
    const r = parsear('Código,Herramienta,Precio ($)\nHR-001,Martillo de carpintero,"$15,500.00"');
    expect(r.aviso).toBeUndefined();
    expect(r.columnas).toEqual(["Código", "Nombre", "Precio"]);
    expect(r.filas[0]).toEqual({ codigo: "HR-001", nombre: "Martillo de carpintero", precio: "$15,500.00" });
  });

  it('un encabezado con aclaración entre paréntesis — "Precio ($)", "Stock (unidades)" — se reconoce igual', () => {
    const r = parsear("Producto,Precio ($),Stock (unidades),Costo (u$s)\nMartillo,12500,8,9000");
    expect(r.columnas).toEqual(["Nombre", "Precio", "Stock", "Costo"]);
    expect(r.filas[0]).toEqual({ nombre: "Martillo", precio: "12500", stock: "8", costo: "9000" });
  });

  it("el vocabulario propio del negocio (Prenda, Artículo…) también cuenta como nombre de columna", () => {
    // Es lo que useVocab() le pasa a parsear() desde el componente: la
    // palabra que ESE negocio eligió para lo que vende, no sólo las fijas.
    const r = parsear("Codigo,Prenda,Precio\nA1,Remera básica,8900", ["prenda", "prendas"]);
    expect(r.filas[0]).toEqual({ codigo: "A1", nombre: "Remera básica", precio: "8900" });
  });

  it("saca la decoración alrededor del nombre de columna: dos puntos, guiones, asteriscos", () => {
    const r = parsear("* Código *,- Nombre -,Precio:\nA1,Martillo,12500");
    expect(r.columnas).toEqual(["Código", "Nombre", "Precio"]);
    expect(r.filas[0]).toEqual({ codigo: "A1", nombre: "Martillo", precio: "12500" });
  });

  it("encabezados en inglés (listas de proveedores del exterior)", () => {
    const r = parsear("SKU,Name,Price,Qty,Cost\nA1,Hammer,12500,10,8000");
    expect(r.filas[0]).toEqual({ codigo: "A1", nombre: "Hammer", precio: "12500", stock: "10", costo: "8000" });
  });

  it("encuentra el encabezado más abajo de la fila 15 si el membrete es largo", () => {
    const membrete = Array.from({ length: 20 }, (_, i) => `Línea de membrete ${i + 1}`).join("\n");
    const r = parsear(`${membrete}\nCodigo,Nombre,Precio\nA1,Martillo,12500`);
    expect(r.aviso).toBeUndefined();
    expect(r.filas).toEqual([{ codigo: "A1", nombre: "Martillo", precio: "12500" }]);
  });
});
