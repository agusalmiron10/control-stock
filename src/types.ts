import type { Context } from "hono";

/** Bindings del Worker (ver wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  BACKUPS: R2Bucket;
  /** Certificado del PROVEEDOR del sistema, en PEM. Uno solo para todos los
   *  negocios: cada uno delega el servicio a este CUIT desde ARCA. */
  ARCA_CERT_PEM: string;
  /** Clave privada de ese certificado, en PEM. Nunca va a la base. */
  ARCA_CLAVE_PEM: string;
  /** Webhook de Discord para alertas de error 500 en tiempo real (ver
   *  app.onError en src/index.ts). Opcional: si no está cargado, el error
   *  se sigue guardando en errores_sistema como siempre, sólo que sin aviso
   *  externo. Se carga con `wrangler secret put ALERTA_DISCORD_WEBHOOK`. */
  ALERTA_DISCORD_WEBHOOK?: string;
  /** API key de Resend (resend.com) para el correo diario de stock bajo y
   *  vencimientos próximos (ver src/scheduled.ts). Opcional: sin esto, el
   *  cron sigue corriendo el resto de sus tareas, sólo que no manda mails. */
  RESEND_API_KEY?: string;
  /** Remitente del correo de alertas, formato "Nombre <correo@dominio>".
   *  Tiene que ser un dominio verificado en Resend. Si no se carga, se usa
   *  un default (que va a fallar si ese dominio no está verificado ahí). */
  RESEND_FROM?: string;
}

export type Rol = "super" | "dueño" | "empleado" | "soporte";

/**
 * "soporte" es la cuenta del proveedor del sistema dentro de un negocio:
 * necesita el mismo acceso que el dueño para poder resolver problemas. No
 * aparece en el listado de usuarios, pero todo lo que hace queda en la
 * Auditoría. "super" es el proveedor a nivel sistema: no pertenece a ningún
 * negocio y puede entrar a cualquiera.
 */
export function esDuenoOSoporte(rol: Rol): boolean {
  return rol === "dueño" || rol === "soporte" || rol === "super";
}

/** Variables que la sesión deja disponibles en el contexto de Hono. */
export interface Variables {
  usuario: {
    uid: number;
    usuario: string;
    rol: Rol;
    /**
     * Negocio al que pertenecen los datos de esta sesión. Un super admin que
     * todavía no entró a ningún negocio lo tiene en null; en ese caso sólo
     * puede usar las rutas de /api/super.
     */
     negocioId: string | null;
    /** Id de la visita de soporte, si el proveedor entró a un negocio ajeno. */
    sesionSoporte: string | null;
    /** Visita de soporte en modo mirar y no tocar. */
    soloLectura: boolean;
  };
  /**
   * Config del negocio ya resuelta, memorizada para este request. La lee
   * configDe() en src/config.ts — sin esto, una request protegida por
   * requireModulo consulta la config una vez para el middleware y otra vez
   * adentro de la ruta.
   */
  configNegocio?: unknown;
}

/**
 * El negocio de la sesión actual. TODA consulta a datos de negocio tiene que
 * filtrar por esto — es lo único que separa a un cliente de otro.
 */
export function negocioDe(c: { get: (k: "usuario") => Variables["usuario"] }): string {
  const n = c.get("usuario").negocioId;
  if (!n) throw new Error("La sesión no tiene negocio asignado.");
  return n;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

// ── Filas de la base ────────────────────────────────────────
// clientes/herramientas/ventas/pagos usan id TEXT (UUID): el celular los
// puede generar sin hablar con el servidor. venta_items/movimientos_stock/
// precios_historial/presupuestos/presupuesto_items nunca se crean offline,
// así que sus id propios siguen siendo INTEGER autoincrement de servidor.

export interface Cliente {
  id: string;
  nombre: string;
  localidad: string | null;
  direccion: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  latitud: number | null;
  longitud: number | null;
  activo: number;
  creado_en: string;
  /** "CUIT" | "DNI" | null (consumidor final). Sólo obligatorio para Factura A. */
  doc_tipo: string | null;
  doc_numero: string | null;
  condicion_iva: CondicionIva | null;
}

export type CondicionIva = "responsable_inscripto" | "monotributo" | "exento";

export interface FacturacionConfig {
  negocio_id: string;
  activo: number;
  cuit: string | null;
  razon_social: string | null;
  condicion_iva: CondicionIva | null;
  punto_venta: number | null;
  ambiente: "homologacion" | "produccion";
  iva_porcentaje_defecto: number;
  /** Última vez que /probar-conexion confirmó que el negocio ya delegó el servicio en ARCA. null = todavía no se verificó. */
  delegacion_verificada_en: string | null;
  actualizado_en: string;
}

/** Código AFIP de tipo de comprobante. 1/6/11 = Factura A/B/C, 3/8/13 = NC A/B/C. */
export type TipoComprobante = 1 | 2 | 3 | 6 | 7 | 8 | 11 | 12 | 13;

export interface Factura {
  id: string;
  negocio_id: string;
  venta_id: string;
  factura_original_id: string | null;
  tipo_comprobante: TipoComprobante;
  punto_venta: number;
  numero: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  estado: "pendiente" | "autorizada" | "rechazada" | "error" | "huerfano";
  neto_gravado: number;
  iva: number;
  total: number;
  /** Una sola alícuota — con IVA mixto (ver iva_desglose) vale 0: ninguna sola la describe. */
  iva_porcentaje: number;
  /** JSON de DesgloseAlicuota[] cuando el comprobante mezcla alícuotas; null en el caso de siempre (una sola). */
  iva_desglose: string | null;
  doc_tipo: number;
  doc_numero: string;
  respuesta_afip: string | null;
  observaciones: string | null;
  creado_en: string;
  autorizado_en: string | null;
}

export interface Herramienta {
  id: string;
  codigo: string;
  /** EAN-13 del fabricante. Opcional: lo que se vende suelto no tiene. */
  codigo_barras: string | null;
  nombre: string;
  precio: number; // minorista, centavos
  precio_mayor: number; // mayorista, centavos
  rubro: string | null;
  costo: number;
  stock: number;
  stock_minimo: number;
  notas: string | null;
  activo: number;
  creado_en: string;
  /** Override de alícuota de IVA (centésimas de punto: 2100 = 21,00%). Sin usar todavía. */
  iva_porcentaje: number | null;
}

/**
 * Insumo = material de taller (cuero, hilo, hebillas…), NO producto de
 * catálogo. Stock aparte del de herramientas, y puede ser fraccionario
 * (2,5 metros), a diferencia del stock entero de herramientas.
 */
export interface Insumo {
  id: string;
  nombre: string;
  unidad_medida: string;
  costo_unitario: number; // centavos
  stock_actual: number; // puede ser fraccionario
  activo: number;
  creado_en: string;
}

export type EstadoVenta = "borrador" | "sincronizada" | "confirmada" | "anulada";
export type OrigenVenta = "celular" | "escritorio";

export interface Venta {
  id: string;
  numero: number;
  cliente_id: string;
  fecha: string;
  subtotal: number;
  descuento: number;
  total: number;
  nota: string | null;
  estado: EstadoVenta;
  origen: OrigenVenta;
  necesita_revision: number;
  motivo_revision: string | null;
  creado_en: string;
  sincronizado_en: string | null;
  /** Quién la cargó (usuarios.id) — para mostrar "Atendido por" en el papel. null en ventas de antes de este campo. */
  atendido_por: number | null;
  /** Acopio: el cliente paga ahora, pero el stock físico no baja hasta que
   *  se retira (de a poco) por remitos contra esta venta. Ver src/acopio.ts. */
  es_acopio: number;
}

export interface VentaItem {
  id: number;
  venta_id: string;
  herramienta_id: string;
  nombre_herramienta: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Pago {
  id: string;
  cliente_id: string;
  venta_id: string | null;
  fecha: string;
  monto: number;
  medio: string;
  nota: string | null;
  creado_en: string;
}

export interface Gasto {
  id: string;
  fecha: string;
  categoria: string;
  descripcion: string | null;
  /** Centavos, como todos los montos del sistema. */
  monto: number;
  medio_pago: string | null;
  atendido_por: number | null;
  creado_en: string;
}

export interface MovimientoStock {
  id: number;
  herramienta_id: string;
  fecha: string;
  tipo: string;
  cantidad: number;
  stock_resultante: number;
  venta_id: string | null;
  motivo: string | null;
  costo_unitario: number | null;
  /** Remito de retiro que originó este movimiento, sólo en acopio (ver src/acopio.ts). */
  remito_id: string | null;
}

export interface PrecioHistorial {
  id: number;
  herramienta_id: string;
  fecha: string;
  precio_anterior: number;
  precio_nuevo: number;
  tipo_precio: string; // 'minorista' | 'mayorista'
  motivo: string | null;
}

export interface Presupuesto {
  id: number;
  numero: number;
  cliente_id: string;
  fecha: string;
  subtotal: number;
  descuento: number;
  total: number;
  estado: "pendiente" | "aceptado" | "rechazado" | "vencido";
  valido_hasta: string | null;
  nota: string | null;
  venta_id: string | null;
  creado_en: string;
  /** Quién lo cargó (usuarios.id) — para mostrar "Atendido por" en el papel. null en presupuestos de antes de este campo. */
  atendido_por: number | null;
  /** Cuándo se descontó el stock de insumos (al aprobarlo). null = todavía no, o no tiene insumos. */
  insumos_descontados_en: string | null;
  /** Foto o boceto técnico del trabajo (croquis, moldería), como data URI. Sólo en presupuestos a medida. */
  croquis: string | null;
}

export interface PresupuestoItem {
  id: number;
  presupuesto_id: number;
  herramienta_id: string;
  nombre_herramienta: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

/** Un renglón del BOM (lista de materiales) de un presupuesto a medida. */
export interface PresupuestoInsumo {
  id: number;
  presupuesto_id: number;
  insumo_id: string;
  nombre_insumo: string;
  cantidad_requerida: number;
  costo_unitario: number; // centavos, copia histórica
}

export interface ResumenDiario {
  id: number;
  fecha: string;
  ventas_total: number;
  ventas_cant: number;
  cobranzas_total: number;
  cobranzas_cant: number;
  saldo_pendiente: number;
  clientes_con_deuda: number;
  stock_bajo_cant: number;
  generado_en: string;
}

/** Registro de idempotencia: una fila por operación de venta/pago ya procesada. */
export interface Operacion {
  idempotency_key: string;
  tipo: "venta" | "pago";
  entidad_id: string;
  resultado: string; // JSON serializado
  creado_en: string;
}

/** Proveedor al que este negocio le compra mercadería. */
export interface Proveedor {
  id: string;
  negocio_id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  cuit: string | null;
  notas: string | null;
  activo: number;
  creado_en: string;
}

/** Compra a un proveedor: sube el stock y recalcula el costo promedio. */
export interface Compra {
  id: string;
  negocio_id: string;
  numero: number;
  proveedor_id: string;
  fecha: string;
  comprobante: string | null;
  total: number;
  nota: string | null;
  estado: "registrada" | "anulada";
  creado_en: string;
}

export interface CompraItem {
  id: string;
  negocio_id: string;
  compra_id: string;
  herramienta_id: string;
  nombre_herramienta: string;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
}

/** Remito: el papel que acompaña a la mercadería. Nace de una venta y no
 *  toca el stock (ya se descontó al vender). Admite entregas parciales. */
export interface Remito {
  id: string;
  negocio_id: string;
  numero: number;
  venta_id: string;
  cliente_id: string;
  fecha: string;
  estado: "pendiente" | "entregado" | "anulado";
  transporte: string | null;
  domicilio: string | null;
  recibido_por: string | null;
  entregado_en: string | null;
  nota: string | null;
  creado_en: string;
  /** Quién lo cargó (usuarios.id) — para mostrar "Atendido por" en el papel. null en remitos de antes de este campo. */
  atendido_por: number | null;
}

export interface RemitoItem {
  id: string;
  negocio_id: string;
  remito_id: string;
  herramienta_id: string;
  nombre_herramienta: string;
  cantidad: number;
}
