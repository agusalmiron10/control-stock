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
  "insumos",
  "croquis",
  "acopio",
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
  insumos: {
    titulo: "Insumos y presupuestos a medida",
    detalle: "Stock de materiales de taller (cuero, hilo, hebillas…) para armar presupuestos a medida: calcula el costo y descuenta el material al aprobar.",
  },
  croquis: {
    titulo: "Foto o croquis del trabajo",
    detalle: "Adjuntar una foto de referencia o un boceto técnico a un presupuesto a medida — moldería, diseño, plano. Útil para marroquinería, carpintería, sastrería o cualquier trabajo a medida.",
  },
  acopio: {
    titulo: "Acopio de mercadería",
    detalle: "El cliente paga y reserva mercadería ahora, y la retira de a poco más adelante. El stock queda comprometido para la venta pero sigue en el depósito hasta cada retiro. Necesita también el módulo Remitos activo.",
  },
};

/**
 * Capacidades: CÓMO se comporta el sistema para este negocio, según el rubro
 * que eligió. Espejo de `Capacidades` en src/config.ts.
 *
 * Regla dura: ningún componente pregunta por el rubro. Se pregunta por la
 * capacidad. Sumar un rubro nuevo es una fila en la base, no un deploy.
 *   Prohibido:  if (rubro === "indumentaria")
 *   Correcto:   if (useCapacidad("permite_variantes"))
 */
export interface Capacidades {
  permite_variantes: boolean;
  tipos_variante: string[];
  permite_vencimientos: boolean;
  alerta_dias_antes_vencer: number;
  venta_fraccionada: boolean;
  requiere_numero_serie: boolean;
  precios_por_escala: boolean;
  producto_singular: string;
  producto_plural: string;
  unidad_default: string;
  categorias_sugeridas: string[];
  campos_extra_producto: string[];
  /** Qué vende el negocio, para el Concepto de ARCA. Se puede cambiar por comprobante. */
  concepto_default: "productos" | "servicios" | "ambos";
}

export const CAPACIDADES_INICIAL: Capacidades = {
  permite_variantes: false,
  tipos_variante: [],
  permite_vencimientos: false,
  alerta_dias_antes_vencer: 30,
  venta_fraccionada: false,
  requiere_numero_serie: false,
  precios_por_escala: false,
  producto_singular: "Producto",
  producto_plural: "Productos",
  unidad_default: "unidad",
  categorias_sugeridas: [],
  campos_extra_producto: [],
  concepto_default: "productos",
};

export interface ConfigNegocio {
  negocio: { nombre: string; rubro: string; telefono: string; instagram: string; logo: string | null };
  vocabulario: { producto_singular: string; producto_plural: string };
  modulos: Record<Modulo, boolean>;
  capacidades: Capacidades;
  /** Informativo: qué rubro eligió la cuenta. No se decide nada con esto. */
  rubro: { id: string | null; nombre: string | null; otro_texto: string | null; configurado: boolean };
}

export const CONFIG_INICIAL: ConfigNegocio = {
  negocio: { nombre: "Mi negocio", rubro: "", telefono: "", instagram: "", logo: null },
  vocabulario: { producto_singular: "Producto", producto_plural: "Productos" },
  modulos: Object.fromEntries(MODULOS.map((m) => [m, false])) as Record<Modulo, boolean>,
  capacidades: CAPACIDADES_INICIAL,
  rubro: { id: null, nombre: null, otro_texto: null, configurado: false },
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

/**
 * La única forma correcta de preguntar por el comportamiento del sistema.
 * Devuelve el valor de una capacidad para el negocio de la sesión.
 */
export function useCapacidad<K extends keyof Capacidades>(k: K): Capacidades[K] {
  return useContext(ConfigContext).capacidades[k];
}

/** Todas las capacidades juntas, para cuando hacen falta varias. */
export function useCapacidades(): Capacidades {
  return useContext(ConfigContext).capacidades;
}
