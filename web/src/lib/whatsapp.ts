// Armado de enlaces de WhatsApp (wa.me) con mensajes pre-cargados.
import { pesos, fecha } from "../format";
import { NEGOCIO } from "./negocio";

/**
 * Normaliza un teléfono argentino a formato internacional para wa.me.
 * Acepta "11 3328-8059", "011 15 3328 8059", "+54 9 11...", etc.
 * Devuelve solo dígitos con el 549 adelante, o null si no hay número usable.
 */
export function telefonoWa(tel: string | null | undefined): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, "");
  if (!d) return null;
  // Sacar 0 inicial de característica y 15 de celular si vienen en formato local.
  if (d.startsWith("54")) {
    d = d.slice(2);
    if (d.startsWith("9")) d = d.slice(1);
  }
  if (d.startsWith("0")) d = d.slice(1);
  // Quitar un "15" al principio del abonado si quedó (formato viejo de celular).
  // Heurística simple: si son 11 dígitos y arranca con 15, no lo tocamos (podría ser área).
  return `549${d}`;
}

function abrir(numero: string | null, texto: string) {
  const base = numero ? `https://wa.me/${numero}` : `https://wa.me/`;
  window.open(`${base}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
}

/** Mensaje de estado de cuenta para un cliente. */
export function waEstadoDeCuenta(cliente: any, saldo: number, totalComprado: number, totalPagado: number) {
  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, te paso tu estado de cuenta en ${NEGOCIO.nombre}:`);
  l.push("");
  l.push(`Total comprado: ${pesos(totalComprado)}`);
  l.push(`Total pagado: ${pesos(totalPagado)}`);
  if (saldo > 0) l.push(`*Saldo pendiente: ${pesos(saldo)}*`);
  else if (saldo < 0) l.push(`*Saldo a favor: ${pesos(-saldo)}*`);
  else l.push(`*Estás al día. ¡Gracias!*`);
  l.push("");
  l.push(`Cualquier duda, avisame. ${NEGOCIO.telefono}`);
  abrir(telefonoWa(cliente.telefono), l.join("\n"));
}

/** Recordatorio de deuda. */
export function waRecordatorioDeuda(cliente: any, saldo: number) {
  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, ¿cómo va? Te escribo de ${NEGOCIO.nombre}.`);
  l.push(`Te recuerdo que tenés un saldo pendiente de *${pesos(saldo)}*.`);
  l.push(`Cuando puedas, coordinamos. ¡Gracias!`);
  abrir(telefonoWa(cliente.telefono), l.join("\n"));
}

/** Manda un presupuesto (cotización) a un cliente. */
export function waPresupuesto(cliente: any, presupuesto: any, items: any[]) {
  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, te paso el presupuesto de ${NEGOCIO.nombre}:`);
  l.push("");
  for (const it of items) {
    l.push(`${it.cantidad} x ${it.nombre_herramienta} — ${pesos(it.subtotal)}`);
  }
  l.push("");
  if (presupuesto.descuento > 0) l.push(`Subtotal: ${pesos(presupuesto.subtotal)}`);
  if (presupuesto.descuento > 0) l.push(`Descuento: ${pesos(presupuesto.descuento)}`);
  l.push(`*Total: ${pesos(presupuesto.total)}*`);
  if (presupuesto.valido_hasta) l.push(`Válido hasta el ${fecha(presupuesto.valido_hasta)}.`);
  l.push("");
  l.push(`Cualquier consulta, avisame. ${NEGOCIO.telefono}`);
  abrir(telefonoWa(cliente.telefono), l.join("\n"));
}

/** Recordatorio de un presupuesto pendiente. */
export function waRecordatorioPresupuesto(cliente: any, presupuesto: any) {
  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, ¿pudiste ver el presupuesto que te mandé por ${pesos(presupuesto.total)}?`);
  l.push(`Cualquier cosa quedo atento. ${NEGOCIO.telefono}`);
  abrir(telefonoWa(cliente.telefono), l.join("\n"));
}

/** Comparte el resumen del día anterior (generado por el Cron automático). */
export function waResumenDiario(r: any) {
  const l: string[] = [];
  l.push(`*${NEGOCIO.nombre} — Resumen del ${fecha(r.fecha)}*`);
  l.push("");
  l.push(`Ventas: ${pesos(r.ventas_total)} (${r.ventas_cant})`);
  l.push(`Cobrado: ${pesos(r.cobranzas_total)} (${r.cobranzas_cant})`);
  l.push(`Total a cobrar: ${pesos(r.saldo_pendiente)} — ${r.clientes_con_deuda} clientes`);
  if (r.stock_bajo_cant > 0) l.push(`Stock bajo o en cero: ${r.stock_bajo_cant} producto(s)`);
  abrir(null, l.join("\n"));
}

/** Comparte la lista de precios (texto) — abre WhatsApp para elegir contacto. */
export function waListaDePrecios(herramientas: any[], tipo: "minorista" | "mayorista") {
  const conPrecio = herramientas.filter((h) => (tipo === "mayorista" ? h.precio_mayor : h.precio) > 0);
  const l: string[] = [];
  l.push(`*${NEGOCIO.nombre} — Lista de precios (${tipo})*`);
  l.push(`${fecha(new Date().toISOString().slice(0, 10))}`);
  l.push("");
  for (const h of conPrecio) {
    l.push(`${h.nombre}: ${pesos(tipo === "mayorista" ? h.precio_mayor : h.precio)}`);
  }
  if (conPrecio.length === 0) l.push("(Todavía no hay precios cargados)");
  l.push("");
  l.push(`Consultas: ${NEGOCIO.telefono} — ${NEGOCIO.instagram}`);
  abrir(null, l.join("\n"));
}
