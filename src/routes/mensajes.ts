/**
 * Mails REALES a clientes (server a server, vía Resend) — a diferencia del
 * "mailto:" de siempre, esto lo manda el sistema solo, con el nombre del
 * negocio como remitente visible. Si Resend no está activado todavía
 * (ver src/mail.ts), devuelve 409 con un mensaje claro: el frontend cae
 * de vuelta al "mailto:" como si esta ruta no existiera.
 */
import { Hono } from "hono";
import type { Env, Variables, Cliente, Herramienta } from "../types";
import { HttpError } from "../validate";
import { negocioDe } from "../types";
import { estadoDeCuenta } from "../cuenta";
import { leerConfig } from "../config";
import { enviarMailNegocio, pesos, fechaHoy } from "../mail";

export const mensajes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function traerClienteConMail(env: Env, negocioId: string, clienteId: string): Promise<Cliente> {
  const cliente = await env.DB.prepare(`SELECT * FROM clientes WHERE id = ? AND negocio_id = ?`)
    .bind(clienteId, negocioId)
    .first<Cliente>();
  if (!cliente) throw new HttpError(404, "Cliente no encontrado.");
  if (!cliente.email) throw new HttpError(400, "Este cliente no tiene mail cargado.");
  return cliente;
}

/** Estado de cuenta real, por mail. */
mensajes.post("/estado-cuenta/:clienteId", async (c) => {
  const neg = negocioDe(c);
  const cliente = await traerClienteConMail(c.env, neg, c.req.param("clienteId"));
  const cfg = await leerConfig(c.env, neg);
  const r = await estadoDeCuenta(c.env, neg, cliente.id);

  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, te paso tu estado de cuenta en ${cfg.negocio.nombre}:`);
  l.push("");
  l.push(`Total comprado: ${pesos(r.totalVentas)}`);
  l.push(`Total pagado: ${pesos(r.totalPagado)}`);
  if (r.saldoCliente > 0) l.push(`Saldo pendiente: ${pesos(r.saldoCliente)}`);
  else if (r.saldoAFavor > 0) l.push(`Saldo a favor: ${pesos(r.saldoAFavor)}`);
  else l.push(`Estás al día. ¡Gracias!`);
  l.push("");
  l.push(`Cualquier duda, avisame. ${cfg.negocio.telefono}`);

  const error = await enviarMailNegocio(
    c.env,
    cfg.negocio.nombre,
    cliente.email!,
    `Estado de cuenta — ${cfg.negocio.nombre}`,
    l.join("\n")
  );
  if (error) throw new HttpError(409, error);
  return c.json({ ok: true, enviado_a: cliente.email });
});

/** Recordatorio de deuda real, por mail. */
mensajes.post("/recordatorio-deuda/:clienteId", async (c) => {
  const neg = negocioDe(c);
  const cliente = await traerClienteConMail(c.env, neg, c.req.param("clienteId"));
  const cfg = await leerConfig(c.env, neg);
  const r = await estadoDeCuenta(c.env, neg, cliente.id);
  if (r.saldoCliente <= 0) throw new HttpError(400, "Este cliente no tiene saldo pendiente.");

  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, ¿cómo va? Te escribo de ${cfg.negocio.nombre}.`);
  l.push(`Te recuerdo que tenés un saldo pendiente de ${pesos(r.saldoCliente)}.`);
  l.push(`Cuando puedas, coordinamos. ¡Gracias!`);

  const error = await enviarMailNegocio(
    c.env,
    cfg.negocio.nombre,
    cliente.email!,
    `Recordatorio de saldo — ${cfg.negocio.nombre}`,
    l.join("\n")
  );
  if (error) throw new HttpError(409, error);
  return c.json({ ok: true, enviado_a: cliente.email });
});

/**
 * Lista de precios real, por mail, con la lista COMPLETA adjunta en CSV
 * (acá no hay límite de líneas: a diferencia del "mailto:", esto no depende
 * de que el destinatario tipee nada, así que no hace falta truncar).
 * No hay "el mail del negocio" para esto — lo elige quien llama, a mano.
 */
mensajes.post("/lista-precios", async (c) => {
  const neg = negocioDe(c);
  const b = await c.req.json().catch(() => ({}) as any);
  const destino = String(b?.email ?? "").trim();
  const tipo: "minorista" | "mayorista" = b?.tipo === "mayorista" ? "mayorista" : "minorista";
  if (!destino || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destino)) {
    throw new HttpError(400, "Mail de destino inválido.");
  }

  const cfg = await leerConfig(c.env, neg);
  const { results } = await c.env.DB.prepare(
    `SELECT nombre, precio, precio_mayor FROM herramientas WHERE negocio_id = ? AND activo = 1 ORDER BY nombre`
  )
    .bind(neg)
    .all<Pick<Herramienta, "nombre" | "precio" | "precio_mayor">>();

  const conPrecio = (results ?? []).filter((h) => (tipo === "mayorista" ? h.precio_mayor : h.precio) > 0);

  const l: string[] = [];
  l.push(`Lista de precios de ${cfg.negocio.nombre} (${tipo}) — ${fechaHoy()}`);
  l.push("");
  if (conPrecio.length === 0) l.push("(Todavía no hay precios cargados)");
  else l.push(`Adjunto la lista completa (${conPrecio.length} producto${conPrecio.length === 1 ? "" : "s"}).`);
  l.push("");
  l.push(`Consultas: ${cfg.negocio.telefono} — ${cfg.negocio.instagram}`);

  const csv = [
    "Producto,Precio",
    ...conPrecio.map(
      (h) => `"${h.nombre.replace(/"/g, '""')}",${pesos(tipo === "mayorista" ? h.precio_mayor : h.precio)}`
    ),
  ].join("\n");

  const error = await enviarMailNegocio(
    c.env,
    cfg.negocio.nombre,
    destino,
    `Lista de precios — ${cfg.negocio.nombre}`,
    l.join("\n"),
    conPrecio.length > 0 ? { nombre: `lista-precios-${tipo}.csv`, contenidoTexto: csv } : undefined
  );
  if (error) throw new HttpError(409, error);
  return c.json({ ok: true, enviado_a: destino, cantidad: conPrecio.length });
});
