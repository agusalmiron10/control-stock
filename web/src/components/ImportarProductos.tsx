import { useState } from "react";
import * as XLSX from "xlsx-js-style";
import { api } from "../api";
import { normalizarTexto as normalizar } from "../format";
import { Modal, Error, Campo } from "./ui";
import { useVocab } from "../lib/config";

/** Columnas que se pueden traer. El orden en el archivo no importa: se
 *  reconocen por el nombre del encabezado. Lo único que no puede faltar es
 *  el nombre del producto — el código, si no viene, se resuelve solo
 *  (ver revisarFilas en el backend). */
const COLUMNAS: { clave: string; etiqueta: string; alias: string[] }[] = [
  { clave: "codigo", etiqueta: "Código", alias: ["codigo", "código", "cod", "cod.", "sku", "codigo interno", "nro", "n°", "numero"] },
  {
    clave: "nombre", etiqueta: "Nombre",
    // "herramienta" está a propósito: es la palabra que este sistema usa en
    // todos lados (el título de la página se llama justo así) para lo que
    // se vende, así que es lo primero que alguien prueba escribir en una
    // planilla de prueba. La palabra que cada negocio configuró para lo
    // suyo ("Prenda", "Artículo"…) se suma aparte, ver vocabComoAlias.
    alias: ["nombre", "descripcion", "descripción", "desc", "producto", "detalle", "denominacion", "denominación",
            "concepto", "herramienta", "herramientas"],
  },
  {
    clave: "precio", etiqueta: "Precio",
    alias: ["precio", "precio venta", "precio de venta", "precio minorista", "minorista", "pvp", "p. unitario",
            "p unitario", "precio unitario", "unitario", "importe", "valor", "precio lista", "lista",
            "precio publico", "precio público", "$"],
  },
  { clave: "precio_mayor", etiqueta: "Precio mayorista", alias: ["precio mayor", "precio mayorista", "mayorista", "por mayor", "mayor"] },
  { clave: "costo", etiqueta: "Costo", alias: ["costo", "costo unitario", "compra", "precio compra", "precio de compra"] },
  { clave: "stock", etiqueta: "Stock", alias: ["stock", "cantidad", "cant", "cant.", "existencia", "existencias", "disponible"] },
  { clave: "stock_minimo", etiqueta: "Stock mínimo", alias: ["stock minimo", "stock mínimo", "minimo", "mínimo"] },
  { clave: "rubro", etiqueta: "Rubro", alias: ["rubro", "categoria", "categoría", "familia", "grupo", "linea", "línea"] },
  // Sólo para negocios que facturan con productos a distinta alícuota
  // (algunos gravados, otros exentos, o a otro %) — el resto puede ignorar
  // esta columna tranquilo, no hace falta traerla. Acepta "21", "21%",
  // "10,5", "Exento": ver parsearAlicuota en el backend.
  { clave: "iva_porcentaje", etiqueta: "IVA", alias: ["iva", "% iva", "iva %", "alicuota", "alícuota", "alicuota iva", "alícuota iva"] },
];

/**
 * Encabezados que significan una cosa u otra según qué más traiga la
 * planilla. "ARTÍCULO" es el nombre del producto en una lista de dos
 * columnas ("Artículo | Precio"), pero es el código cuando al lado hay una
 * descripción ("Artículo | Descripción | Precio"). Se resuelven al final,
 * ocupando el primer lugar de su orden de preferencia que haya quedado
 * libre.
 */
const AMBIGUOS: { alias: string[]; orden: string[] }[] = [
  { alias: ["articulo", "artículo", "art", "art.", "item", "ítem"], orden: ["nombre", "codigo"] },
];


/**
 * Parte una línea respetando comillas: un nombre como
 * "Caño 1/2", negro  no se puede cortar por la coma de adentro.
 */
function partirLinea(linea: string, sep: string): string[] {
  const salida: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      if (entreComillas && linea[i + 1] === '"') { actual += '"'; i++; }
      else entreComillas = !entreComillas;
    } else if (ch === sep && !entreComillas) {
      salida.push(actual);
      actual = "";
    } else {
      actual += ch;
    }
  }
  salida.push(actual);
  return salida.map((x) => x.trim());
}

const SEPARADORES = ["\t", ";", ","];

/**
 * Además de acentos y mayúsculas, saca las anotaciones que la gente agrega
 * al lado del nombre de la columna sin que cambien lo que significa: "Precio
 * ($)", "Stock (unidades)", "Costo (u$s)". Sin esto "Precio ($)" no
 * encontraba ningún alias — "precio ($)" no es igual a "precio" ni a "$" —
 * y una columna de precio bien puesta se perdía en silencio.
 */
function normalizarEncabezado(h: string): string {
  return normalizar(h)
    .replace(/\([^)]*\)/g, "")   // "precio ($)" -> "precio "
    .replace(/[$%#]/g, "")       // símbolos sueltos que puedan quedar
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qué campo es cada columna de una fila candidata a encabezado. Devuelve el
 * mapa posición -> clave; vacío si esa fila no parece un encabezado.
 *
 * Primero se resuelven los nombres inequívocos y recién después los
 * ambiguos, que ocupan lo que haya quedado libre (ver AMBIGUOS). Un campo
 * ya asignado no se pisa: si la planilla trae dos columnas "Precio", vale
 * la primera.
 *
 * `nombreExtra` sirve para sumar, sólo a la columna "nombre", la palabra
 * que ESTE negocio configuró para lo que vende (ver vocab en el llamador):
 * si le puso "Prenda" a sus productos, una columna "Prenda" en su propia
 * lista tiene que reconocerse igual que "Herramienta" o "Producto".
 */
function mapearEncabezado(campos: string[], nombreExtra: string[] = []): Record<number, string> {
  const mapa: Record<number, string> = {};
  const usados = new Set<string>();
  const aliasNombre = new Set([...COLUMNAS.find((c) => c.clave === "nombre")!.alias, ...nombreExtra]);

  campos.forEach((h, i) => {
    const n = normalizarEncabezado(h);
    if (!n) return;
    const col = COLUMNAS.find((c) => {
      if (usados.has(c.clave)) return false;
      const alias = c.clave === "nombre" ? aliasNombre : c.alias;
      return [...alias].some((a) => normalizarEncabezado(a) === n);
    });
    if (col) { mapa[i] = col.clave; usados.add(col.clave); }
  });

  campos.forEach((h, i) => {
    if (mapa[i]) return;
    const n = normalizarEncabezado(h);
    const amb = AMBIGUOS.find((a) => a.alias.some((x) => normalizarEncabezado(x) === n));
    if (!amb) return;
    const libre = amb.orden.find((clave) => !usados.has(clave));
    if (libre) { mapa[i] = libre; usados.add(libre); }
  });

  return mapa;
}

/**
 * Convierte el texto pegado o el CSV en filas con nombres de columna.
 *
 * No asume que el encabezado sea la primera fila: las listas de proveedor
 * casi siempre arrancan con un título ("LISTA DE PRECIOS - MAYO"), una
 * fila en blanco o los datos de la empresa. Se prueban las primeras filas
 * con cada separador posible y gana la que reconozca más columnas; todo
 * lo que esté por encima se descarta.
 */
export function parsear(
  contenido: string,
  /** Alias extra para la columna "nombre" — normalmente el vocabulario del
   *  negocio (ver useVocab). Los tests la llaman sin esto y andan igual:
   *  son los alias fijos de siempre. */
  nombreExtra: string[] = []
): { filas: any[]; aviso?: string; columnas?: string[] } {
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lineas.length < 2) return { filas: [], aviso: "Hacen falta al menos el encabezado y una fila." };

  let mejor = { fila: -1, mapa: {} as Record<number, string>, sep: ",", puntaje: 0 };
  const hastaFila = Math.min(lineas.length, 15);
  for (let i = 0; i < hastaFila; i++) {
    for (const sep of SEPARADORES) {
      const mapa = mapearEncabezado(partirLinea(lineas[i], sep), nombreExtra);
      const puntaje = Object.keys(mapa).length;
      if (puntaje > mejor.puntaje) mejor = { fila: i, mapa, sep, puntaje };
    }
  }

  const claves = Object.values(mejor.mapa);
  if (!claves.includes("nombre")) {
    return {
      filas: [],
      aviso:
        "No encontré la columna con el nombre del producto. El encabezado tiene que decir alguna de: " +
        COLUMNAS.find((c) => c.clave === "nombre")!.alias.join(", ") + ".",
    };
  }

  const filas = lineas.slice(mejor.fila + 1).map((l) => {
    const partes = partirLinea(l, mejor.sep);
    const fila: any = {};
    partes.forEach((v, i) => { if (mejor.mapa[i]) fila[mejor.mapa[i]] = v; });
    return fila;
  });

  // En el orden en que aparecen en el archivo, para que se entienda de un
  // vistazo qué entendió el sistema de esa planilla.
  const columnas = Object.keys(mejor.mapa)
    .sort((a, b) => Number(a) - Number(b))
    .map((i) => COLUMNAS.find((c) => c.clave === mejor.mapa[Number(i)])!.etiqueta);

  return { filas, columnas };
}

interface Revisada {
  linea: number; codigo: string; nombre: string;
  accion: "crear" | "actualizar" | "error"; motivo?: string;
}

export function ImportarProductos({ onCerrar }: { onCerrar: (mensaje?: string) => void }) {
  const vocab = useVocab();
  const [texto, setTexto] = useState("");
  const [filas, setFilas] = useState<any[]>([]);
  const [revisadas, setRevisadas] = useState<Revisada[] | null>(null);
  const [resumen, setResumen] = useState<{ crear: number; actualizar: number; error: number } | null>(null);
  const [columnas, setColumnas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);


  async function previsualizar(contenido: string) {
    setError(null);
    setRevisadas(null);
    const { filas: parseadas, aviso, columnas: detectadas } = parsear(contenido, [vocab.singular, vocab.plural]);
    if (aviso) { setError(aviso); return; }
    setFilas(parseadas);
    setColumnas(detectadas ?? []);
    setTrabajando(true);
    try {
      const r = await api.post<{ filas: Revisada[]; resumen: any }>(
        "/api/herramientas/importar/previsualizar",
        { filas: parseadas }
      );
      setRevisadas(r.filas);
      setResumen(r.resumen);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTrabajando(false);
    }
  }

  async function confirmar() {
    setError(null);
    setTrabajando(true);
    try {
      const r = await api.post<{ creados: number; actualizados: number; omitidos: number }>(
        "/api/herramientas/importar",
        { filas }
      );
      onCerrar(
        `Importación lista: ${r.creados} ${vocab.plural.toLowerCase()} nuevos, ${r.actualizados} actualizados` +
        (r.omitidos > 0 ? `, ${r.omitidos} con error (no se tocaron).` : ".")
      );
    } catch (err: any) {
      setError(err.message);
      setTrabajando(false);
    }
  }

  /**
   * Un Excel de verdad (.xlsx/.xls), no sólo CSV. Pedirle a un ferretero que
   * abra su lista, la guarde como CSV y recién ahí la suba es justo el paso
   * de más que hace que alguien abandone la carga inicial. Se lee el
   * archivo tal cual lo tiene y se convierte la primera hoja a CSV con la
   * misma librería que ya usa el sistema para exportar — así el resto del
   * flujo (detectar columnas, previsualizar, importar) no cambia en nada:
   * sigue siendo el mismo texto CSV de siempre, sólo que ahora se puede
   * generar solo, sin que el usuario tenga que hacerlo a mano.
   */
  function esExcel(nombre: string): boolean {
    return /\.xlsx?$/i.test(nombre);
  }

  function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (esExcel(file.name)) {
      const lector = new FileReader();
      lector.onload = () => {
        try {
          const buffer = lector.result as ArrayBuffer;
          const libro = XLSX.read(buffer, { type: "array" });
          if (libro.SheetNames.length === 0) { setError("Ese Excel no tiene ninguna hoja."); return; }

          // La hoja con los datos no siempre es la primera: es común que la
          // primera sea una carátula, o una "Hoja1" vacía que quedó del
          // archivo original. Se usa la que más contenido tenga.
          let contenido = "";
          for (const hoja of libro.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(libro.Sheets[hoja]);
            if (csv.split(/\r?\n/).filter((l) => l.replace(/,/g, "").trim() !== "").length >
                contenido.split(/\r?\n/).filter((l) => l.replace(/,/g, "").trim() !== "").length) {
              contenido = csv;
            }
          }
          if (contenido.trim() === "") { setError("Ese Excel no tiene datos en ninguna hoja."); return; }
          setTexto(contenido);
          void previsualizar(contenido);
        } catch {
          setError("No se pudo leer ese archivo. ¿Es un Excel (.xlsx) válido?");
        }
      };
      lector.readAsArrayBuffer(file);
      return;
    }

    const lector = new FileReader();
    lector.onload = () => {
      const contenido = String(lector.result ?? "");
      setTexto(contenido);
      void previsualizar(contenido);
    };
    lector.readAsText(file, "UTF-8");
  }

  const conError = revisadas?.filter((r) => r.accion === "error") ?? [];

  return (
    <Modal titulo={`Importar ${vocab.plural.toLowerCase()}`} ancho onCerrar={() => onCerrar()}>
      <Error msg={error} />

      {!revisadas ? (
        <>
          <p style={{ marginTop: 0 }}>
            Traé la lista tal cual te la pasó el proveedor. Lo único que no puede faltar es la
            columna del <b>nombre</b> del producto; si además trae <b>precio</b>, <b>codigo</b>,{" "}
            <b>costo</b>, <b>stock</b>, <b>stock_minimo</b>, <b>precio_mayor</b> o <b>rubro</b>, se
            cargan también.
          </p>
          <p className="mut" style={{ marginTop: -8 }}>
            No importa el orden de las columnas, ni que el archivo arranque con un título o filas
            en blanco arriba: se busca el encabezado solo. Si la lista no trae código, se usa el
            nombre para saber cuál es cuál y a los nuevos se les pone un código automático — así
            volver a importar la lista del mes que viene actualiza los precios en vez de duplicarte
            el catálogo.
          </p>
          <p className="mut" style={{ marginTop: -8 }}>
            ¿Algunos productos llevan IVA y otros no, o a distinta alícuota? Agregá una columna{" "}
            <b>iva</b> con el valor de cada uno — "21", "10,5", "Exento" — y el que no la traiga sigue
            usando la alícuota general de tus Ajustes de facturación.
          </p>

          <Campo label="Opción 1 — subir el archivo (.xlsx o .csv)">
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={alElegirArchivo}
            />
          </Campo>
          <p className="mut" style={{ marginTop: -4 }}>
            Subís el Excel tal cual lo tenés — no hace falta guardarlo como CSV. Si tiene varias
            hojas, se usa la que tenga los datos.
          </p>

          <Campo label="Opción 2 — copiar y pegar desde Excel">
            <textarea
              rows={7}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"codigo\tnombre\tprecio\tstock\nBAR-100\tBarreta 100\t12500\t8"}
            />
          </Campo>
          <p className="mut" style={{ marginTop: -4 }}>
            Seleccionás las celdas en Excel, copiás, y pegás acá. Incluí la fila del encabezado.
          </p>

          <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
            <button
              className="btn primario"
              disabled={trabajando || !texto.trim()}
              onClick={() => previsualizar(texto)}
            >
              {trabajando ? "Revisando…" : "Revisar"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>Esto es lo que va a pasar. Todavía no se guardó nada.</p>

          {/* Qué entendió de la planilla. Es lo que deja ver de un vistazo si
              se salteó la columna de precios por llamarse distinto — antes eso
              terminaba en 300 productos cargados en $0 sin ningún aviso. */}
          {columnas.length > 0 && (
            <p className="mut" style={{ marginTop: -6 }}>
              Columnas que reconocí en tu archivo: <b>{columnas.join(", ")}</b>.
              {!columnas.includes("Precio") && " Ojo: no encontré ninguna columna de precio."}
            </p>
          )}

          <div className="grid-kpi">
            <div className="kpi">
              <div className="rot">Se van a crear</div>
              <div className="val saldado">{resumen?.crear ?? 0}</div>
            </div>
            <div className="kpi">
              <div className="rot">Se van a actualizar</div>
              <div className="val">{resumen?.actualizar ?? 0}</div>
              <div className="mut">Por código repetido</div>
            </div>
            {(resumen?.error ?? 0) > 0 && (
              <div className="kpi">
                <div className="rot">Con error</div>
                <div className="val debe">{resumen?.error}</div>
                <div className="mut">Se saltean</div>
              </div>
            )}
          </div>

          {conError.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="card-header">Filas que no se van a importar</div>
              <div className="card-body">
                {conError.slice(0, 12).map((r) => (
                  <p key={r.linea} className="mut" style={{ marginBottom: 4 }}>
                    <b>Fila {r.linea}</b> {r.codigo && `(${r.codigo})`} — {r.motivo}
                  </p>
                ))}
                {conError.length > 12 && (
                  <p className="mut">…y {conError.length - 12} más.</p>
                )}
              </div>
            </div>
          )}

          <p className="mut">
            Al actualizar sólo se pisan las columnas que trae el archivo: si no trae stock, el stock
            que ya tenías queda como está.
          </p>

          <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn" onClick={() => { setRevisadas(null); setError(null); }}>Volver</button>
            <button
              className="btn primario"
              disabled={trabajando || ((resumen?.crear ?? 0) + (resumen?.actualizar ?? 0)) === 0}
              onClick={confirmar}
            >
              {trabajando ? "Importando…" : "Confirmar importación"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
