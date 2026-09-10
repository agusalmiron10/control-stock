import { useState } from "react";
import { api } from "../api";
import { Cargando, Error, useCarga } from "./ui";

interface Rubro {
  id: string;
  nombre: string;
  icono: string | null;
}

/**
 * Primer ingreso: a qué se dedica este negocio.
 *
 * Lo que se elige acá no prende ni apaga funciones contratadas (eso lo
 * decide el proveedor): decide cómo se comporta el sistema — cómo se llama
 * a lo que vende, qué campos tiene un producto, qué categorías se sugieren.
 *
 * Los rubros salen de la base, no de una lista en el código: por eso esta
 * pantalla no sabe cuántos hay ni cuáles son.
 */
export function SeleccionRubro({ onListo }: { onListo: () => void }) {
  const { data, error, cargando } = useCarga<{ rubros: Rubro[] }>(() => api.get("/api/rubros"), []);
  const [elegido, setElegido] = useState<Rubro | null>(null);
  const [otroTexto, setOtroTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errGuardar, setErrGuardar] = useState<string | null>(null);

  const esOtro = elegido?.id === "otro";
  const puedeConfirmar = !!elegido && (!esOtro || otroTexto.trim().length > 0);

  async function confirmar() {
    if (!elegido || !puedeConfirmar) return;
    setErrGuardar(null);
    setGuardando(true);
    try {
      await api.post("/api/cuenta/rubro", {
        rubro_id: elegido.id,
        rubro_otro_texto: esOtro ? otroTexto.trim() : undefined,
      });
      onListo();
    } catch (err: any) {
      setErrGuardar(err.message);
      setGuardando(false);
    }
  }

  return (
    <div className="app">
      <main className="contenido" style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ textAlign: "center", margin: "24px 0 28px" }}>
          <h1 style={{ margin: 0 }}>¿A qué se dedica tu negocio?</h1>
          <p className="mut" style={{ margin: "8px 0 0" }}>
            Con esto el sistema se acomoda a tu rubro: cómo llamar a lo que vendés, qué datos
            tiene cada producto y qué categorías sugerirte. Lo podés cambiar después.
          </p>
        </div>

        {cargando && <Cargando />}
        <Error msg={error} />
        <Error msg={errGuardar} />

        <div className="grid-rubros">
          {(data?.rubros ?? []).map((r) => (
            <button
              key={r.id}
              type="button"
              className={`tarjeta-rubro ${elegido?.id === r.id ? "elegida" : ""}`}
              onClick={() => setElegido(r)}
            >
              <span className="tarjeta-rubro-icono">{r.icono ?? "🏪"}</span>
              <span>{r.nombre}</span>
            </button>
          ))}
        </div>

        {esOtro && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-body">
              <label className="campo">
                <span>Contanos a qué se dedica</span>
                <input
                  value={otroTexto}
                  onChange={(e) => setOtroTexto(e.target.value)}
                  placeholder="Ej: pinturería, pet shop, óptica…"
                  autoFocus
                  maxLength={80}
                />
              </label>
              <p className="mut" style={{ marginBottom: 0 }}>
                Arrancás con la configuración general. Si varios negocios piden lo mismo, lo
                agregamos como rubro propio.
              </p>
            </div>
          </div>
        )}

        <div className="btn-grupo" style={{ justifyContent: "center", marginTop: 24, marginBottom: 40 }}>
          <button
            className="btn primario"
            style={{ fontSize: 16, padding: "10px 28px" }}
            disabled={!puedeConfirmar || guardando}
            onClick={confirmar}
          >
            {guardando ? "Guardando…" : "Continuar"}
          </button>
        </div>
      </main>
    </div>
  );
}
