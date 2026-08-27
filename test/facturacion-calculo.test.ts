import { describe, it, expect } from "vitest";
import {
  calcularNetoIva,
  codigoAlicuota,
  codigoDocumento,
  inferirTipoComprobante,
  validarDocumentoParaTipo,
  TIPO_FACTURA,
  TIPO_NOTA_CREDITO,
} from "../src/facturacion/calculo";

describe("calcularNetoIva", () => {
  it("back-calcula neto e IVA desde un total todo-incluido al 21%", () => {
    // $1210,00 con IVA al 21% => neto $1000,00 + IVA $210,00
    const { neto, iva } = calcularNetoIva(121000, 2100);
    expect(neto).toBe(100000);
    expect(iva).toBe(21000);
    expect(neto + iva).toBe(121000);
  });

  it("no pierde centavos por redondeo: neto+iva siempre da el total exacto", () => {
    for (const total of [100, 999, 1001, 333333, 7]) {
      const { neto, iva } = calcularNetoIva(total, 2100);
      expect(neto + iva).toBe(total);
    }
  });

  it("con 0% de IVA, todo es neto", () => {
    const { neto, iva } = calcularNetoIva(50000, 0);
    expect(neto).toBe(50000);
    expect(iva).toBe(0);
  });
});

describe("codigoAlicuota", () => {
  it("mapea los porcentajes conocidos a su código AFIP", () => {
    expect(codigoAlicuota(2100)).toBe(5); // 21%
    expect(codigoAlicuota(1050)).toBe(4); // 10,5%
    expect(codigoAlicuota(0)).toBe(3); // 0%
  });

  it("rechaza una alícuota sin código conocido", () => {
    expect(() => codigoAlicuota(1500)).toThrow();
  });
});

describe("codigoDocumento", () => {
  it("CUIT -> 80", () => {
    expect(codigoDocumento({ doc_tipo: "CUIT", doc_numero: "20111111112" })).toEqual({ tipo: 80, numero: "20111111112" });
  });
  it("DNI -> 96", () => {
    expect(codigoDocumento({ doc_tipo: "DNI", doc_numero: "30111222" })).toEqual({ tipo: 96, numero: "30111222" });
  });
  it("sin documento -> 99 (consumidor final)", () => {
    expect(codigoDocumento({ doc_tipo: null, doc_numero: null })).toEqual({ tipo: 99, numero: "0" });
  });
});

describe("inferirTipoComprobante", () => {
  it("un negocio Monotributo siempre emite C, sin importar el cliente", () => {
    expect(inferirTipoComprobante("monotributo", { condicion_iva: "responsable_inscripto", doc_tipo: "CUIT", doc_numero: "20111111112" })).toBe("C");
    expect(inferirTipoComprobante("monotributo", { condicion_iva: null, doc_tipo: null, doc_numero: null })).toBe("C");
  });

  it("Responsable Inscripto le emite A a otro RI con CUIT cargado", () => {
    expect(
      inferirTipoComprobante("responsable_inscripto", {
        condicion_iva: "responsable_inscripto",
        doc_tipo: "CUIT",
        doc_numero: "20111111112",
      })
    ).toBe("A");
  });

  it("Responsable Inscripto le emite B a un consumidor final sin documento", () => {
    expect(inferirTipoComprobante("responsable_inscripto", { condicion_iva: null, doc_tipo: null, doc_numero: null })).toBe("B");
  });

  it("Responsable Inscripto le emite B a un RI que no cargó el CUIT", () => {
    expect(
      inferirTipoComprobante("responsable_inscripto", { condicion_iva: "responsable_inscripto", doc_tipo: null, doc_numero: null })
    ).toBe("B");
  });
});

describe("validarDocumentoParaTipo", () => {
  it("bloquea Factura A sin CUIT cargado", () => {
    expect(() => validarDocumentoParaTipo("A", { doc_tipo: null, doc_numero: null })).toThrow();
    expect(() => validarDocumentoParaTipo("A", { doc_tipo: "DNI", doc_numero: "3011122" })).toThrow();
  });
  it("permite Factura A con CUIT cargado", () => {
    expect(() => validarDocumentoParaTipo("A", { doc_tipo: "CUIT", doc_numero: "20111111112" })).not.toThrow();
  });
  it("Factura B y C no exigen documento", () => {
    expect(() => validarDocumentoParaTipo("B", { doc_tipo: null, doc_numero: null })).not.toThrow();
    expect(() => validarDocumentoParaTipo("C", { doc_tipo: null, doc_numero: null })).not.toThrow();
  });
});

describe("códigos de comprobante AFIP", () => {
  it("factura y nota de crédito usan los códigos correctos por letra", () => {
    expect(TIPO_FACTURA).toEqual({ A: 1, B: 6, C: 11 });
    expect(TIPO_NOTA_CREDITO).toEqual({ A: 3, B: 8, C: 13 });
  });
});
