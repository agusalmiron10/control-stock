import React, { useEffect, useState } from "react";

/** Modal genérico. */
export function Modal({
  titulo,
  ancho,
  children,
  onCerrar,
  pie,
}: {
  titulo: string;
  ancho?: boolean;
  children: React.ReactNode;
  onCerrar: () => void;
  pie?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);

  return (
    <div className="modal-fondo" onMouseDown={onCerrar}>
      <div className={`modal ${ancho ? "ancho" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{titulo}</h3>
        <div className="modal-body">{children}</div>
        {pie && <div className="modal-pie">{pie}</div>}
      </div>
    </div>
  );
}

/** Diálogo de confirmación reutilizable. */
export function Confirmar({
  mensaje,
  textoConfirmar = "Confirmar",
  peligro,
  onSi,
  onNo,
}: {
  mensaje: string;
  textoConfirmar?: string;
  peligro?: boolean;
  onSi: () => void;
  onNo: () => void;
}) {
  return (
    <Modal
      titulo="Confirmar"
      onCerrar={onNo}
      pie={
        <>
          <button className="btn" onClick={onNo}>
            Cancelar
          </button>
          <button className={`btn ${peligro ? "peligro" : "primario"}`} onClick={onSi}>
            {textoConfirmar}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{mensaje}</p>
    </Modal>
  );
}

export function Error({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="error-box">{msg}</div>;
}

export function Cargando() {
  return <div className="spinner">Cargando…</div>;
}

export function Vacio({ mensaje, accion }: { mensaje: string; accion?: React.ReactNode }) {
  return (
    <div className="vacio">
      <p>{mensaje}</p>
      {accion}
    </div>
  );
}

/** Campo controlado simple. */
export function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="campo">
      <label>{label}</label>
      {children}
    </div>
  );
}

/** Hook de estado async para cargar datos. */
export function useCarga<T>(fn: () => Promise<T>, deps: React.DependencyList): {
  data: T | null;
  error: string | null;
  cargando: boolean;
  recargar: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    fn()
      .then((d) => vivo && setData(d))
      .catch((e) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, error, cargando, recargar: () => setTick((t) => t + 1) };
}
