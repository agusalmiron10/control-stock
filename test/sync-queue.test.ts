// Motor de sincronización offline: no debe duplicar al reintentar, debe
// respetar el orden/dependencia de la cola, y no debe perder nada si la app
// se cierra con la cola llena. Usa fake-indexeddb para simular IndexedDB
// real (no localStorage, no mocks a mano de la API del navegador).
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// navigator real de Node no permite pisar `onLine`; lo reemplazamos entero.
Object.defineProperty(globalThis, "navigator", {
  value: { onLine: true, storage: undefined },
  configurable: true,
  writable: true,
});

function borrarBaseDeDatos(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("control-stock-offline");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/** Sólo se falsea Date (para poder simular que pasó el tiempo del backoff):
 * setTimeout queda real, porque fake-indexeddb depende de timers reales
 * para resolver sus operaciones. */
function avanzar(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

let modActual: { outbox: typeof import("../web/src/offline/outbox"); sync: typeof import("../web/src/offline/sync"); db: typeof import("../web/src/offline/db") } | null = null;

async function cargarModulos() {
  const outbox = await import("../web/src/offline/outbox");
  const sync = await import("../web/src/offline/sync");
  const db = await import("../web/src/offline/db");
  modActual = { outbox, sync, db };
  return modActual;
}

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.useFakeTimers({ toFake: ["Date"] });
  (globalThis.navigator as any).onLine = true;
  modActual = null;
  await borrarBaseDeDatos();
});

afterEach(async () => {
  modActual?.sync._detenerTemporizador();
  await modActual?.db.cerrar();
  vi.useRealTimers();
});

describe("cola de sincronización offline", () => {
  it("no duplica una operación al reintentar tras un fallo de red", async () => {
    const { outbox, sync } = await cargarModulos();
    const id = "11111111-1111-1111-1111-111111111111";

    let llamadas = 0;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      llamadas++;
      if (llamadas < 3) throw new TypeError("Failed to fetch"); // simula sin señal
      return new Response(JSON.stringify({ id }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await outbox.encolar({ id, tipo: "pago", payload: { cliente_id: "c1", monto: 1000 }, creado_en: new Date().toISOString() });

    await sync.procesarCola(); // intento 1: sin señal.
    avanzar(11_000); // pasa el backoff del intento 1 (10s).
    await sync.procesarCola(); // intento 2: sin señal.

    let cola = await outbox.listarCola();
    expect(cola).toHaveLength(1);
    expect(cola[0].id).toBe(id);
    expect(llamadas).toBe(2);

    // Toda la data enviada usó siempre la MISMA idempotency_key: el server
    // (con su tabla operaciones) puede deduplicar sin importar cuántas
    // veces reintentemos.
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body.idempotency_key).toBe(id);
      expect(body.id).toBe(id);
    }

    avanzar(21_000); // pasa el backoff del intento 2 (20s).
    await sync.procesarCola(); // intento 3: se recuperó la señal, llega.
    cola = await outbox.listarCola();
    expect(cola).toHaveLength(0); // se sacó de la cola al confirmarse.
    expect(llamadas).toBe(3);

    // Volver a encolar con el mismo id (p.ej. un doble tap en "Guardar")
    // nunca crea una segunda fila: IndexedDB pisa por keyPath.
    await outbox.encolar({ id, tipo: "pago", payload: { cliente_id: "c1", monto: 1000 }, creado_en: new Date().toISOString() });
    await outbox.encolar({ id, tipo: "pago", payload: { cliente_id: "c1", monto: 1000 }, creado_en: new Date().toISOString() });
    const colaFinal = await outbox.listarCola();
    expect(colaFinal.filter((o) => o.id === id)).toHaveLength(1);
  });

  it("respeta el orden y las dependencias: no manda un pago antes que la venta que referencia", async () => {
    const { outbox, sync } = await cargarModulos();
    const idVenta = "22222222-2222-2222-2222-222222222222";
    const idPago = "33333333-3333-3333-3333-333333333333";

    const urlsLlamadas: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urlsLlamadas.push(url);
      if (url === "/api/ventas") throw new TypeError("Failed to fetch"); // la venta no logra subir todavía.
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Se encola primero la venta y después el pago que la referencia — el
    // orden de creación es lo único que garantiza la dependencia.
    await outbox.encolar({ id: idVenta, tipo: "venta", payload: { cliente_id: "c1" }, creado_en: "2026-01-01T10:00:00.000Z" });
    await outbox.encolar({ id: idPago, tipo: "pago", payload: { cliente_id: "c1", venta_id: idVenta }, creado_en: "2026-01-01T10:00:01.000Z" });

    await sync.procesarCola();

    // La venta falló por red: el pago NO se intenta en esta pasada, porque
    // saltarlo rompería la dependencia (el pago referencia una venta que
    // todavía no existe en el servidor).
    expect(urlsLlamadas).toEqual(["/api/ventas"]);

    const cola = await outbox.listarCola();
    expect(cola.map((o) => o.id)).toEqual([idVenta, idPago]); // ambas siguen, en el mismo orden.

    // Ahora la venta sí sube. Recién ahí se intenta el pago, y en orden.
    fetchMock.mockImplementationOnce(async (url: string) => {
      urlsLlamadas.push(url);
      return new Response(JSON.stringify({ id: idVenta, numero: 1 }), { status: 200 });
    });
    avanzar(11_000); // pasa el backoff del intento 1 de la venta.
    await sync.procesarCola();

    expect(urlsLlamadas).toEqual(["/api/ventas", "/api/ventas", "/api/pagos"]);
    expect(await outbox.listarCola()).toHaveLength(0);
  });

  it("no pierde ninguna operación si la app se cierra con la cola llena", async () => {
    const { outbox: outbox1, db: db1 } = await cargarModulos();

    await outbox1.encolar({ id: "a1", tipo: "venta", payload: { cliente_id: "c1" }, creado_en: "2026-01-01T09:00:00.000Z" });
    await outbox1.encolar({ id: "a2", tipo: "pago", payload: { cliente_id: "c1" }, creado_en: "2026-01-01T09:00:01.000Z" });
    await outbox1.encolar({ id: "a3", tipo: "cliente", payload: { nombre: "Juan" }, creado_en: "2026-01-01T09:00:02.000Z" });

    // Simula "cerrar la app": se cierra la conexión y se descartan los
    // módulos, y se vuelve a abrir todo de cero, como pasaría al reabrir
    // la PWA. La base subyacente de fake-indexeddb sigue existiendo — es
    // lo que estamos probando.
    await db1.cerrar();
    vi.resetModules();
    const { outbox: outbox2 } = await cargarModulos();

    const cola = await outbox2.listarCola();
    expect(cola.map((o) => o.id)).toEqual(["a1", "a2", "a3"]); // nada se perdió, orden intacto.
    expect(cola.every((o) => o.estado === "pendiente")).toBe(true);
  });
});
