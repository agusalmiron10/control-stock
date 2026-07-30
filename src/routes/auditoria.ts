import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { requireDueno } from "../auth";

export const auditoriaRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
auditoriaRoutes.use("*", requireDueno);

/** Últimos 200 eventos de auditoría. Solo dueño. */
auditoriaRoutes.get("/", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM auditoria ORDER BY id DESC LIMIT 200`
  ).all();
  return c.json({ eventos: rows.results ?? [] });
});
