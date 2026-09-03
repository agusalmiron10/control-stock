import { Hono } from "hono";
import type { Env, Variables, Venta, Cliente, FacturacionConfig, CondicionIva, Factura } from "../types";
import { HttpError, texto, entero, enumerado, fechaISO, normalizarBusqueda } from "../validate";
import { negocioDe } from "../types";
import { requireDueno } from "../auth";
import { requireModulo } from "../config";
import { auditarDe } from "../auditoria";
import { armarAnulacionVenta } from "../ventas-anular";
import { obtenerTicketAcceso, hayCertificadoDelProveedor } from "../facturacion/wsaa";
import { feDummy, feCaeSolicitar, feCompUltimoAutorizado, feCompConsultar, feParamGetPtosVenta, SinDelegacion } from "../facturacion/wsfe";
import {
  calcularNetoIva,
  codigoDocumento,
  inferirTipoComprobante,
  validarDocumentoParaTipo,
  TIPO_FACTURA,
  TIPO_NOTA_CREDITO,
} from "../facturacion/calculo";

export const facturacion = new Hono<{ Bindings: Env; Variables: Variables }>();
facturacion.use("*", requireModulo("facturacion_electronica"));

const CONDICIONES_IVA = ["responsable_inscripto", "monotributo", "exento"] as const;
const LETRAS = ["A", "B", "C"] as const;

// Consumidor Final por defecto; se ajusta según el cliente al emitir.
// Códigos RG 5259/2022 — reconfirmar contra el manual vigente en la Fase 7.
const CONDICION_IVA_RECEPTOR: Record<CondicionIva | "consumidor_final", number> = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributo: 6,
};

/**
 * ARCA contesta con SOAP crudo cuando algo falla. Mostrarle ese XML al que
 * está facturando no sirve de nada: acá se traduce a algo accionable. El
 * texto original igual se guarda en `respuesta_afip` para poder revisarlo.
 */
function mensajeAmigable(err: unknown): string {
  const crudo = String((err as any)?.message ?? err);
  if (/cms|certificad|certificate|firma|signature/i.test(crudo)) {
    return "ARCA no aceptó el certificado. Puede estar vencido o no habilitado para este CUIT — revisalo en Ajustes → Facturación.";
  }
  if (/token|expired|autentic|auth/i.test(crudo)) {
    return "No se pudo iniciar sesión en ARCA. Probá de nuevo en unos minutos.";
  }
  if (/timeout|network|fetch|ECONN|502|503|504/i.test(crudo)) {
    return "ARCA no está respondiendo en este momento. La venta quedó guardada: probá facturarla de nuevo más tarde.";
  }
  if (crudo.length > 200) {
    return "ARCA rechazó el comprobante. El detalle quedó guardado en la pantalla de Facturas.";
  }
  return `ARCA rechazó el comprobante: ${crudo}`;
}

/**
 * ¿ARCA nos contestó, o nunca supimos qué pasó?
 *
 * Si contestó (aunque sea rechazando), el comprobante NO quedó emitido y se
 * puede reintentar tranquilo. Si fue un corte de red o un timeout, pudo
 * haberlo autorizado igual: ahí NO se reintenta, se consulta.
 *
 * Ante la duda devuelve false, o sea "no sabemos": es la opción segura —
 * como mucho obliga a una verificación de más, en vez de arriesgar una
 * factura duplicada.
 */
function esRespuestaDeArca(err: unknown): boolean {
  const m = String((err as any)?.message ?? err);
  // Estos textos los arma nuestro propio cliente al parsear la respuesta,
  // así que sólo aparecen cuando ARCA efectivamente contestó algo.
  return /ARCA (rechazó|no autorizó)|WSFE respondió|WSAA respondió|no devolvió un ticket|sin token\/sign/i.test(m);
}

/**
 * Qué mostrarle al usuario sobre un comprobante que no salió.
 *
 * Para un huérfano NO se usa el mensaje genérico: ese invita a reintentar, y
 * reintentar es justo lo que puede dejar dos facturas para una misma venta.
 */
function motivoDe(estado: string, respuesta: string | null): string | null {
  if (estado === "huerfano") {
    return "Se cortó la comunicación y no sabemos si ARCA llegó a emitirla. Verificala antes de volver a facturar esta venta.";
  }
  return respuesta ? mensajeAmigable(respuesta) : null;
}

function hoyAAAAMMDD(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function leerConfigFiscal(env: Env, negocioId: string): Promise<FacturacionConfig | null> {
  return env.DB.prepare(`SELECT * FROM facturacion_config WHERE negocio_id = ?`).bind(negocioId).first<FacturacionConfig>();
}

/**
 * Qué le falta a este negocio para poder facturar, en criollo. `null` = está
 * todo listo. Se usa para bloquear la emisión y, sobre todo, para que la
 * pantalla no ofrezca facturar cuando de antemano se sabe que no se puede.
 */
function motivoNoLista(cfg: FacturacionConfig | null): string | null {
  if (!cfg || !cfg.activo) return "La facturación electrónica todavía no está configurada para este negocio.";
  if (!cfg.cuit || !cfg.condicion_iva || !cfg.punto_venta) {
    return "Faltan datos fiscales: CUIT, condición de IVA o punto de venta.";
  }
  // El certificado ya no es por negocio: hay uno solo, del proveedor. Lo que
  // puede faltar del lado del cliente es la delegación del servicio en ARCA,
  // y eso se detecta recién al llamar (error 600), no mirando la config.
  return null;
}

function exigirConfigLista(cfg: FacturacionConfig | null): FacturacionConfig {
  const motivo = motivoNoLista(cfg);
  if (motivo) throw new HttpError(409, motivo);
  return cfg!;
}

// ── Config fiscal ──────────────────────────────────────────
facturacion.get("/config", requireDueno, async (c) => {
  const cfg = await leerConfigFiscal(c.env, negocioDe(c));
  if (!cfg) return c.json({ configurado: false });
  // Nunca se devuelve la clave privada ni su cifrado.
  return c.json({
    configurado: true,
    activo: !!cfg.activo,
    cuit: cfg.cuit,
    razon_social: cfg.razon_social,
    condicion_iva: cfg.condicion_iva,
    punto_venta: cfg.punto_venta,
    ambiente: cfg.ambiente,
    iva_porcentaje_defecto: cfg.iva_porcentaje_defecto,
    // El certificado ya no es por negocio: es uno solo, del proveedor,
    // cargado como secret del Worker. Esto informa si ESE existe, no si
    // este negocio subió algo — no hay nada que este negocio tenga que
    // subir.
    tiene_certificado: hayCertificadoDelProveedor(c.env),
  });
});

/**
 * Datos del emisor para imprimir el comprobante fiscal. Sin requireDueno a
 * propósito: cualquier usuario de este negocio necesita poder imprimir una
 * factura — no es información sensible, va impresa en el papel igual.
 */
facturacion.get("/emisor", async (c) => {
  const cfg = await leerConfigFiscal(c.env, negocioDe(c));
  const motivo = motivoNoLista(cfg);
  if (!cfg) return c.json({ configurado: false, listo: false, motivo });
  return c.json({
    configurado: true,
    // `listo` es lo que mira la pantalla para decidir si ofrece facturar.
    // Que el módulo esté prendido no alcanza: falta el certificado hasta que
    // el dueño lo carga.
    listo: motivo === null,
    motivo,
    cuit: cfg.cuit,
    razon_social: cfg.razon_social,
    condicion_iva: cfg.condicion_iva,
    ambiente: cfg.ambiente,
  });
});

facturacion.put("/config", requireDueno, async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const cuit = texto(b.cuit, "CUIT", { max: 20 })!;
  if (!/^\d{11}$/.test(cuit.replace(/-/g, ""))) throw new HttpError(400, "El CUIT tiene que tener 11 dígitos.");
  const razonSocial = texto(b.razon_social, "razón social", { max: 120 })!;
  const condicionIva = enumerado(b.condicion_iva, "condición de IVA", CONDICIONES_IVA);
  const puntoVenta = entero(b.punto_venta, "punto de venta", { min: 1, max: 9999 });
  const ambiente = enumerado(b.ambiente ?? "homologacion", "ambiente", ["homologacion", "produccion"] as const);
  const ivaDefecto = entero(b.iva_porcentaje_defecto ?? 2100, "% IVA por defecto", { min: 0, max: 2700 });

  await c.env.DB.prepare(
    `INSERT INTO facturacion_config (negocio_id, cuit, razon_social, condicion_iva, punto_venta, ambiente, iva_porcentaje_defecto)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(negocio_id) DO UPDATE SET
       cuit=excluded.cuit, razon_social=excluded.razon_social, condicion_iva=excluded.condicion_iva,
       punto_venta=excluded.punto_venta, ambiente=excluded.ambiente, iva_porcentaje_defecto=excluded.iva_porcentaje_defecto,
       -- Cambiar de ambiente invalida el ticket cacheado del otro.
       wsaa_token=NULL, wsaa_sign=NULL, wsaa_expira_en=NULL,
       actualizado_en=datetime('now')`
  )
    .bind(neg, cuit.replace(/-/g, ""), razonSocial, condicionIva, puntoVenta, ambiente, ivaDefecto)
    .run();

  return c.json({ ok: true });
});

facturacion.post("/activar", requireDueno, async (c) => {
  const neg = negocioDe(c);
  const cfg = await leerConfigFiscal(c.env, neg);
  if (!cfg || !cfg.cuit) {
    throw new HttpError(409, "Completá los datos fiscales antes de activar.");
  }
  // El certificado es del proveedor, uno solo para toda la instalación —
  // sin él, activar igual sería mentirle al dueño: no va a poder emitir
  // nada hasta que esté cargado del lado del sistema, no del suyo.
  if (!hayCertificadoDelProveedor(c.env)) {
    throw new HttpError(
      409,
      "El sistema todavía no tiene cargado el certificado de ARCA. Es un paso que hace el proveedor una sola vez, para todos los negocios — avisale."
    );
  }
  await c.env.DB.prepare(`UPDATE facturacion_config SET activo = 1, actualizado_en = datetime('now') WHERE negocio_id = ?`)
    .bind(neg)
    .run();
  return c.json({ ok: true });
});

facturacion.post("/desactivar", requireDueno, async (c) => {
  await c.env.DB.prepare(`UPDATE facturacion_config SET activo = 0, actualizado_en = datetime('now') WHERE negocio_id = ?`)
    .bind(negocioDe(c))
    .run();
  return c.json({ ok: true });
});

/**
 * Verifica de punta a punta que este negocio puede facturar:
 *   1. ARCA está arriba.
 *   2. El certificado del proveedor sirve para autenticarse.
 *   3. Este negocio ya delegó el servicio (si no, ARCA contesta 600).
 *   4. Qué puntos de venta tiene habilitados para web services.
 *
 * Cada paso devuelve un mensaje que el dueño de la ferretería pueda accionar
 * sin llamar por teléfono.
 */
facturacion.post("/probar-conexion", requireDueno, async (c) => {
  const neg = negocioDe(c);
  const cfg = await leerConfigFiscal(c.env, neg);
  if (!cfg?.cuit) throw new HttpError(409, "Primero cargá el CUIT del negocio.");

  const dummy = await feDummy(cfg.ambiente);

  let cred;
  try {
    cred = await credencialesPara(c.env, cfg);
  } catch (err: any) {
    if (err instanceof HttpError && err.status === 409) throw err;
    throw new HttpError(502, mensajeAmigable(err));
  }

  let puntos;
  try {
    puntos = await feParamGetPtosVenta(cred);
  } catch (err: any) {
    if (err instanceof SinDelegacion) {
      return c.json({
        ok: false,
        paso: "delegacion",
        arca: dummy,
        mensaje:
          `Falta un trámite tuyo en ARCA: entrá con tu clave fiscal a "Administrador de Relaciones", ` +
          `y delegá el servicio "Facturación Electrónica" al CUIT del sistema. ` +
          `Es una sola vez y no tenés que darnos ninguna contraseña.`,
      });
    }
    throw err;
  }

  const habilitados = puntos.filter((p) => !p.bloqueado);
  await c.env.DB
    .prepare(`UPDATE facturacion_config SET delegacion_verificada_en = datetime('now') WHERE negocio_id = ?`)
    .bind(neg)
    .run();

  return c.json({
    ok: true,
    paso: "listo",
    arca: dummy,
    puntos_venta: habilitados,
    mensaje:
      habilitados.length === 0
        ? "La delegación está hecha, pero todavía no tenés ningún punto de venta habilitado para Web Services en ARCA."
        : `Todo listo. Tenés ${habilitados.length} punto(s) de venta habilitado(s).`,
  });
});

// ── Emisión ────────────────────────────────────────────────
/**
 * El token/sign salen del certificado del proveedor (uno solo), pero el CUIT
 * que se manda es el DEL NEGOCIO: por eso el comprobante sale a nombre de
 * ellos y no del proveedor. Esa es toda la mecánica de la delegación.
 */
async function credencialesPara(env: Env, cfg: FacturacionConfig) {
  const ticket = await obtenerTicketAcceso(env, cfg.ambiente);
  return { token: ticket.token, sign: ticket.sign, cuit: cfg.cuit!, ambiente: cfg.ambiente };
}

/** Letra del comprobante a partir del código de ARCA, para mostrar y exportar. */
const NOMBRE_COMPROBANTE: Record<number, string> = {
  1: "Factura A", 6: "Factura B", 11: "Factura C",
  3: "Nota de Crédito A", 8: "Nota de Crédito B", 13: "Nota de Crédito C",
};
const ES_NOTA_CREDITO = new Set([3, 8, 13]);

/**
 * Todas las facturas del negocio, de la más nueva a la más vieja. `mes`
 * (YYYY-MM) es el filtro que se usa siempre en la práctica: el dueño mira "lo
 * que facturé este mes" y el contador pide el mes cerrado.
 */
facturacion.get("/facturas", async (c) => {
  const neg = negocioDe(c);
  const mes = c.req.query("mes");
  const estado = c.req.query("estado");

  const buscar = c.req.query("buscar")?.trim();
  const desde = c.req.query("desde");
  const hasta = c.req.query("hasta");

  const cond = ["f.negocio_id = ?"];
  const args: unknown[] = [neg];
  if (mes) {
    if (!/^\d{4}-\d{2}$/.test(mes)) throw new HttpError(400, "El mes tiene que venir como AAAA-MM.");
    cond.push("substr(f.creado_en, 1, 7) = ?");
    args.push(mes);
  }
  if (estado) {
    cond.push("f.estado = ?");
    args.push(enumerado(estado, "estado", ["pendiente", "autorizada", "rechazada", "error", "huerfano"]));
  }
  // Por nombre de cliente o por número de comprobante: así se busca una
  // factura que ya se emitió (te la reclaman por número o por quién era).
  if (desde) { cond.push("date(f.creado_en) >= ?"); args.push(fechaISO(desde, "desde")); }
  if (hasta) { cond.push("date(f.creado_en) <= ?"); args.push(fechaISO(hasta, "hasta")); }

  const rows = await c.env.DB.prepare(
    `SELECT f.*, v.numero AS venta_numero, v.fecha AS venta_fecha, cl.nombre AS cliente_nombre
     FROM facturas f
     JOIN ventas v ON v.id = f.venta_id AND v.negocio_id = f.negocio_id
     JOIN clientes cl ON cl.id = v.cliente_id AND cl.negocio_id = f.negocio_id
     WHERE ${cond.join(" AND ")}
     ORDER BY f.creado_en DESC`
  )
    .bind(...args)
    .all<Factura & { venta_numero: number; venta_fecha: string; cliente_nombre: string }>();

  let crudas = rows.results ?? [];
  // Por nombre de cliente (sin acentos), por número de comprobante o por CAE.
  if (buscar) {
    const q = normalizarBusqueda(buscar);
    crudas = crudas.filter(
      (f) =>
        normalizarBusqueda(f.cliente_nombre).includes(q) ||
        String(f.numero ?? "") === buscar ||
        (f.cae ?? "") === buscar
    );
  }

  const todas = crudas.map((f) => ({
    ...f,
    comprobante: NOMBRE_COMPROBANTE[f.tipo_comprobante] ?? `Tipo ${f.tipo_comprobante}`,
    es_nota_credito: ES_NOTA_CREDITO.has(f.tipo_comprobante),
    numero_formateado: f.numero
      ? `${String(f.punto_venta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}`
      : null,
    // El XML de ARCA no se le muestra a nadie: se traduce y el crudo queda
    // guardado en la base por si hay que revisarlo.
    motivo: motivoDe(f.estado, f.respuesta_afip),
  }));

  // Un comprobante por venta, no un renglón por reintento: si se intentó
  // cinco veces, al usuario le importa el estado actual, no las cinco filas.
  // Gana el autorizado; si no hay, el intento más reciente.
  const porVenta = new Map<string, (typeof todas)[number] & { intentos?: number }>();
  for (const f of todas) {
    const clave = `${f.venta_id}|${f.es_nota_credito ? "nc" : "f"}`;
    const previo = porVenta.get(clave);
    if (!previo) {
      porVenta.set(clave, { ...f, intentos: 1 });
      continue;
    }
    previo.intentos = (previo.intentos ?? 1) + 1;
    // `todas` viene ordenado de más nuevo a más viejo, así que el primero ya
    // es el más reciente: sólo lo pisa un autorizado que aparezca después.
    if (previo.estado !== "autorizada" && f.estado === "autorizada") {
      porVenta.set(clave, { ...f, intentos: previo.intentos });
    }
  }
  const lista = [...porVenta.values()];

  // Los totales del período: las NC restan, y sólo cuenta lo autorizado.
  const autorizadas = lista.filter((f) => f.estado === "autorizada");
  const signo = (f: (typeof lista)[number]) => (f.es_nota_credito ? -1 : 1);
  const totales = {
    emitidas: autorizadas.filter((f) => !f.es_nota_credito).length,
    notas_credito: autorizadas.filter((f) => f.es_nota_credito).length,
    con_problema: lista.filter((f) => f.estado === "rechazada" || f.estado === "error").length,
    neto: autorizadas.reduce((s, f) => s + signo(f) * f.neto_gravado, 0),
    iva: autorizadas.reduce((s, f) => s + signo(f) * f.iva, 0),
    total: autorizadas.reduce((s, f) => s + signo(f) * f.total, 0),
  };

  // Meses que tienen algo, para armar el selector sin adivinar.
  const meses = await c.env.DB
    .prepare(
      `SELECT DISTINCT substr(creado_en, 1, 7) AS mes FROM facturas
       WHERE negocio_id = ? ORDER BY mes DESC`
    )
    .bind(neg)
    .all<{ mes: string }>();

  return c.json({ facturas: lista, totales, meses: (meses.results ?? []).map((m) => m.mes) });
});

/**
 * Libro de IVA Ventas del mes, en CSV. Es lo que el contador pide todos los
 * meses: una fila por comprobante autorizado, con neto, IVA y total.
 */
facturacion.get("/libro-iva", async (c) => {
  const neg = negocioDe(c);
  const mes = c.req.query("mes");
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) throw new HttpError(400, "Indicá el mes como AAAA-MM.");

  const rows = await c.env.DB.prepare(
    `SELECT f.*, cl.nombre AS cliente_nombre
     FROM facturas f
     JOIN ventas v ON v.id = f.venta_id AND v.negocio_id = f.negocio_id
     JOIN clientes cl ON cl.id = v.cliente_id AND cl.negocio_id = f.negocio_id
     WHERE f.negocio_id = ? AND f.estado = 'autorizada' AND substr(f.creado_en, 1, 7) = ?
     ORDER BY f.tipo_comprobante, f.numero`
  )
    .bind(neg, mes)
    .all<Factura & { cliente_nombre: string }>();

  const pesos = (centavos: number) => (centavos / 100).toFixed(2);
  // Comillas dobladas: un nombre con comillas no puede romper la columna.
  const campo = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lineas = [
    ["Fecha", "Comprobante", "Numero", "Cliente", "Doc tipo", "Doc numero", "Neto", "IVA", "Total", "CAE"].join(","),
    ...(rows.results ?? []).map((f) => {
      const s = ES_NOTA_CREDITO.has(f.tipo_comprobante) ? -1 : 1;
      return [
        campo((f.autorizado_en ?? f.creado_en).slice(0, 10)),
        campo(NOMBRE_COMPROBANTE[f.tipo_comprobante] ?? f.tipo_comprobante),
        campo(f.numero ? `${String(f.punto_venta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}` : ""),
        campo(f.cliente_nombre),
        campo(f.doc_tipo),
        campo(f.doc_numero),
        campo(pesos(s * f.neto_gravado)),
        campo(pesos(s * f.iva)),
        campo(pesos(s * f.total)),
        campo(f.cae ?? ""),
      ].join(",");
    }),
  ];

  // BOM: sin esto Excel en Windows rompe los acentos.
  return new Response("﻿" + lineas.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="libro-iva-ventas-${mes}.csv"`,
    },
  });
});

/**
 * Qué se va a facturar, antes de tocar ARCA. Sirve para avisar en el momento
 * que a este cliente le falta el CUIT (y por eso no le podés hacer Factura A)
 * en vez de que se entere cuando ARCA la rechaza.
 */
/**
 * Todo lo de un comprobante en una sola llamada, para la vista de detalle:
 * la factura, a quién se le hizo (con sus datos fiscales), qué se vendió, y
 * la nota de crédito que la anula si la hubiera.
 */
facturacion.get("/facturas/:id", async (c) => {
  const neg = negocioDe(c);
  const id = c.req.param("id");

  const f = await c.env.DB.prepare(
    `SELECT f.*, v.numero AS venta_numero, v.fecha AS venta_fecha, v.total AS venta_total, v.nota AS venta_nota,
            cl.id AS cliente_id, cl.nombre AS cliente_nombre, cl.doc_tipo AS cliente_doc_tipo,
            cl.doc_numero AS cliente_doc_numero, cl.condicion_iva AS cliente_condicion_iva,
            cl.localidad AS cliente_localidad, cl.direccion AS cliente_direccion
     FROM facturas f
     JOIN ventas v   ON v.id = f.venta_id  AND v.negocio_id = f.negocio_id
     JOIN clientes cl ON cl.id = v.cliente_id AND cl.negocio_id = f.negocio_id
     WHERE f.negocio_id = ? AND f.id = ?`
  )
    .bind(neg, id)
    .first<any>();
  if (!f) throw new HttpError(404, "Comprobante no encontrado.");

  const items = await c.env.DB
    .prepare(`SELECT * FROM venta_items WHERE negocio_id = ? AND venta_id = ? ORDER BY id`)
    .bind(neg, f.venta_id)
    .all();

  // Si a esta factura le hicieron una NC, se muestra acá para que no haya que
  // buscarla: es la diferencia entre "esta factura vale" y "está anulada".
  const notaCredito = await c.env.DB
    .prepare(
      `SELECT id, numero, punto_venta, cae, estado, creado_en, tipo_comprobante
       FROM facturas WHERE negocio_id = ? AND factura_original_id = ? AND estado = 'autorizada'`
    )
    .bind(neg, id)
    .first();

  const cfg = await leerConfigFiscal(c.env, neg);

  return c.json({
    factura: {
      ...f,
      comprobante: NOMBRE_COMPROBANTE[f.tipo_comprobante] ?? `Tipo ${f.tipo_comprobante}`,
      es_nota_credito: ES_NOTA_CREDITO.has(f.tipo_comprobante),
      numero_formateado: f.numero
        ? `${String(f.punto_venta).padStart(5, "0")}-${String(f.numero).padStart(8, "0")}`
        : null,
      motivo: motivoDe(f.estado, f.respuesta_afip),
    },
    items: items.results ?? [],
    nota_credito: notaCredito ?? null,
    emisor: cfg ? { cuit: cfg.cuit, razon_social: cfg.razon_social, ambiente: cfg.ambiente } : null,
  });
});

/**
 * Borrar un comprobante. NUNCA uno autorizado.
 *
 * Una factura autorizada existe en ARCA, no sólo acá: borrarla de la base no
 * la borra de allá, sólo hace que tus registros dejen de coincidir con los de
 * ARCA. Y hay obligación legal de conservarla. Si está mal, el camino es la
 * Nota de Crédito, que es justamente para eso.
 *
 * Lo que sí se puede borrar son los intentos que nunca llegaron a ser un
 * comprobante: los que ARCA rechazó y los que quedaron con error. Esos no
 * existen en ningún lado más que en esta tabla.
 *
 * Los huérfanos tampoco: hasta no verificarlos contra ARCA no se sabe si son
 * un comprobante real. Borrarlos sería tapar la duda en vez de resolverla.
 */
facturacion.delete("/facturas/:id", async (c) => {
  const neg = negocioDe(c);
  const id = c.req.param("id");
  const f = await c.env.DB
    .prepare(`SELECT numero, punto_venta, estado FROM facturas WHERE negocio_id = ? AND id = ?`)
    .bind(neg, id)
    .first<{ numero: number | null; punto_venta: number; estado: string }>();
  if (!f) throw new HttpError(404, "Comprobante no encontrado.");

  if (f.estado === "autorizada") {
    throw new HttpError(
      400,
      "Una factura autorizada no se borra: existe en ARCA y hay que conservarla. Si está mal, anulala con una Nota de Crédito."
    );
  }
  if (f.estado === "huerfano") {
    throw new HttpError(
      400,
      "Este comprobante quedó sin confirmar. Verificalo con ARCA primero: si nunca se emitió vas a poder borrarlo."
    );
  }
  if (f.estado === "pendiente") {
    throw new HttpError(400, "Este comprobante se está emitiendo en este momento. Esperá a que termine.");
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM facturas WHERE negocio_id = ? AND id = ?`).bind(neg, id),
    auditarDe(c, "borrar_factura", "factura", id,
      `Intento ${f.estado}${f.numero ? ` · ${f.punto_venta}-${f.numero}` : ""}`),
  ]);
  return c.json({ ok: true });
});

facturacion.get("/ventas/:ventaId/previo", async (c) => {
  const neg = negocioDe(c);
  const ventaId = c.req.param("ventaId");
  const cfg = exigirConfigLista(await leerConfigFiscal(c.env, neg));

  const venta = await c.env.DB.prepare(`SELECT * FROM ventas WHERE negocio_id = ? AND id = ?`).bind(neg, ventaId).first<Venta>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  const cliente = await c.env.DB.prepare(`SELECT * FROM clientes WHERE negocio_id = ? AND id = ?`).bind(neg, venta.cliente_id).first<Cliente>();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado.");

  const sugerida = inferirTipoComprobante(cfg.condicion_iva!, cliente);
  const tieneCuit = cliente.doc_tipo === "CUIT" && !!cliente.doc_numero;
  const esMonotributo = cfg.condicion_iva === "monotributo";

  // Por qué cada letra se puede o no. El motivo se muestra tal cual en pantalla.
  const opciones = [
    {
      letra: "A",
      disponible: !esMonotributo && tieneCuit,
      motivo: esMonotributo
        ? "Siendo Monotributista no podés emitir Factura A."
        : !tieneCuit
          ? `${cliente.nombre} no tiene CUIT cargado. Cargáselo en su ficha y vas a poder hacerle Factura A.`
          : null,
    },
    { letra: "B", disponible: !esMonotributo, motivo: esMonotributo ? "Siendo Monotributista emitís Factura C." : null },
    { letra: "C", disponible: esMonotributo, motivo: esMonotributo ? null : "La Factura C es sólo para emisores Monotributistas." },
  ];

  const { neto, iva } = calcularNetoIva(venta.total, cfg.iva_porcentaje_defecto);
  return c.json({
    sugerida,
    opciones,
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      doc_tipo: cliente.doc_tipo,
      doc_numero: cliente.doc_numero,
      condicion_iva: cliente.condicion_iva,
    },
    venta: { numero: venta.numero, total: venta.total },
    neto,
    iva,
    iva_porcentaje: cfg.iva_porcentaje_defecto,
  });
});

/**
 * Resuelve los comprobantes que quedaron sin confirmar: le pregunta a ARCA,
 * por número, si los tiene autorizados.
 *
 *   - Los tenía  -> se completa el CAE y queda 'autorizada'. La factura
 *                   existía de verdad; ahora el sistema la conoce.
 *   - No los tenía -> nunca se emitió: pasa a 'rechazada' y el número queda
 *                   libre para volver a facturar esa venta.
 *
 * Esto es lo que evita terminar con dos facturas reales para una misma venta.
 */
facturacion.post("/huerfanos/verificar", async (c) => {
  const neg = negocioDe(c);
  const cfg = exigirConfigLista(await leerConfigFiscal(c.env, neg));

  const pendientes = await c.env.DB
    .prepare(
      `SELECT * FROM facturas WHERE negocio_id = ? AND estado = 'huerfano' ORDER BY creado_en`
    )
    .bind(neg)
    .all<Factura>();
  const lista = pendientes.results ?? [];
  if (lista.length === 0) return c.json({ ok: true, revisados: 0, autorizados: 0, liberados: 0 });

  let cred;
  try {
    cred = await credencialesPara(c.env, cfg);
  } catch (err: any) {
    // Si no se puede ni entrar a ARCA, no se toca nada: los huérfanos siguen
    // huérfanos y las ventas siguen bloqueadas. Es la dirección segura.
    throw new HttpError(502, `No se pudo consultar a ARCA, así que no se cambió nada. ${mensajeAmigable(err)}`);
  }
  let autorizados = 0;
  let liberados = 0;

  for (const f of lista) {
    // Sin número no hay nada que consultar (no debería pasar con el flujo
    // nuevo, pero puede haber filas viejas de antes de este arreglo).
    if (f.numero == null) {
      await c.env.DB.prepare(
        `UPDATE facturas SET estado = 'rechazada',
           respuesta_afip = 'Quedó sin número asignado: no se llegó a pedir el CAE.'
         WHERE negocio_id = ? AND id = ?`
      ).bind(neg, f.id).run();
      liberados++;
      continue;
    }

    const enArca = await feCompConsultar(cred, f.punto_venta, f.tipo_comprobante, f.numero);
    if (enArca) {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE facturas SET estado = 'autorizada', cae = ?, cae_vencimiento = ?,
             observaciones = ?, autorizado_en = datetime('now')
           WHERE negocio_id = ? AND id = ?`
        ).bind(enArca.cae, enArca.caeVencimiento, enArca.observaciones, neg, f.id),
        auditarDe(c, "recuperar_factura", "factura", f.id,
          `La factura ${f.punto_venta}-${f.numero} sí estaba autorizada en ARCA · CAE ${enArca.cae}`),
      ]);
      autorizados++;
    } else {
      await c.env.DB.prepare(
        `UPDATE facturas SET estado = 'rechazada',
           respuesta_afip = 'Verificado con ARCA: el comprobante nunca se emitió. Se puede facturar de nuevo.'
         WHERE negocio_id = ? AND id = ?`
      ).bind(neg, f.id).run();
      liberados++;
    }
  }

  return c.json({ ok: true, revisados: lista.length, autorizados, liberados });
});

facturacion.get("/ventas/:ventaId", async (c) => {
  const neg = negocioDe(c);
  const factura = await c.env.DB
    .prepare(`SELECT * FROM facturas WHERE negocio_id = ? AND venta_id = ? ORDER BY creado_en DESC`)
    .bind(neg, c.req.param("ventaId"))
    .all<Factura>();
  return c.json({ facturas: factura.results ?? [] });
});

// Emitir y acreditar no piden ser dueño: alcanza con tener el módulo
// habilitado (igual que anular una venta). Los datos fiscales y el
// certificado sí siguen siendo sólo del dueño.
facturacion.post("/ventas/:ventaId/emitir", async (c) => {
  const neg = negocioDe(c);
  const ventaId = c.req.param("ventaId");
  const b = await c.req.json().catch(() => ({}));
  const letraForzada = b.tipo ? enumerado(b.tipo, "tipo de comprobante", LETRAS) : null;

  const cfg = exigirConfigLista(await leerConfigFiscal(c.env, neg));

  // Sólo bloquea una factura ya autorizada. Los intentos que ARCA rechazó
  // quedan como historial pero no traban la venta: se puede reintentar.
  const yaExiste = await c.env.DB
    .prepare(
      `SELECT id FROM facturas
       WHERE negocio_id = ? AND venta_id = ? AND factura_original_id IS NULL AND estado = 'autorizada'`
    )
    .bind(neg, ventaId)
    .first();
  if (yaExiste) throw new HttpError(409, "Esta venta ya tiene una factura emitida.");

  // Un intento anterior quedó sin respuesta: ARCA pudo haberlo autorizado.
  // Reintentar a ciegas dejaría dos facturas reales para una sola venta, así
  // que primero hay que preguntarle a ARCA qué pasó.
  const huerfano = await c.env.DB
    .prepare(
      `SELECT id FROM facturas
       WHERE negocio_id = ? AND venta_id = ? AND factura_original_id IS NULL AND estado = 'huerfano'`
    )
    .bind(neg, ventaId)
    .first();
  if (huerfano) {
    throw new HttpError(
      409,
      "Un intento anterior quedó sin confirmar y hay que verificarlo contra ARCA antes de volver a facturar. Usá \"Verificar con ARCA\" en la pantalla de Facturas."
    );
  }

  const venta = await c.env.DB.prepare(`SELECT * FROM ventas WHERE negocio_id = ? AND id = ?`).bind(neg, ventaId).first<Venta>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  if (venta.estado === "anulada") throw new HttpError(400, "No se puede facturar una venta anulada.");
  if (venta.estado === "borrador") throw new HttpError(400, "La venta todavía no está confirmada.");

  const cliente = await c.env.DB.prepare(`SELECT * FROM clientes WHERE negocio_id = ? AND id = ?`).bind(neg, venta.cliente_id).first<Cliente>();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado.");

  // Alícuota mixta: si algún ítem trae un override distinto al default del negocio, se bloquea (v1).
  const alicuotasDistintas = await c.env.DB
    .prepare(
      `SELECT DISTINCT COALESCE(h.iva_porcentaje, ?) AS iva FROM venta_items vi
       JOIN herramientas h ON h.id = vi.herramienta_id AND h.negocio_id = vi.negocio_id
       WHERE vi.negocio_id = ? AND vi.venta_id = ?`
    )
    .bind(cfg.iva_porcentaje_defecto, neg, ventaId)
    .all<{ iva: number }>();
  const alicuotas = (alicuotasDistintas.results ?? []).map((r) => r.iva);
  if (new Set(alicuotas).size > 1) {
    throw new HttpError(
      400,
      "Esta venta mezcla productos con distinta alícuota de IVA. Por ahora facturala manualmente fuera del sistema."
    );
  }
  const ivaPorcentaje = alicuotas[0] ?? cfg.iva_porcentaje_defecto;

  const letra = letraForzada ?? inferirTipoComprobante(cfg.condicion_iva!, cliente);
  validarDocumentoParaTipo(letra, cliente);

  const { neto, iva } = calcularNetoIva(venta.total, ivaPorcentaje);
  const doc = codigoDocumento(cliente);
  const condicionReceptor = cliente.condicion_iva
    ? CONDICION_IVA_RECEPTOR[cliente.condicion_iva]
    : CONDICION_IVA_RECEPTOR.consumidor_final;

  const facturaId = crypto.randomUUID();
  const tipo = TIPO_FACTURA[letra];

  // Autenticarse y averiguar el número van ANTES de grabar nada: si fallan,
  // todavía no se pidió ningún CAE, así que no hay comprobante que rastrear.
  let cred, numero: number;
  try {
    cred = await credencialesPara(c.env, cfg);
    numero = (await feCompUltimoAutorizado(cred, cfg.punto_venta!, tipo)) + 1;
  } catch (err: any) {
    if (err instanceof HttpError && err.status < 500) throw err;
    throw new HttpError(502, mensajeAmigable(err));
  }

  // La fila se graba ANTES de pedir el CAE, con el número ya reservado. Si se
  // corta la conexión en el medio, queda constancia de qué número se mandó —
  // que es lo único que después permite preguntarle a ARCA qué pasó.
  await c.env.DB.prepare(
    `INSERT INTO facturas
       (id, negocio_id, venta_id, tipo_comprobante, punto_venta, numero, estado,
        neto_gravado, iva, total, iva_porcentaje, doc_tipo, doc_numero)
     VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?)`
  )
    .bind(facturaId, neg, ventaId, tipo, cfg.punto_venta, numero, neto, iva, venta.total, ivaPorcentaje, doc.tipo, doc.numero)
    .run();

  try {
    const resultado = await feCaeSolicitar(cred, cfg.punto_venta!, {
      cbteTipo: tipo,
      docTipo: doc.tipo,
      docNro: doc.numero,
      cbteFch: hoyAAAAMMDD(),
      impTotal: venta.total,
      impNeto: neto,
      impIVA: iva,
      ivaPorcentaje,
      condicionIVAReceptorId: condicionReceptor,
    }, numero);

    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE facturas SET estado = 'autorizada', cae = ?, cae_vencimiento = ?,
           observaciones = ?, autorizado_en = datetime('now')
         WHERE negocio_id = ? AND id = ?`
      ).bind(resultado.cae, resultado.caeVencimiento, resultado.observaciones, neg, facturaId),
      auditarDe(c, "emitir_factura", "factura", facturaId,
        `Factura ${letra} ${cfg.punto_venta}-${resultado.numero} · Venta #${venta.numero} · CAE ${resultado.cae}`),
    ]);

    return c.json({ ok: true, id: facturaId, letra, numero: resultado.numero, cae: resultado.cae, caeVencimiento: resultado.caeVencimiento });
  } catch (err: any) {
    // Distinción clave: si ARCA contestó "no", el comprobante NO existe y se
    // puede reintentar. Si no llegamos a saber qué contestó (timeout, red
    // cortada), pudo haberlo autorizado igual: eso queda 'huerfano' y se
    // resuelve preguntando, nunca reintentando a ciegas.
    const estadoFallido = esRespuestaDeArca(err) ? "rechazada" : "huerfano";
    await c.env.DB.prepare(
      `UPDATE facturas SET estado = ?, respuesta_afip = ? WHERE negocio_id = ? AND id = ?`
    )
      .bind(estadoFallido, String(err?.message ?? err), neg, facturaId)
      .run();

    if (estadoFallido === "huerfano") {
      throw new HttpError(
        502,
        "Se cortó la comunicación con ARCA y no sabemos si la factura llegó a emitirse. No la vuelvas a emitir: entrá a Facturas y usá \"Verificar con ARCA\" para saber qué pasó."
      );
    }
    if (err instanceof HttpError && err.status < 500) throw err;
    throw new HttpError(502, mensajeAmigable(err));
  }
});

facturacion.post("/ventas/:ventaId/nota-credito", async (c) => {
  const neg = negocioDe(c);
  const ventaId = c.req.param("ventaId");
  const cfg = exigirConfigLista(await leerConfigFiscal(c.env, neg));

  const venta = await c.env.DB.prepare(`SELECT * FROM ventas WHERE negocio_id = ? AND id = ?`).bind(neg, ventaId).first<Venta>();
  if (!venta) throw new HttpError(404, "Venta no encontrada.");
  if (venta.estado === "anulada") throw new HttpError(400, "La venta ya está anulada.");

  const original = await c.env.DB
    .prepare(
      `SELECT * FROM facturas
       WHERE negocio_id = ? AND venta_id = ? AND factura_original_id IS NULL AND estado = 'autorizada'`
    )
    .bind(neg, ventaId)
    .first<Factura>();
  if (!original) throw new HttpError(404, "Esta venta no tiene una factura autorizada, no hace falta Nota de Crédito.");

  const letra = (Object.entries(TIPO_FACTURA).find(([, v]) => v === original.tipo_comprobante)?.[0] ?? "B") as "A" | "B" | "C";
  const cred = await credencialesPara(c.env, cfg);
  const ncId = crypto.randomUUID();
  const tipoNC = TIPO_NOTA_CREDITO[letra];
  const numeroNC = (await feCompUltimoAutorizado(cred, cfg.punto_venta!, tipoNC)) + 1;

  const resultado = await feCaeSolicitar(cred, cfg.punto_venta!, {
    cbteTipo: tipoNC,
    docTipo: original.doc_tipo,
    docNro: original.doc_numero,
    cbteFch: hoyAAAAMMDD(),
    impTotal: original.total,
    impNeto: original.neto_gravado,
    impIVA: original.iva,
    ivaPorcentaje: original.iva_porcentaje,
    condicionIVAReceptorId: CONDICION_IVA_RECEPTOR.consumidor_final, // se reconfirma con el cliente real en Fase 7
    cbteAsoc: { tipo: original.tipo_comprobante, ptoVta: original.punto_venta, nro: original.numero! },
  }, numeroNC);

  // ARCA ya autorizó la NC — recién ahora se anula la venta de verdad (stock,
  // pagos, estado), en el mismo batch atómico que deja registrada la NC.
  const stmtsAnulacion = await armarAnulacionVenta(c.env, neg, c.get("usuario").usuario, c.get("usuario").sesionSoporte, venta);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO facturas
         (id, negocio_id, venta_id, factura_original_id, tipo_comprobante, punto_venta, numero, cae, cae_vencimiento,
          estado, neto_gravado, iva, total, iva_porcentaje, doc_tipo, doc_numero, autorizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'autorizada', ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      ncId, neg, ventaId, original.id, TIPO_NOTA_CREDITO[letra], cfg.punto_venta, resultado.numero,
      resultado.cae, resultado.caeVencimiento, original.neto_gravado, original.iva, original.total,
      original.iva_porcentaje, original.doc_tipo, original.doc_numero
    ),
    auditarDe(c, "emitir_nota_credito", "factura", ncId,
      `NC ${letra} ${cfg.punto_venta}-${resultado.numero} sobre factura ${original.id} · Venta #${venta.numero}`),
    ...stmtsAnulacion,
  ]);

  return c.json({ ok: true, id: ncId, numero: resultado.numero, cae: resultado.cae, caeVencimiento: resultado.caeVencimiento });
});
