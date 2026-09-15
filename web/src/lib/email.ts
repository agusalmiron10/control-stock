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
import { pesos } from "../format";
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

