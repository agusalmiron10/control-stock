import { createContext, useContext } from "react";

export type Rol = "dueño" | "empleado" | "soporte" | "super";

/** Rol de la sesión activa. Un empleado no ve costos ni rentabilidad. */
export const RolContext = createContext<Rol>("dueño");

export function useRol(): Rol {
  return useContext(RolContext);
}

/**
 * "soporte" y "super" son cuentas del proveedor del sistema: ven lo mismo que
 * el dueño para poder resolver problemas. Todo lo que hacen queda en la
 * Auditoría del cliente.
 */
export function esDueno(rol: Rol): boolean {
  return rol === "dueño" || rol === "soporte" || rol === "super";
}

/**
 * Módulos que el dueño le habilitó a esta sesión. null = sin restricción
 * explícita (ve todo lo que el negocio tenga activo — el comportamiento de
 * siempre). Sólo un empleado puede tener acá una lista fija.
 */
export const PermisosContext = createContext<string[] | null>(null);

export function usePermisos(): string[] | null {
  return useContext(PermisosContext);
}
