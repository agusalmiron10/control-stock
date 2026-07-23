import { useEffect, useState } from "react";

// Router mínimo basado en location.hash. Rutas: "#/panel", "#/clientes/12", etc.

export function parseHash(): { path: string; parts: string[] } {
  const raw = window.location.hash.replace(/^#/, "") || "/panel";
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = path.split("/").filter(Boolean);
  return { path, parts };
}

export function navegar(path: string): void {
  window.location.hash = path;
}

export function useRuta() {
  const [ruta, setRuta] = useState(parseHash());
  useEffect(() => {
    const on = () => setRuta(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return ruta;
}
