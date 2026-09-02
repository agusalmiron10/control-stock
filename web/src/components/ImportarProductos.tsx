import { useState } from "react";
import { api } from "../api";
import { normalizarTexto as normalizar } from "../format";
import { Modal, Error, Campo } from "./ui";
import { useVocab } from "../lib/config";

/** Columnas que se pueden traer. El orden en el archivo no importa: se
 *  reconocen por el nombre del encabezado. */
const COLUMNAS: { clave: string; alias: string[]; obligatoria?: boolean }[] = [
  { clave: "codigo", alias: ["codigo", "código", "cod", "sku"], obligatoria: true },
  { clave: "nombre", alias: ["nombre", "descripcion", "descripción", "producto", "detalle"], obligatoria: true },
  { clave: "precio", alias: ["precio", "precio venta", "precio minorista", "minorista", "pvp"] },
  { clave: "precio_mayor", alias: ["precio mayor", "precio mayorista", "mayorista", "por mayor"] },
  { clave: "costo", alias: ["costo", "costo unitario", "compra"] },
  { clave: "stock", alias: ["stock", "cantidad", "existencia"] },
  { clave: "stock_minimo", alias: ["stock minimo", "stock mínimo", "minimo", "mínimo"] },
  { clave: "rubro", alias: ["rubro", "categoria", "categoría", "familia"] },
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

/** Detecta si el archivo usa coma, punto y coma o tabulación. */
function detectarSeparador(primeraLinea: string): string {
  const candidatos = ["\t", ";", ","];
  let mejor = ",";
  let max = 0;
  for (const sep of candidatos) {
    const n = partirLinea(primeraLinea, sep).length;
    if (n > max) { max = n; mejor = sep; }
  }
  return mejor;
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
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  /** Convierte el texto pegado o el CSV en filas con nombres de columna. */
  function parsear(contenido: string): { filas: any[]; aviso?: string } {
    const lineas = contenido.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lineas.length < 2) return { filas: [], aviso: "Hacen falta al menos el encabezado y una fila." };

    const sep = detectarSeparador(lineas[0]);
    const encabezados = partirLinea(lineas[0], sep).map(normalizar);

    // Mapea cada columna del archivo a un campo conocido.
    const mapa: Record<number, string> = {};
    encabezados.forEach((h, i) => {
      const col = COLUMNAS.find((c) => c.alias.some((a) => normalizar(a) === h));
      if (col) mapa[i] = col.clave;
    });

    const faltan = COLUMNAS.filter((c) => c.obligatoria && !Object.values(mapa).includes(c.clave));
    if (faltan.length > 0) {
      return {
        filas: [],
        aviso: `No encontré la columna "${faltan[0].clave}". El encabezado tiene que decir alguna de: ${faltan[0].alias.join(", ")}.`,
      };
    }

    const filas = lineas.slice(1).map((l) => {
      const partes = partirLinea(l, sep);
      const fila: any = {};
      partes.forEach((v, i) => { if (mapa[i]) fila[mapa[i]] = v; });
      return fila;
    });
    return { filas };
  }

  async function previsualizar(contenido: string) {
    setError(null);
    setRevisadas(null);
    const { filas: parseadas, aviso } = parsear(contenido);
    if (aviso) { setError(aviso); return; }
    setFilas(parseadas);
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

  function alElegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
            Traé toda tu lista de una. El encabezado tiene que tener al menos
            {" "}<b>codigo</b> y <b>nombre</b>; si además trae <b>precio</b>, <b>costo</b>,{" "}
            <b>stock</b>, <b>stock_minimo</b>, <b>precio_mayor</b> o <b>rubro</b>, se cargan también.
          </p>

          <Campo label="Opción 1 — subir el archivo (.csv)">
            <input type="file" accept=".csv,.txt,text/csv" onChange={alElegirArchivo} />
          </Campo>
          <p className="mut" style={{ marginTop: -4 }}>
            Si tenés un Excel, abrilo y usá "Guardar como" → CSV.
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
