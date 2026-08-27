import type { MiddlewareHandler } from "hono";
import { negocioDe, esDuenoOSoporte, type Env, type Variables, type Rol } from "./types";
import { HttpError } from "./validate";

/**
 * Módulos que se pueden prender y apagar por instalación. El núcleo (panel,
 * clientes, productos, ventas, pagos, ajustes) no se puede apagar: sin eso
 * no hay negocio que administrar.
 */
export const MODULOS = [
  /** Fiado: saldos por cliente, imputación de pagos, cobranzas. */
  "cuenta_corriente",
  /** Fabrico lo que vendo (el stock sube por producción). */
  "produccion",
  /** Compro para revender (el stock sube por compra a un proveedor). */
  "compras",
  /** Cotizaciones que después se convierten en venta. */
  "presupuestos",
  /** Segunda lista de precios además de la minorista. */
  "precio_mayorista",
  /** Vender desde el celular en la calle, sin señal. */
  "venta_rapida",
  /** El papel que acompaña la mercadería cuando sale. */
  "remitos",
  /** Escanear productos por código de barras. */
  "codigo_barras",
  /** Apertura y cierre de caja por turno. */
  "caja_turno",
  /** Registro de quién hizo qué (tiene sentido con más de un usuario). */
  "auditoria",
  /** Factura A/B/C con CAE real de ARCA, con Nota de Crédito al anular. */
  "facturacion_electronica",
] as const;

export type Modulo = (typeof MODULOS)[number];

export interface ConfigNegocio {
  negocio: { nombre: string; rubro: string; telefono: string; instagram: string };
  /** Cómo llama este negocio a lo que vende: "Herramienta", "Artículo", "Producto"… */
  vocabulario: { producto_singular: string; producto_plural: string };
  modulos: Record<Modulo, boolean>;
}

/** Para una instalación nueva sin configurar: lo mínimo que funciona en cualquier rubro. */
const MODULOS_POR_DEFECTO: Modulo[] = ["cuenta_corriente", "compras"];

function armarModulos(activos: Modulo[]): Record<Modulo, boolean> {
  return Object.fromEntries(MODULOS.map((m) => [m, activos.includes(m)])) as Record<Modulo, boolean>;
}

export async function leerConfig(env: Env, negocioId: string): Promise<ConfigNegocio> {
  const rows = await env.DB
    .prepare(`SELECT clave, valor FROM config WHERE negocio_id = ?`)
    .bind(negocioId)
    .all<{ clave: string; valor: string }>();
  const v = new Map((rows.results ?? []).map((r) => [r.clave, r.valor]));

  let activos: Modulo[] = MODULOS_POR_DEFECTO;
  const crudo = v.get("modulos");
  if (crudo) {
    try {
      const parsed = JSON.parse(crudo);
      if (Array.isArray(parsed)) activos = parsed.filter((m): m is Modulo => MODULOS.includes(m));
    } catch {
      // Config corrupta: mejor caer a los valores por defecto que romper la app.
    }
  }

  return {
    negocio: {
      nombre: v.get("negocio_nombre") ?? "Mi negocio",
      rubro: v.get("negocio_rubro") ?? "",
      telefono: v.get("negocio_telefono") ?? "",
      instagram: v.get("negocio_instagram") ?? "",
    },
    vocabulario: {
      producto_singular: v.get("producto_singular") ?? "Producto",
      producto_plural: v.get("producto_plural") ?? "Productos",
    },
    modulos: armarModulos(activos),
  };
}

export async function moduloActivo(env: Env, negocioId: string, modulo: Modulo): Promise<boolean> {
  const cfg = await leerConfig(env, negocioId);
  return cfg.modulos[modulo];
}

/** Lee la lista de módulos que el dueño le permitió a este usuario. null = sin restringir (ve todo lo activo). */
export async function modulosPermitidos(env: Env, negocioId: string, uid: number): Promise<Modulo[] | null> {
  const row = await env.DB.prepare(`SELECT modulos_permitidos FROM usuarios WHERE negocio_id = ? AND id = ?`)
    .bind(negocioId, uid)
    .first<{ modulos_permitidos: string | null }>();
  if (!row?.modulos_permitidos) return null;
  try {
    const parsed = JSON.parse(row.modulos_permitidos);
    return Array.isArray(parsed) ? parsed.filter((m): m is Modulo => MODULOS.includes(m)) : null;
  } catch {
    return null; // dato corrupto: mejor no restringir que romper el acceso
  }
}

/**
 * ¿Puede este usuario usar este módulo? El dueño, soporte y el proveedor
 * siempre pueden — la restricción por módulo es sólo para empleados, y sólo
 * si el dueño explícitamente les recortó la lista (por defecto ven todo lo
 * que el negocio tiene activo, igual que siempre).
 */
export async function usuarioPuedeModulo(env: Env, negocioId: string, uid: number, rol: Rol, modulo: Modulo): Promise<boolean> {
  if (esDuenoOSoporte(rol)) return true;
  const permitidos = await modulosPermitidos(env, negocioId, uid);
  return permitidos === null || permitidos.includes(modulo);
}

/**
 * Middleware: bloquea las rutas de un módulo que este negocio no tiene
 * activo, o que el dueño no le habilitó a este usuario en particular.
 * Devuelve 404 y no 403 a propósito — para quien no tiene acceso, la
 * funcionalidad directamente no existe.
 */
export function requireModulo(modulo: Modulo): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const neg = negocioDe(c);
    if (!(await moduloActivo(c.env, neg, modulo))) {
      throw new HttpError(404, "Esta función no está activa en este negocio.");
    }
    const u = c.get("usuario");
    if (!(await usuarioPuedeModulo(c.env, neg, u.uid, u.rol, modulo))) {
      throw new HttpError(404, "No tenés acceso a esta función. Pedile al dueño que te lo habilite.");
    }
    await next();
  };
}
