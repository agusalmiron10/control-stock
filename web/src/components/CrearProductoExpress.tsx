import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { aCentavos, pesos } from "../format";
import { Modal, Error, Campo } from "./ui";

interface Articulo { id: number; nombre: string; rubro: string }

interface Props {
  /** Si vino de un escaneo, el EAN que no estaba cargado. */
  codigoBarras?: string | null;
  /** Lo que el cajero ya había tipeado en el buscador. */
  nombreInicial?: string;
  onCerrar: () => void;
  /** Devuelve el producto ya creado, listo para meter en el carrito. */
  onCreado: (herramienta: any) => void;
}

/**
 * Alta de producto en tres datos, sin salir de la venta.
 *
 * La razón de existir de esta pantalla: si para vender algo que no está
 * cargado hay que irse a Productos, llenar ocho campos y volver, con un
 * cliente esperando en el mostrador, el ferretero deja de usar el sistema y
 * anota en el cuaderno. Nombre, precio y cantidad — el resto se completa
 * después, cuando no hay nadie enfrente.
 */
export function CrearProductoExpress({ codigoBarras, nombreInicial = "", onCerrar, onCreado }: Props) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [precio, setPrecio] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [rubro, setRubro] = useState<string | null>(null);
  const [catalogoId, setCatalogoId] = useState<number | null>(null);
  const [sugerencias, setSugerencias] = useState<Articulo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const precioRef = useRef<HTMLInputElement>(null);

  // Autocompletado contra el catálogo maestro. Con espera, para no pegarle al
  // servidor en cada tecla.
  useEffect(() => {
    const q = nombre.trim();
    if (q.length < 2 || catalogoId !== null) { setSugerencias([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ articulos: Articulo[] }>(`/api/catalogo?q=${encodeURIComponent(q)}`);
        setSugerencias(r.articulos);
      } catch { setSugerencias([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [nombre, catalogoId]);

  function elegirDelCatalogo(a: Articulo) {
    setNombre(a.nombre);
    setRubro(a.rubro);
    setCatalogoId(a.id);
    setSugerencias([]);
    precioRef.current?.focus();
  }

  async function guardar() {
    if (!nombre.trim()) { setError("Ponele un nombre al producto."); return; }
    // Sin precio no se puede vender: entraría al carrito en $0 y recién se
    // descubre al cobrar. Es uno de los tres datos, no un opcional.
    if (aCentavos(precio || "0") <= 0) { setError("Falta el precio de venta."); return; }
    setError(null);
    setGuardando(true);
    try {
      const r = await api.post<{ herramienta: any }>("/api/herramientas/express", {
        nombre: nombre.trim(),
        precio: aCentavos(precio || "0"),
        stock: Number(cantidad) || 0,
        codigo_barras: codigoBarras || null,
        rubro,
        catalogo_id: catalogoId,
      });
      onCreado(r.herramienta);
    } catch (e: any) {
      setError(e.message);
      setGuardando(false);
    }
  }

  const precioCent = aCentavos(precio || "0");

  return (
    <Modal titulo="Producto nuevo" onCerrar={onCerrar}>
      <Error msg={error} />

      {codigoBarras && (
        <div className="pill-alerta" style={{ marginTop: 0 }}>
          Se escaneó <b>{codigoBarras}</b> y no está cargado. Queda guardado con este producto, así
          que la próxima vez que lo pases se carga solo.
        </div>
      )}

      <Campo label="¿Qué es?">
        <input
          value={nombre}
          autoFocus
          placeholder="Ej: Tornillo autoperforante"
          onChange={(e) => { setNombre(e.target.value); setCatalogoId(null); setRubro(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") precioRef.current?.focus(); }}
        />
        {sugerencias.length > 0 && (
          <div className="sugerencias">
            {sugerencias.map((a) => (
              <button type="button" key={a.id} className="sugerencia" onClick={() => elegirDelCatalogo(a)}>
                <span>{a.nombre}</span>
                <span className="mut">{a.rubro}</span>
              </button>
            ))}
          </div>
        )}
        {rubro && <div className="mut" style={{ marginTop: 4 }}>Rubro: {rubro}</div>}
      </Campo>

      <div className="fila">
        <Campo label="Precio de venta ($)">
          <input
            ref={precioRef}
            className="num"
            type="number" step="0.01" min={0}
            value={precio}
            placeholder="0,00"
            onChange={(e) => setPrecio(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void guardar(); }}
          />
        </Campo>
        <Campo label="¿Cuántos tenés?">
          <input
            className="num"
            type="number" min={0}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void guardar(); }}
          />
        </Campo>
      </div>

      <p className="mut" style={{ marginTop: 4 }}>
        Con esto alcanza para vender. El costo, el rubro y el precio mayorista los podés completar
        después desde Productos.
      </p>

      <div className="btn-grupo" style={{ justifyContent: "flex-end", marginTop: 14 }}>
        <button className="btn" onClick={onCerrar}>Cancelar</button>
        <button className="btn primario" disabled={guardando} onClick={guardar}>
          {guardando ? "Creando…" : `Crear y agregar${precioCent > 0 ? ` (${pesos(precioCent)})` : ""}`}
        </button>
      </div>
    </Modal>
  );
}
