import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { texto } from "../validate";
import { requireDueno } from "../auth";
import { leerConfig } from "../config";
import { auditarDe } from "../auditoria";
import { negocioDe } from "../types";

export const config = new Hono<{ Bindings: Env; Variables: Variables }>();

/** La config la lee cualquier usuario logueado: el front la necesita para armar el menú. */
config.get("/", async (c) => c.json(await leerConfig(c.env, negocioDe(c))));

/**
 * Conexión con el panel del proveedor. Va aparte de la config general porque
 * el token es un secreto: sólo lo ve el dueño, no un empleado.
 */
config.get("/panel", requireDueno, async (c) => {
  const filas = await c.env.DB.prepare(
    `SELECT clave, valor FROM config WHERE negocio_id = ? AND clave IN ('panel_url','panel_token')`
  ).bind(negocioDe(c)).all<{ clave: string; valor: string }>();
  const v = new Map((filas.results ?? []).map((f) => [f.clave, f.valor]));
  return c.json({ url: v.get("panel_url") ?? "", token: v.get("panel_token") ?? "" });
});

config.put("/panel", requireDueno, async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const guardar = (clave: string, valor: string) =>
    c.env.DB.prepare(
      `INSERT INTO config (negocio_id, clave, valor, actualizado_en) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(negocio_id, clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`
    ).bind(neg, clave, valor);

  await c.env.DB.batch([
    guardar("panel_url", texto(b.url, "URL del panel", { requerido: false, max: 200 }) ?? ""),
    guardar("panel_token", texto(b.token, "token", { requerido: false, max: 120 }) ?? ""),
    auditarDe(c, "cambiar_panel", "config", null),
  ]);
  return c.json({ ok: true });
});

/**
 * Cambiar datos del negocio y vocabulario. Solo dueño.
 * Los módulos NO se tocan acá a propósito: sólo el proveedor del sistema
 * los prende o apaga, desde /api/super/negocios/:id/modulos — así ningún
 * negocio se autohabilita algo que no le vendieron.
 */
config.put("/", requireDueno, async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const neg = negocioDe(c);
  const stmts: D1PreparedStatement[] = [];

  const guardar = (clave: string, valor: string) =>
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO config (negocio_id, clave, valor, actualizado_en) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(negocio_id, clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`
      ).bind(neg, clave, valor)
    );

  const campos: [string, unknown, number][] = [
    ["negocio_nombre", b.negocio?.nombre, 80],
    ["negocio_rubro", b.negocio?.rubro, 120],
    ["negocio_telefono", b.negocio?.telefono, 40],
    ["negocio_instagram", b.negocio?.instagram, 60],
    ["producto_singular", b.vocabulario?.producto_singular, 30],
    ["producto_plural", b.vocabulario?.producto_plural, 30],
  ];
  for (const [clave, valor, max] of campos) {
    if (valor === undefined) continue;
    guardar(clave, texto(valor, clave, { requerido: false, max }) ?? "");
  }

  if (stmts.length > 0) {
    stmts.push(auditarDe(c, "cambiar_config", "config", null));
    await c.env.DB.batch(stmts);
  }
  return c.json(await leerConfig(c.env, neg));
});
