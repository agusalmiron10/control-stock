import { describe, it, expect } from "vitest";
import { cantidad } from "../src/validate";

describe("cantidad", () => {
  it("sin venta fraccionada exige enteros, como siempre", () => {
    expect(cantidad(3, "cantidad", { min: 1 })).toBe(3);
    expect(() => cantidad(1.5, "cantidad", { min: 1 })).toThrow();
  });

  it("con venta fraccionada acepta decimales", () => {
    expect(cantidad(1.5, "cantidad", { fraccionada: true, min: 0.001 })).toBe(1.5);
    expect(cantidad("0.25", "cantidad", { fraccionada: true, min: 0.001 })).toBe(0.25);
  });

  it("redondea a 3 decimales para que no entre basura de floats", () => {
    expect(cantidad(1.23456789, "cantidad", { fraccionada: true })).toBe(1.235);
  });

  it("respeta el mínimo también en fraccionada", () => {
    expect(() => cantidad(0, "cantidad", { fraccionada: true, min: 0.001 })).toThrow();
    expect(() => cantidad(-2, "cantidad", { fraccionada: true, min: 0.001 })).toThrow();
  });

  it("rechaza lo que no es número", () => {
    expect(() => cantidad("dos kilos", "cantidad", { fraccionada: true })).toThrow();
    expect(() => cantidad(null, "cantidad", { fraccionada: true })).toThrow();
  });
});
