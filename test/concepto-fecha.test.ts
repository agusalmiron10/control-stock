import { describe, it, expect } from "vitest";
import { CONCEPTO, ventanaFecha, fechaParaEmitir } from "../src/facturacion/calculo";

describe("CONCEPTO", () => {
  it("usa los códigos que espera ARCA", () => {
    expect(CONCEPTO.productos).toBe(1);
    expect(CONCEPTO.servicios).toBe(2);
    expect(CONCEPTO.ambos).toBe(3);
  });
});

describe("ventanaFecha", () => {
  it("productos tiene menos ventana que servicios", () => {
    expect(ventanaFecha(CONCEPTO.productos)).toBe(5);
    expect(ventanaFecha(CONCEPTO.servicios)).toBe(10);
    expect(ventanaFecha(CONCEPTO.ambos)).toBe(10);
  });
});

describe("fechaParaEmitir", () => {
  it("usa la fecha de la venta si ARCA todavía la acepta", () => {
    // Venta del lunes facturada el miércoles: 2 días, entra en la ventana.
    expect(fechaParaEmitir("2026-09-07", "2026-09-09", CONCEPTO.productos)).toBe("2026-09-07");
  });

  it("cae a hoy si la venta quedó fuera de la ventana", () => {
    // 20 días: ARCA lo rechazaría, así que se emite con fecha de hoy.
    expect(fechaParaEmitir("2026-08-20", "2026-09-09", CONCEPTO.productos)).toBe("2026-09-09");
  });

  it("el borde justo entra", () => {
    expect(fechaParaEmitir("2026-09-04", "2026-09-09", CONCEPTO.productos)).toBe("2026-09-04"); // 5 días
    expect(fechaParaEmitir("2026-09-03", "2026-09-09", CONCEPTO.productos)).toBe("2026-09-09"); // 6 días, no
  });

  it("servicios aguanta más días que productos", () => {
    // 8 días: productos no, servicios sí.
    expect(fechaParaEmitir("2026-09-01", "2026-09-09", CONCEPTO.productos)).toBe("2026-09-09");
    expect(fechaParaEmitir("2026-09-01", "2026-09-09", CONCEPTO.servicios)).toBe("2026-09-01");
  });

  it("una venta del mismo día se factura con esa fecha", () => {
    expect(fechaParaEmitir("2026-09-09", "2026-09-09", CONCEPTO.productos)).toBe("2026-09-09");
  });
});
