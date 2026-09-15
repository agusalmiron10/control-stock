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
  /** Materiales de taller (BOM) para presupuestos a medida: stock aparte,
   *  costo de materiales y control de faltante al aprobar. */
  "insumos",
  /** Foto o boceto técnico adjunto a un presupuesto a medida (moldería,
   *  diseño, referencia). Útil para marroquinería, carpintería, sastrería y
   *  cualquier trabajo a medida — no es específico de un rubro. */
  "croquis",
  /** El cliente paga y reserva mercadería ahora, y la retira de a poco más
   *  adelante: el stock queda comprometido (no se puede vender dos veces)
   *  pero sigue físicamente en el depósito hasta cada retiro. Necesita el
   *  módulo "remitos" también activo — es el mecanismo que usa para
   *  registrar cada retiro parcial (ver src/acopio.ts). */
  "acopio",
  /** La plata que sale y no es mercadería (alquiler, sueldos, servicios,
   *  impuestos). Es lo que convierte el margen bruto del reporte de
   *  rentabilidad en una ganancia de verdad. */
  "gastos",
] as const;

export type Modulo = (typeof MODULOS)[number];

/**
 * Capacidades: CÓMO se comporta el sistema para este negocio.
 *
 * Ojo con la diferencia, que es la que sostiene todo el diseño:
 *   · MODULOS      → qué funciones tiene CONTRATADAS. Las prende el proveedor
 *                    (es lo que se vende). El rubro no las toca nunca.
 *   · CAPACIDADES  → cómo se comporta el producto para ese rubro. Salen del
 *                    perfil del rubro que eligió la cuenta, más su override.
 *
 * Regla dura para todo el código de la app: NUNCA preguntar por el rubro.
 * Prohibido:  if (rubro === "indumentaria")
 * Correcto:   if (cfg.capacidades.permite_variantes)
 * Así sumar un rubro es insertar una fila en la base, no un deploy.
 */
export interface Capacidades {
  /** Variantes de un mismo producto (talle, color). */
  permite_variantes: boolean;
  tipos_variante: string[];
  /** Fecha de vencimiento por producto, con aviso anticipado. */
  permite_vencimientos: boolean;
  alerta_dias_antes_vencer: number;
  /** Vender por kg/metro, con decimales. */
  venta_fraccionada: boolean;
  /** Número de serie y garantía por unidad vendida. */
  requiere_numero_serie: boolean;
  /** Precio por cantidad (distinto del módulo precio_mayorista, que es una segunda lista). */
  precios_por_escala: boolean;
  /** Cómo llama este negocio a lo que vende. Es la "etiqueta_producto". */
  producto_singular: string;
  producto_plural: string;
  unidad_default: string;
  /** Se ofrecen como sugerencia al cargar un producto; no obligan a nada. */
  categorias_sugeridas: string[];
  /** Campos libres extra del producto, ej. ["marca", "medida"]. */
  campos_extra_producto: string[];
  /**
   * Qué vende este negocio, para el campo Concepto de ARCA. Es el valor por
   * defecto al facturar; en cada comprobante se puede cambiar.
   */
  concepto_default: "productos" | "servicios" | "ambos";
}

/**
 * Default seguro: lo mínimo que funciona en cualquier rubro. Todo lo que
 * cambia el esquema arranca apagado, así una cuenta sin rubro configurado
 * (o con un perfil a medio cargar) se comporta como siempre.
 */
export const CAPACIDADES_DEFECTO: Capacidades = {
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
  /** Cómo llama este negocio a lo que vende: "Herramienta", "Artículo", "Producto"… */
  vocabulario: { producto_singular: string; producto_plural: string };
  modulos: Record<Modulo, boolean>;
  capacidades: Capacidades;
  /** Qué rubro eligió la cuenta. Es SÓLO informativo: no se decide nada con esto. */
  rubro: { id: string | null; nombre: string | null; otro_texto: string | null; configurado: boolean };
}

/** Para una instalación nueva sin configurar: lo mínimo que funciona en cualquier rubro. */
const MODULOS_POR_DEFECTO: Modulo[] = ["cuenta_corriente", "compras"];

function armarModulos(activos: Modulo[]): Record<Modulo, boolean> {
  return Object.fromEntries(MODULOS.map((m) => [m, activos.includes(m)])) as Record<Modulo, boolean>;
}

/**
 * Deja pasar SÓLO las capacidades conocidas y con el tipo correcto.
 *
 * Es el único validador del esquema de capacidades, y por eso lo usan los
 * dos caminos: la lectura (un capacidades_json roto degrada al default en
 * vez de romper la app de un cliente) y la escritura desde el editor del
 * super-admin (lo que se guarda ya queda limpio, no texto libre suelto).
 */
export function limpiarCapacidades(entrada: unknown): Partial<Capacidades> {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return {};
  const capa = entrada as Record<string, unknown>;
  const salida: Record<string, unknown> = {};

  const texto = (x: unknown) => (typeof x === "string" && x.trim() !== "" ? x.trim() : null);
  // Se recortan además de filtrar: un "  medida  " sin recortar sería una
  // clave distinta de "medida" y no encontraría los datos ya guardados.
  const lista = (x: unknown) =>
    Array.isArray(x)
      ? x.filter((i): i is string => typeof i === "string" && i.trim() !== "").map((i) => i.trim())
      : null;

  for (const [clave, valor] of Object.entries(capa)) {
    switch (clave) {
      case "permite_variantes":
      case "permite_vencimientos":
      case "venta_fraccionada":
      case "requiere_numero_serie":
      case "precios_por_escala":
        if (typeof valor === "boolean") salida[clave] = valor;
        break;
      case "alerta_dias_antes_vencer":
        if (typeof valor === "number" && Number.isFinite(valor) && valor >= 0) salida[clave] = Math.round(valor);
        break;
      case "producto_singular":
      case "producto_plural":
      case "unidad_default": {
        const t = texto(valor);
        if (t) salida[clave] = t;
        break;
      }
      case "concepto_default":
        if (valor === "productos" || valor === "servicios" || valor === "ambos") salida[clave] = valor;
        break;
      case "tipos_variante":
      case "categorias_sugeridas":
      case "campos_extra_producto": {
        const l = lista(valor);
        if (l) salida[clave] = l;
        break;
      }
      // Cualquier otra clave se ignora a propósito: puede ser de una versión
      // más nueva del esquema, o basura. Ni rompe ni se cuela.
    }
  }
  return salida as Partial<Capacidades>;
}

function aplicarCapa(base: Capacidades, crudo: string | null | undefined): Capacidades {
  if (!crudo) return base;
  try {
    return { ...base, ...limpiarCapacidades(JSON.parse(crudo)) };
  } catch {
    return base;
  }
}

/**
 * Resuelve capacidades: default → perfil del rubro → override de la cuenta.
 * El override siempre gana. Exportada porque además de leerConfig la usa la
 * previsualización de "¿qué pasa si me cambio de rubro?".
 */
export function resolverCapacidades(
  perfilJson: string | null | undefined,
  overrideJson: string | null | undefined
): Capacidades {
  return aplicarCapa(aplicarCapa(CAPACIDADES_DEFECTO, perfilJson), overrideJson);
}

export async function leerConfig(env: Env, negocioId: string): Promise<ConfigNegocio> {
  const [rows, rubro, logoRow] = await Promise.all([
    env.DB
      .prepare(`SELECT clave, valor FROM config WHERE negocio_id = ?`)
      .bind(negocioId)
      .all<{ clave: string; valor: string }>(),
    env.DB
      .prepare(
        `SELECT n.rubro_id, n.rubro_otro_texto, n.config_override_json, n.rubro_configurado_en,
                r.nombre AS rubro_nombre, p.capacidades_json
           FROM negocios n
           LEFT JOIN rubros          r ON r.id = n.rubro_id
           LEFT JOIN perfiles_config p ON p.id = r.perfil_id
          WHERE n.id = ?`
      )
      .bind(negocioId)
      .first<{
        rubro_id: string | null;
        rubro_otro_texto: string | null;
        config_override_json: string | null;
        rubro_configurado_en: string | null;
        rubro_nombre: string | null;
        capacidades_json: string | null;
      }>(),
    // El logo que va en el papel (factura, remito, presupuesto) es la foto
    // de perfil del dueño — no hay un campo de "logo" aparte todavía, y es
    // lo que el dueño ya tiene cargado. Si hay más de un dueño, se usa el
    // primero que le subió una foto; si ninguno subió, no hay logo.
    env.DB
      .prepare(
        `SELECT foto FROM usuarios WHERE negocio_id = ? AND rol = 'dueño' AND foto IS NOT NULL ORDER BY id LIMIT 1`
      )
      .bind(negocioId)
      .first<{ foto: string }>(),
  ]);
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

  // El override de la cuenta siempre le gana al perfil del rubro. Es lo que
  // permite que una cuenta se salga del molde sin inventarle un perfil.
  const capacidades = resolverCapacidades(rubro?.capacidades_json, rubro?.config_override_json);

  return {
    negocio: {
      nombre: v.get("negocio_nombre") ?? "Mi negocio",
      // OJO: este "rubro" es otra cosa — es el texto libre que se imprime en
      // el comprobante ("Herramientas — Ventas por mayor y por menor"). El
      // rubro que decide capacidades es el de abajo. Nombres heredados.
      rubro: v.get("negocio_rubro") ?? "",
      telefono: v.get("negocio_telefono") ?? "",
      instagram: v.get("negocio_instagram") ?? "",
      logo: logoRow?.foto ?? null,
    },
    // El vocabulario sale de las capacidades ya resueltas. Se mantiene la
    // forma vieja del objeto para no romper a nadie que ya lo consuma.
    vocabulario: {
      producto_singular: capacidades.producto_singular,
      producto_plural: capacidades.producto_plural,
    },
    modulos: armarModulos(activos),
    capacidades,
    rubro: {
      id: rubro?.rubro_id ?? null,
      nombre: rubro?.rubro_nombre ?? null,
      otro_texto: rubro?.rubro_otro_texto ?? null,
      configurado: !!rubro?.rubro_configurado_en,
    },
  };
}

/**
 * Guarda ajustes finos de ESTA cuenta, mezclándolos con los que ya tenía.
 *
 * Es el único lugar donde se escriben capacidades a nivel cuenta. Importa
 * que sea uno solo: si el vocabulario se pudiera guardar además en la tabla
 * `config`, habría dos casas para el mismo dato y tarde o temprano se
 * contradicen.
 */
export async function guardarOverride(
  env: Env,
  negocioId: string,
  parcial: Partial<Capacidades>
): Promise<void> {
  const fila = await env.DB
    .prepare(`SELECT config_override_json FROM negocios WHERE id = ?`)
    .bind(negocioId)
    .first<{ config_override_json: string | null }>();

  let actual: Record<string, unknown> = {};
  try {
    const parsed = fila?.config_override_json ? JSON.parse(fila.config_override_json) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) actual = parsed;
  } catch {
    // Override corrupto: se pisa con lo nuevo en vez de arrastrar la basura.
  }

  await env.DB
    .prepare(`UPDATE negocios SET config_override_json = ? WHERE id = ?`)
    .bind(JSON.stringify({ ...actual, ...parcial }), negocioId)
    .run();
}

/**
 * La config del request actual, leída una sola vez. Sin esto, una ruta
 * protegida por requireModulo consulta la config para el middleware y otra
 * vez adentro de la ruta. El memo vive en el contexto de Hono (por request),
 * nunca en un módulo: el isolate de Workers se reusa entre requests y una
 * caché global filtraría config de un negocio a otro.
 */
export async function configDe(c: {
  env: Env;
  get: (k: any) => any;
  set: (k: any, v: any) => void;
}): Promise<ConfigNegocio> {
  const memo = c.get("configNegocio") as ConfigNegocio | undefined;
  if (memo) return memo;
  const cfg = await leerConfig(c.env, negocioDe(c as any));
  c.set("configNegocio", cfg);
  return cfg;
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
    // configDe y no moduloActivo: así la ruta que viene atrás reusa esta
    // misma lectura en vez de volver a consultar la base.
    const cfg = await configDe(c);
    if (!cfg.modulos[modulo]) {
      throw new HttpError(404, "Esta función no está activa en este negocio.");
    }
    const u = c.get("usuario");
    if (!(await usuarioPuedeModulo(c.env, neg, u.uid, u.rol, modulo))) {
      throw new HttpError(404, "No tenés acceso a esta función. Pedile al dueño que te lo habilite.");
    }
    await next();
  };
}
