/**
 * Los dos conversores que leen las celdas de una planilla ajena. Es donde se
 * decide si "12.500" es doce mil quinientos o doce con medio, y si una celda
 * que dice "consultar" es cero o "no lo toques" — dos errores que no se ven
 * hasta que ya están guardados en la base del cliente.
 */
import { describe, it, expect } from "vitest";
import { aCentavos, aEntero } from "../src/routes/herramientas";

describe("aCentavos: precios de una lista de proveedor", () => {
  it("lee enteros y decimales simples", () => {
    expect(aCentavos("1234")).toBe(123400);
    expect(aCentavos("1234,50")).toBe(123450);
    expect(aCentavos("1234.50")).toBe(123450);
    expect(aCentavos("0")).toBe(0);
  });

  it("lee el formato argentino con símbolo y separadores", () => {
    expect(aCentavos("$ 1.234,50")).toBe(123450);
    expect(aCentavos("$2.199,00")).toBe(219900);
    expect(aCentavos("1 234,50")).toBe(123450);
  });

  it("lee el formato en inglés", () => {
    expect(aCentavos("1,234.50")).toBe(123450);
  });

  it("toma el punto como separador de miles cuando deja 3 dígitos", () => {
    // El caso que importaba las listas mil veces más baratas.
    expect(aCentavos("12.500")).toBe(1250000);
    expect(aCentavos("1.234")).toBe(123400);
    expect(aCentavos("1.234.567")).toBe(123456700);
    expect(aCentavos("$12.500")).toBe(1250000);
  });

  it("toma el punto como decimal cuando deja 1 o 2 dígitos", () => {
    expect(aCentavos("12.5")).toBe(1250);
    expect(aCentavos("12.50")).toBe(1250);
  });

  it("aplica el mismo criterio a la coma", () => {
    expect(aCentavos("1,5")).toBe(150);
    expect(aCentavos("12.345,67")).toBe(1234567);
  });

  it("devuelve null cuando la celda no tiene ningún número", () => {
    expect(aCentavos("")).toBeNull();
    expect(aCentavos(null)).toBeNull();
    expect(aCentavos("s/d")).toBeNull();
    expect(aCentavos("consultar")).toBeNull();
  });
});

describe("aEntero: cantidades de stock", () => {
  it("lee cantidades normales", () => {
    expect(aEntero("10")).toBe(10);
    expect(aEntero("  7 ")).toBe(7);
    expect(aEntero("10 u")).toBe(10);
    expect(aEntero("-3")).toBe(-3);
    expect(aEntero("1.000")).toBe(1000);
  });

  it("redondea si viene con decimales", () => {
    expect(aEntero("5,5")).toBe(6);
    expect(aEntero("5,2")).toBe(5);
  });

  it("devuelve null (y NO cero) cuando la celda es texto", () => {
    // Importa de verdad: null deja el stock como estaba, 0 se lo lleva puesto.
    expect(aEntero("consultar")).toBeNull();
    expect(aEntero("a pedido")).toBeNull();
    expect(aEntero("s/stock")).toBeNull();
    expect(aEntero("")).toBeNull();
    expect(aEntero(null)).toBeNull();
  });

  it("el cero explícito sigue siendo cero", () => {
    expect(aEntero("0")).toBe(0);
  });
});
