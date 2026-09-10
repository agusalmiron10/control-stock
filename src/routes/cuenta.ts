import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { negocioDe } from "../types";
import { HttpError, texto } from "../validate";
import { requireDueno } from "../auth";
import { leerConfig, resolverCapacidades } from "../config";
import { auditarDe } from "../auditoria";

export const cuenta = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Qué se perdería de vista si esta cuenta se pasara a otro rubro.
 *
 * Cambiar de rubro no borra nada, pero sí puede dejar de MOSTRAR datos que
 * ya están cargados (un campo "marca" con 300 productos completados). Que
 * eso pase en silencio es lo peor posible: se avisa antes de confirmar.
 */
cuenta.get("/rubro/impacto", requireDueno, async (c) => {
  const neg = negocioDe(c);
  const rubroId = texto(c.req.query("rubro_id"), "rubro", { max: 40 })!;

  const destino = await c.env.DB
    .prepare(
      `SELECT r.nombre, p.capacidades_json
         FROM rubros r JOIN perfiles_config p ON p.id = r.perfil_id
        WHERE r.id = ? AND r.activo = 1`
    )
    .bind(rubroId)
    .first<{ nombre: string; capacidades_json: string }>();
  if (!destino) throw new HttpError(400, "Ese rubro no existe.");

  const actual = await leerConfig(c.env, neg);
  // Se simula el cambio conservando el override de la cuenta: sus ajustes
  // finos no se pierden por cambiar de rubro, así que tampoco deben aparecer
  // como "se van a perder" en el aviso.
  const override = await c.env.DB
    .prepare(`SELECT config_override_json FROM negocios WHERE id = ?`)
    .bind(neg)
    .first<{ config_override_json: string | null }>();
  const nuevas = resolverCapacidades(destino.capacidades_json, override?.config_override_json);

  // Hoy el único dato que puede quedar huérfano son los campos extra: el
  // resto de las capacidades todavía no guarda nada (ver etapa siguiente).
  const sePierden = actual.capacidades.campos_extra_producto.filter(
    (campo) => !nuevas.campos_extra_producto.includes(campo)
  );

  const avisos: { campo: string; productos: number }[] = [];
  for (const campo of sePierden) {
    const fila = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM herramientas
          WHERE negocio_id = ? AND datos_extra IS NOT NULL
            AND json_extract(datos_extra, '$.' || ?) IS NOT NULL`
      )
      .bind(neg, campo)
      .first<{ n: number }>();
    if ((fila?.n ?? 0) > 0) avisos.push({ campo, productos: fila!.n });
  }

  return c.json({
    rubro_nombre: destino.nombre,
    vocabulario_nuevo: { singular: nuevas.producto_singular, plural: nuevas.producto_plural },
    campos_que_dejan_de_verse: avisos,
  });
});

/**
 * Fija (o cambia) el rubro de ESTA cuenta.
 *
 * Sólo el dueño, y sólo sobre su propio negocio: el negocio sale de la
 * sesión (negocioDe), nunca del cuerpo del pedido, así no hay forma de
 * mandarle un rubro a la cuenta de otro.
 *
 * El rubro se valida contra la tabla, no contra una lista en el código: es
 * lo que permite sumar un rubro nuevo sin desplegar.
 *
 * Importante: esto NO toca los módulos. Los módulos son lo que el proveedor
 * le vendió al negocio; el rubro sólo decide cómo se comporta el sistema.
 * Si el rubro pudiera prender módulos, cualquiera se autohabilitaría
 * funciones eligiendo el rubro "correcto".
 */
cuenta.post("/rubro", requireDueno, async (c) => {
  const neg = negocioDe(c);
  const b = await c.req.json().catch(() => ({}));

  const rubroId = texto(b.rubro_id, "rubro", { max: 40 })!;
  const rubro = await c.env.DB
    .prepare(`SELECT id, nombre, activo FROM rubros WHERE id = ?`)
    .bind(rubroId)
    .first<{ id: string; nombre: string; activo: number }>();
  if (!rubro || !rubro.activo) throw new HttpError(400, "Ese rubro no existe.");

  // "Otro" sin texto no sirve para nada: es justamente el caso que se quiere
  // leer después para saber qué rubros conviene agregar formalmente.
  const esOtro = rubro.id === "otro";
  const otroTexto = texto(b.rubro_otro_texto, "a qué se dedica", { requerido: false, max: 80 });
  if (esOtro && !otroTexto) throw new HttpError(400, "Contanos a qué se dedica el negocio.");

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE negocios
            SET rubro_id = ?, rubro_otro_texto = ?, rubro_configurado_en = datetime('now')
          WHERE id = ?`
      )
      .bind(rubro.id, esOtro ? otroTexto : null, neg),
    auditarDe(c, "cambiar_rubro", "negocio", neg, `Rubro: ${rubro.nombre}${esOtro ? ` (${otroTexto})` : ""}`),
  ]);

  // Se devuelve la config ya resuelta para que el front no tenga que pedirla
  // de nuevo justo después de elegir.
  return c.json(await leerConfig(c.env, neg));
});
