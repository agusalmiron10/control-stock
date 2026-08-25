import { getConfig } from "./config";

/**
 * Datos del negocio para comprobantes, PDFs y mensajes de WhatsApp.
 * Antes estaban escritos acá a mano; ahora salen de la configuración que se
 * edita en Ajustes y vive en la base — así el mismo código sirve para
 * cualquier cliente sin tocar nada.
 */
export function negocio() {
  return getConfig().negocio;
}
