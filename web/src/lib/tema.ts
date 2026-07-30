// Preferencia de tema (claro/oscuro/automático). Es solo una preferencia de
// interfaz, no dato de negocio — localStorage alcanza y se lee sincrónico
// para no parpadear con el tema equivocado al cargar.
export type Tema = "claro" | "oscuro" | "auto";

const CLAVE = "cs_tema";

export function leerTema(): Tema {
  const v = localStorage.getItem(CLAVE);
  return v === "claro" || v === "oscuro" ? v : "auto";
}

export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === "auto") raiz.removeAttribute("data-theme");
  else raiz.setAttribute("data-theme", tema === "oscuro" ? "dark" : "light");
  localStorage.setItem(CLAVE, tema);
}

export function siguienteTema(actual: Tema): Tema {
  return actual === "auto" ? "claro" : actual === "claro" ? "oscuro" : "auto";
}
