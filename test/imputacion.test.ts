import { describe, it, expect } from "vitest";
import { imputar, type VentaImput, type PagoImput } from "../src/imputacion";

// Helpers para leer resultados por número de venta.
function estado(res: ReturnType<typeof imputar>, ventaId: number) {
  return res.porVenta.get(ventaId)!;
}

describe("imputación FIFO de pagos", () => {
  it("A — FIFO simple: paga la venta más vieja primero", () => {
    const ventas: VentaImput[] = [
      { id: 1, numero: 1, fecha: "2026-03-01", total: 10000 },
      { id: 2, numero: 2, fecha: "2026-03-05", total: 10000 },
    ];
    const pagos: PagoImput[] = [{ id: 1, venta_id: null, monto: 15000 }];

    const res = imputar(ventas, pagos);

    expect(estado(res, 1).estado).toBe("pagada");
    expect(estado(res, 1).pagado).toBe(10000);
    expect(estado(res, 2).estado).toBe("parcial");
    expect(estado(res, 2).pagado).toBe(5000);
    expect(estado(res, 2).saldo).toBe(5000);
    expect(res.saldoCliente).toBe(5000); // debe 50
    expect(res.saldoAFavor).toBe(0);
  });

  it("A.2 — FIFO respeta fecha por sobre el id de carga", () => {
    // La venta id=2 es más vieja que la id=1: debe cobrarse primero.
    const ventas: VentaImput[] = [
      { id: 1, numero: 2, fecha: "2026-03-10", total: 10000 },
      { id: 2, numero: 1, fecha: "2026-03-01", total: 10000 },
    ];
    const pagos: PagoImput[] = [{ id: 1, venta_id: null, monto: 10000 }];

    const res = imputar(ventas, pagos);

    expect(estado(res, 2).estado).toBe("pagada"); // la más vieja
    expect(estado(res, 1).estado).toBe("impaga");
  });

  it("B — Saldo a favor: sobra crédito tras pagar todo", () => {
    const ventas: VentaImput[] = [
      { id: 1, numero: 1, fecha: "2026-03-01", total: 10000 },
    ];
    const pagos: PagoImput[] = [{ id: 1, venta_id: null, monto: 30000 }];

    const res = imputar(ventas, pagos);

    expect(estado(res, 1).estado).toBe("pagada");
    expect(res.saldoAFavor).toBe(20000);
    expect(res.saldoCliente).toBe(-20000); // a favor

    // Aparece una venta nueva → el crédito se aplica solo.
    const ventas2 = [...ventas, { id: 2, numero: 2, fecha: "2026-03-08", total: 8000 }];
    const res2 = imputar(ventas2, pagos);
    expect(estado(res2, 2).estado).toBe("pagada");
    expect(res2.saldoAFavor).toBe(12000);
  });

  it("C — Venta con descuento: se reparte sobre el total, no el subtotal", () => {
    // subtotal 10000, descuento 10% → total 9000.
    const ventas: VentaImput[] = [
      { id: 1, numero: 1, fecha: "2026-03-01", total: 9000 },
    ];
    const pagos: PagoImput[] = [{ id: 1, venta_id: 1, monto: 9000 }];

    const res = imputar(ventas, pagos);

    expect(estado(res, 1).estado).toBe("pagada");
    expect(res.saldoCliente).toBe(0);
    expect(res.saldoAFavor).toBe(0);
  });

  it("D — Anulación libera pagos: el pago directo pasa a cuenta y reimputa", () => {
    // Simulamos el estado POSTERIOR a la anulación: la venta 1 sale del conjunto
    // (anulada) y su pago pasó a venta_id null (lo hace el backend en el batch).
    const ventasAntes: VentaImput[] = [
      { id: 1, numero: 1, fecha: "2026-03-01", total: 10000 },
      { id: 2, numero: 2, fecha: "2026-03-05", total: 10000 },
    ];
    const pagosAntes: PagoImput[] = [{ id: 1, venta_id: 1, monto: 10000 }];
    const antes = imputar(ventasAntes, pagosAntes);
    expect(estado(antes, 1).estado).toBe("pagada");
    expect(estado(antes, 2).estado).toBe("impaga");

    // Después de anular la venta 1: se excluye del conjunto y el pago queda a cuenta.
    const ventasDespues: VentaImput[] = [
      { id: 2, numero: 2, fecha: "2026-03-05", total: 10000 },
    ];
    const pagosDespues: PagoImput[] = [{ id: 1, venta_id: null, monto: 10000 }];
    const despues = imputar(ventasDespues, pagosDespues);

    expect(estado(despues, 2).estado).toBe("pagada"); // el pago liberado cubre la #2
    expect(despues.saldoCliente).toBe(0);
    expect(despues.saldoAFavor).toBe(0);
  });

  it("D.2 — Anulación sin otra deuda: queda saldo a favor", () => {
    const ventas: VentaImput[] = []; // única venta anulada, ya excluida
    const pagos: PagoImput[] = [{ id: 1, venta_id: null, monto: 10000 }];
    const res = imputar(ventas, pagos);
    expect(res.saldoAFavor).toBe(10000);
    expect(res.saldoCliente).toBe(-10000);
  });

  it("E — Pago directo con excedente: el sobrante cae al pozo y sigue FIFO", () => {
    const ventas: VentaImput[] = [
      { id: 1, numero: 1, fecha: "2026-03-01", total: 5000 },
      { id: 2, numero: 2, fecha: "2026-03-05", total: 5000 },
    ];
    // Pago dirigido a la venta 1 por más de su total.
    const pagos: PagoImput[] = [{ id: 1, venta_id: 1, monto: 8000 }];

    const res = imputar(ventas, pagos);

    expect(estado(res, 1).estado).toBe("pagada");
    expect(estado(res, 2).pagado).toBe(3000); // excedente 3000 fue a la #2
    expect(estado(res, 2).estado).toBe("parcial");
  });

  it("F — Combinación directo + a cuenta, varias ventas", () => {
    const ventas: VentaImput[] = [
      { id: 1, numero: 1, fecha: "2026-03-01", total: 10000 },
      { id: 2, numero: 2, fecha: "2026-03-05", total: 20000 },
      { id: 3, numero: 3, fecha: "2026-03-09", total: 5000 },
    ];
    const pagos: PagoImput[] = [
      { id: 1, venta_id: 2, monto: 20000 }, // paga exacta la #2
      { id: 2, venta_id: null, monto: 12000 }, // FIFO: #1 (10000) y luego #3 (2000)
    ];

    const res = imputar(ventas, pagos);

    expect(estado(res, 2).estado).toBe("pagada");
    expect(estado(res, 1).estado).toBe("pagada");
    expect(estado(res, 3).pagado).toBe(2000);
    expect(estado(res, 3).estado).toBe("parcial");
    expect(res.saldoCliente).toBe(3000);
    expect(res.saldoAFavor).toBe(0);
  });
});
