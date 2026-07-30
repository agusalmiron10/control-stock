import { useEffect, useState } from "react";
import { suscribirseAEstado } from "./sync";
import type { EstadoSync } from "./tipos";

const VACIO: EstadoSync = {
  pendientes: 0,
  conflictivas: 0,
  sincronizando: false,
  online: navigator.onLine,
  hayAtascadas: false,
  ultimoError: null,
};

export function useEstadoSync(): EstadoSync {
  const [estado, setEstado] = useState<EstadoSync>(VACIO);
  useEffect(() => suscribirseAEstado(setEstado), []);
  return estado;
}
