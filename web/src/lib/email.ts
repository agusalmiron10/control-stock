// Armado de enlaces "mailto:" con asunto y cuerpo pre-cargados — mismo
// patrón que whatsapp.ts, pero para el correo del cliente. Abre lo que el
// que factura tenga configurado como cliente de mail (Gmail, Outlook, Mail),
// con todo ya escrito y listo para revisar: nunca se manda nada solo.
//
// Además, cuando el sistema tiene el envío real activado (ver src/mail.ts
// del lado del servidor), las funciones "enviar…" de más abajo mandan el
// mail SOLAS, sin que nadie tenga que tocar "Enviar" — y si todavía no está
// activado (o falla por lo que sea), caen de vuelta al "mailto:" de acá
// arriba, así el botón nunca deja de funcionar.
import { pesos, fecha } from "../format";
import { negocio } from "./negocio";
import { api, ApiError } from "../api";

function abrir(email: string | null | undefined, asunto: string, cuerpo: string) {
  const destino = email ? encodeURIComponent(email) : "";
  window.location.href = `mailto:${destino}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

/** Estado de cuenta por mail. */
export function emailEstadoDeCuenta(cliente: any, saldo: number, totalComprado: number, totalPagado: number) {
  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, te paso tu estado de cuenta en ${negocio().nombre}:`);
  l.push("");
  l.push(`Total comprado: ${pesos(totalComprado)}`);
  l.push(`Total pagado: ${pesos(totalPagado)}`);
  if (saldo > 0) l.push(`Saldo pendiente: ${pesos(saldo)}`);
  else if (saldo < 0) l.push(`Saldo a favor: ${pesos(-saldo)}`);
  else l.push(`Estás al día. ¡Gracias!`);
  l.push("");
  l.push(`Cualquier duda, avisame. ${negocio().telefono}`);
  abrir(cliente.email, `Estado de cuenta — ${negocio().nombre}`, l.join("\n"));
}

/** Recordatorio de deuda por mail. */
export function emailRecordatorioDeuda(cliente: any, saldo: number) {
  const l: string[] = [];
  l.push(`Hola ${cliente.nombre}, ¿cómo va? Te escribo de ${negocio().nombre}.`);
  l.push(`Te recuerdo que tenés un saldo pendiente de ${pesos(saldo)}.`);
  l.push(`Cuando puedas, coordinamos. ¡Gracias!`);
  abrir(cliente.email, `Recordatorio de saldo — ${negocio().nombre}`, l.join("\n"));
}

/**
 * Estado de cuenta — intenta el envío real (server a server, como ARBELL);
 * si no está activado o falla, cae al "mailto:" de siempre. Devuelve un
 * texto listo para mostrar en un aviso.
 */
export async function enviarEstadoDeCuenta(
  cliente: any,
  saldo: number,
  totalComprado: number,
  totalPagado: number
): Promise<string> {
  try {
    await api.post(`/api/mensajes/estado-cuenta/${cliente.id}`);
    return `Mail enviado a ${cliente.email}.`;
  } catch (e) {
    emailEstadoDeCuenta(cliente, saldo, totalComprado, totalPagado);
    return e instanceof ApiError && e.status === 409
      ? "El envío directo todavía no está activado — se abrió tu cliente de mail para mandarlo a mano."
      : "No se pudo enviar solo — se abrió tu cliente de mail para mandarlo a mano.";
  }
}

/** Recordatorio de deuda — mismo patrón que enviarEstadoDeCuenta. */
export async function enviarRecordatorioDeuda(cliente: any, saldo: number): Promise<string> {
  try {
    await api.post(`/api/mensajes/recordatorio-deuda/${cliente.id}`);
    return `Mail enviado a ${cliente.email}.`;
  } catch (e) {
    emailRecordatorioDeuda(cliente, saldo);
    return e instanceof ApiError && e.status === 409
      ? "El envío directo todavía no está activado — se abrió tu cliente de mail para mandarlo a mano."
      : "No se pudo enviar solo — se abrió tu cliente de mail para mandarlo a mano.";
  }
}

// Mismo motivo que en whatsapp.ts: un mail con 90 líneas de productos es
// tan incómodo como un WhatsApp con 90 líneas. Con pocos entra cómodo tal
// cual; con muchos, mejor un aviso corto + el Excel adjunto a mano.
const LIMITE_LINEAS_EMAIL = 60;

/**
 * Comparte la lista de precios por mail — abre el cliente de correo con el
 * destinatario en blanco (se completa a mano, como "elegir contacto" en
 * WhatsApp). Devuelve si mandó la lista completa: si no, hay que ofrecer el
 * Excel completo aparte para adjuntar.
 */
export function emailListaDePrecios(herramientas: any[], tipo: "minorista" | "mayorista"): { completa: boolean; cantidad: number } {
  const conPrecio = herramientas.filter((h) => (tipo === "mayorista" ? h.precio_mayor : h.precio) > 0);
  const l: string[] = [];
  l.push(`Lista de precios de ${negocio().nombre} (${tipo}) — ${fecha(new Date().toISOString().slice(0, 10))}`);
  l.push("");

  const completa = conPrecio.length <= LIMITE_LINEAS_EMAIL;
  if (completa) {
    for (const h of conPrecio) {
      l.push(`${h.nombre}: ${pesos(tipo === "mayorista" ? h.precio_mayor : h.precio)}`);
    }
    if (conPrecio.length === 0) l.push("(Todavía no hay precios cargados)");
  } else {
    l.push(
      `Tenemos ${conPrecio.length} productos con precio — te adjunto la lista completa en un archivo aparte para que se vea bien. ¡Cualquier consulta, avisame!`
    );
  }
  l.push("");
  l.push(`Consultas: ${negocio().telefono} — ${negocio().instagram}`);
  abrir(null, `Lista de precios — ${negocio().nombre}`, l.join("\n"));
  return { completa, cantidad: conPrecio.length };
}
