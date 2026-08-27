import { createContext, useContext } from "react";
import { usePermisos } from "./rol";

export const MODULOS = [
  "cuenta_corriente",
  "produccion",
  "compras",
  "presupuestos",
  "precio_mayorista",
  "venta_rapida",
  "remitos",
  "codigo_barras",
  "caja_turno",
  "auditoria",
  "facturacion_electronica",
] as const;

export type Modulo = (typeof MODULOS)[number];

/** Etiqueta y explicación de cada módulo, para la pantalla de Ajustes. */
export const INFO_MODULOS: Record<Modulo, { titulo: string; detalle: string }> = {
  cuenta_corriente: {
    titulo: "Cuenta corriente (fiado)",
    detalle: "Llevar el saldo de cada cliente, imputar pagos y ver a quién cobrarle.",
  },
  produccion: {
    titulo: "Producción",
    detalle: "Para negocios que fabrican lo que venden: el stock sube al producir.",
  },
  compras: {
    titulo: "Compras y proveedores",
    detalle: "Para negocios que compran para revender: el stock sube al comprarle a un proveedor.",
  },
  remitos: {
    titulo: "Remitos",
    detalle: "El papel que acompaña la mercadería. Permite entregas parciales de una misma venta.",
  },
  presupuestos: {
    titulo: "Presupuestos",
    detalle: "Cotizar antes de vender y después convertir el presupuesto en venta.",
  },
  precio_mayorista: {
    titulo: "Precio mayorista",
    detalle: "Una segunda lista de precios además de la minorista.",
  },
  venta_rapida: {
    titulo: "Venta rápida en el celular",
    detalle: "Vender desde el teléfono en la calle, aunque no haya señal, y revisarlo después.",
  },
  codigo_barras: {
    titulo: "Código de barras",
    detalle: "Escanear productos con la cámara para cargarlos en la venta.",
  },
  caja_turno: {
    titulo: "Caja por turno",
    detalle: "Apertura y cierre de caja para controlar el efectivo de cada turno.",
  },
  auditoria: {
    titulo: "Auditoría",
    detalle: "Registrar quién anuló, borró o modificó cada cosa. Útil con más de un usuario.",
  },
  facturacion_electronica: {
    titulo: "Facturación electrónica (ARCA)",
    detalle: "Emitir Factura A/B/C con CAE real desde una venta, con certificado digital propio de este negocio.",
  },
};

export interface ConfigNegocio {
  negocio: { nombre: string; rubro: string; telefono: string; instagram: string };
  vocabulario: { producto_singular: string; producto_plural: string };
  modulos: Record<Modulo, boolean>;
}

export const CONFIG_INICIAL: ConfigNegocio = {
  negocio: { nombre: "Mi negocio", rubro: "", telefono: "", instagram: "" },
  vocabulario: { producto_singular: "Producto", producto_plural: "Productos" },
  modulos: Object.fromEntries(MODULOS.map((m) => [m, false])) as Record<Modulo, boolean>,
};

/**
 * Copia a nivel de módulo, para el código que no es un componente de React
 * (armado de mensajes de WhatsApp, generación de Excel). Los componentes
 * usan el contexto de abajo.
 */
let configActual: ConfigNegocio = CONFIG_INICIAL;

export function getConfig(): ConfigNegocio {
  return configActual;
}

export function setConfig(c: ConfigNegocio): void {
  configActual = c;
}

export const ConfigContext = createContext<ConfigNegocio>(CONFIG_INICIAL);

export function useConfig(): ConfigNegocio {
  return useContext(ConfigContext);
}

/**
 * ¿Puede esta sesión usar este módulo? Hace falta que el negocio lo tenga
 * activo Y que el dueño no le haya recortado el acceso a este usuario en
 * particular (permisos == null significa "sin restricción explícita").
 */
export function moduloVisible(activoEnNegocio: boolean, permisos: string[] | null, m: Modulo): boolean {
  return activoEnNegocio && (permisos === null || permisos.includes(m));
}

export function useModulo(m: Modulo): boolean {
  const activo = useContext(ConfigContext).modulos[m];
  const permisos = usePermisos();
  return moduloVisible(activo, permisos, m);
}

/** Cómo llama este negocio a lo que vende ("Herramienta" / "Artículo" / "Producto"). */
export function useVocab(): { singular: string; plural: string } {
  const { vocabulario } = useContext(ConfigContext);
  return { singular: vocabulario.producto_singular, plural: vocabulario.producto_plural };
}
