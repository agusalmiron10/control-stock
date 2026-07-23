import { createContext, useContext } from "react";

export type Rol = "dueño" | "empleado";

/** Rol de la sesión activa. Un empleado no ve costos ni rentabilidad. */
export const RolContext = createContext<Rol>("dueño");

export function useRol(): Rol {
  return useContext(RolContext);
}

export function esDueno(rol: Rol): boolean {
  return rol === "dueño";
}
