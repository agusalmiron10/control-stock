import { describe, it, expect } from "vitest";
import {
  calcularNetoIva,
  calcularNetoIvaParaTipo,
  agruparPorAlicuota,
  prorratearDescuento,
  codigoAlicuota,
  parsearAlicuota,
  ALICUOTAS_VALIDAS,
  codigoDocumento,
  inferirTipoComprobante,
  validarDocumentoParaTipo,
  TIPO_FACTURA,
  TIPO_NOTA_CREDITO,
  TIPO_NOTA_DEBITO,
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

describe("calcularNetoIvaParaTipo", () => {
  // Regresión: ARCA rechazaba toda Factura C real con 10047/10048/10071
  // porque se le mandaba el mismo desglose neto+IVA que a una A o B — un
  // monotributista no discrimina IVA, así que para "C" todo es neto.
  it("para Factura C, todo el total es neto y el IVA es cero (no discrimina)", () => {
    const { neto, iva } = calcularNetoIvaParaTipo(121000, 2100, "C");
    expect(neto).toBe(121000);
    expect(iva).toBe(0);
  });

  it("para A y B, se comporta igual que calcularNetoIva (sí discrimina)", () => {
    expect(calcularNetoIvaParaTipo(121000, 2100, "A")).toEqual(calcularNetoIva(121000, 2100));
    expect(calcularNetoIvaParaTipo(121000, 2100, "B")).toEqual(calcularNetoIva(121000, 2100));
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
  it("factura, nota de crédito y nota de débito usan los códigos correctos por letra", () => {
    expect(TIPO_FACTURA).toEqual({ A: 1, B: 6, C: 11 });
    expect(TIPO_NOTA_CREDITO).toEqual({ A: 3, B: 8, C: 13 });
    expect(TIPO_NOTA_DEBITO).toEqual({ A: 2, B: 7, C: 12 });
  });

  it("los tres tipos de cada letra no se pisan entre sí (son numeración separada en ARCA)", () => {
    for (const letra of ["A", "B", "C"] as const) {
      const codigos = [TIPO_FACTURA[letra], TIPO_NOTA_CREDITO[letra], TIPO_NOTA_DEBITO[letra]];
      expect(new Set(codigos).size).toBe(3);
    }
  });
});

describe("agruparPorAlicuota", () => {
  it("con una sola alícuota, da un solo grupo igual a calcularNetoIva", () => {
    const grupos = agruparPorAlicuota([
      { subtotal: 60500, ivaPorcentaje: 2100 },
      { subtotal: 60500, ivaPorcentaje: 2100 },
    ]);
    expect(grupos).toEqual([{ ivaPorcentaje: 2100, ...calcularNetoIva(121000, 2100) }]);
  });

  it("con IVA mixto, arma un grupo por alícuota y cada uno se back-calcula sobre SU propio subtotal", () => {
    const grupos = agruparPorAlicuota([
      { subtotal: 121000, ivaPorcentaje: 2100 }, // $1210 con IVA al 21%
      { subtotal: 110500, ivaPorcentaje: 1050 }, // $1105 con IVA al 10,5%
    ]);
    expect(grupos).toEqual([
      { ivaPorcentaje: 1050, ...calcularNetoIva(110500, 1050) },
      { ivaPorcentaje: 2100, ...calcularNetoIva(121000, 2100) },
    ]);
  });

  it("junta renglones de la misma alícuota en un solo grupo antes de back-calcular", () => {
    const grupos = agruparPorAlicuota([
      { subtotal: 50000, ivaPorcentaje: 2100 },
      { subtotal: 71000, ivaPorcentaje: 2100 },
    ]);
    expect(grupos.length).toBe(1);
    expect(grupos[0]).toEqual({ ivaPorcentaje: 2100, ...calcularNetoIva(121000, 2100) });
  });

  it("neto+iva de cada grupo suma exacto su propio subtotal (sin perder centavos)", () => {
    const grupos = agruparPorAlicuota([
      { subtotal: 33333, ivaPorcentaje: 2100 },
      { subtotal: 77777, ivaPorcentaje: 1050 },
    ]);
    for (const g of grupos) {
      const subtotalOriginal = g.ivaPorcentaje === 2100 ? 33333 : 77777;
      expect(g.neto + g.iva).toBe(subtotalOriginal);
    }
  });

  it("sin renglones, no da ningún grupo", () => {
    expect(agruparPorAlicuota([])).toEqual([]);
  });
});

describe("prorratearDescuento", () => {
  it("sin descuento (subtotal == total), no toca los renglones", () => {
    const renglones = [{ subtotal: 60000 }, { subtotal: 40000 }];
    expect(prorratearDescuento(renglones, 100000)).toEqual(renglones);
  });

  it("reparte el descuento proporcional al peso de cada renglón", () => {
    // Descuento del 10%: $1000 y $2000 -> con 10% off, $900 y $1800.
    const renglones = [{ subtotal: 100000 }, { subtotal: 200000 }];
    const resultado = prorratearDescuento(renglones, 270000);
    expect(resultado).toEqual([{ subtotal: 90000 }, { subtotal: 180000 }]);
  });

  it("la suma de los renglones repartidos da EXACTO el total con descuento, sin perder centavos por redondeo", () => {
    // Un descuento que no reparte parejo entre 3 renglones.
    const renglones = [{ subtotal: 33333 }, { subtotal: 33333 }, { subtotal: 33334 }];
    const resultado = prorratearDescuento(renglones, 90001);
    expect(resultado.reduce((s, r) => s + r.subtotal, 0)).toBe(90001);
  });

  it("conserva los demás campos de cada renglón", () => {
    const renglones = [{ subtotal: 100000, ivaPorcentaje: 2100 }, { subtotal: 100000, ivaPorcentaje: 1050 }];
    const resultado = prorratearDescuento(renglones, 180000);
    expect(resultado[0].ivaPorcentaje).toBe(2100);
    expect(resultado[1].ivaPorcentaje).toBe(1050);
  });

  it("con la lista vacía, no rompe", () => {
    expect(prorratearDescuento([], 0)).toEqual([]);
  });
});

describe("parsearAlicuota", () => {
  it("blanco o ausente da null (usar el default del negocio, no es 0%)", () => {
    expect(parsearAlicuota(undefined)).toBeNull();
    expect(parsearAlicuota(null)).toBeNull();
    expect(parsearAlicuota("")).toBeNull();
    expect(parsearAlicuota("   ")).toBeNull();
  });

  it("acepta número o texto, con o sin %, con coma o punto decimal", () => {
    expect(parsearAlicuota(21)).toBe(2100);
    expect(parsearAlicuota("21")).toBe(2100);
    expect(parsearAlicuota("21%")).toBe(2100);
    expect(parsearAlicuota("10,5")).toBe(1050);
    expect(parsearAlicuota("10.5%")).toBe(1050);
    expect(parsearAlicuota("2,5")).toBe(250);
    expect(parsearAlicuota("27")).toBe(2700);
  });

  it('"Exento", "Sin IVA" y "0%" dan 0 — un valor real, no "sin dato"', () => {
    expect(parsearAlicuota("Exento")).toBe(0);
    expect(parsearAlicuota("exento")).toBe(0);
    expect(parsearAlicuota("Sin IVA")).toBe(0);
    expect(parsearAlicuota("0")).toBe(0);
    expect(parsearAlicuota("0%")).toBe(0);
  });

  it("un valor que ARCA no reconoce (no está en ALICUOTAS_VALIDAS) da null, no tira error", () => {
    expect(parsearAlicuota("15")).toBeNull();
    expect(parsearAlicuota("qwerty")).toBeNull();
    expect(parsearAlicuota("100")).toBeNull();
  });

  it("todo lo que devuelve, salvo null, está en ALICUOTAS_VALIDAS", () => {
    for (const v of ["21", "10,5", "0", "2.5", "5", "27"]) {
      expect(ALICUOTAS_VALIDAS).toContain(parsearAlicuota(v));
    }
  });
});
