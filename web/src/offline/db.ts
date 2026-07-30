// Apertura de la base IndexedDB local. Nunca localStorage: todo lo que
// necesita sobrevivir sin señal (cola de operaciones, caché de listas) vive
// acá. Sin librerías externas — la API nativa alcanza para lo que hace falta.

const DB_NOMBRE = "control-stock-offline";
const DB_VERSION = 1;

export const STORE_OUTBOX = "outbox";
export const STORE_CLIENTES = "cache_clientes";
export const STORE_HERRAMIENTAS = "cache_herramientas";
export const STORE_META = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const outbox = db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
        outbox.createIndex("por_creado", "creado_en");
        outbox.createIndex("por_estado", "estado");
      }
      if (!db.objectStoreNames.contains(STORE_CLIENTES)) {
        db.createObjectStore(STORE_CLIENTES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_HERRAMIENTAS)) {
        db.createObjectStore(STORE_HERRAMIENTAS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "clave" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function envolver<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function transaccion<T>(
  stores: string | string[],
  modo: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, modo);
    let resultado: T;
    tx.oncomplete = () => resolve(resultado);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transacción de IndexedDB abortada."));
    Promise.resolve(fn(tx))
      .then((r) => { resultado = r; })
      .catch(reject);
  });
}

export async function put<T>(store: string, valor: T): Promise<void> {
  await transaccion(store, "readwrite", (tx) => envolver(tx.objectStore(store).put(valor)));
}

export async function putMuchos<T>(store: string, valores: T[]): Promise<void> {
  await transaccion(store, "readwrite", async (tx) => {
    const os = tx.objectStore(store);
    for (const v of valores) os.put(v);
  });
}

export async function obtener<T>(store: string, clave: IDBValidKey): Promise<T | undefined> {
  return transaccion(store, "readonly", (tx) => envolver(tx.objectStore(store).get(clave)));
}

export async function obtenerTodos<T>(store: string): Promise<T[]> {
  return transaccion(store, "readonly", (tx) => envolver(tx.objectStore(store).getAll()));
}

export async function eliminar(store: string, clave: IDBValidKey): Promise<void> {
  await transaccion(store, "readwrite", (tx) => envolver(tx.objectStore(store).delete(clave)));
}

export async function limpiar(store: string): Promise<void> {
  await transaccion(store, "readwrite", (tx) => envolver(tx.objectStore(store).clear()));
}

/** Solo para tests: cierra la conexión abierta, para poder borrar la base
 * entre casos de prueba sin quedar bloqueados por una conexión colgada. */
export async function cerrar(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}
