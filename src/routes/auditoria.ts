import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireDueno } from "../auth";
import { requireModulo } from "../config";
import { negocioDe } from "../types";

export const auditoriaRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
auditoriaRoutes.use("*", requireDueno);
auditoriaRoutes.use("*", requireModulo("auditoria"));

/** Últimos 200 eventos de auditoría. Solo dueño. */
auditoriaRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM auditoria WHERE negocio_id = ? ORDER BY id DESC LIMIT 200`
  ).bind(negocioDe(c)).all();
  return c.json({ eventos: rows.results ?? [] });
});
