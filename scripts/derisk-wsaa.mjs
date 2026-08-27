#!/usr/bin/env node
/**
 * Fase 0 de facturación ARCA: probar que se puede armar el Login Ticket
 * Request de WSAA y firmarlo como CMS/PKCS#7 SignedData con node-forge, y
 * que la firma resultante decodifica y valida. No pega contra ARCA — eso
 * requiere el certificado real de un negocio, que todavía no está.
 *
 *   node scripts/derisk-wsaa.mjs <ruta.crt> <ruta.key>
 *
 * Ver plan: /Users/agustinalmiron/.claude/plans/expressive-sauteeing-avalanche.md
 */
import { readFileSync } from "node:fs";
import forge from "node-forge";

const [rutaCrt, rutaKey] = process.argv.slice(2);
if (!rutaCrt || !rutaKey) {
  console.error("Uso: node scripts/derisk-wsaa.mjs <ruta.crt> <ruta.key>");
  process.exit(1);
}

const certPem = readFileSync(rutaCrt, "utf8");
const keyPem = readFileSync(rutaKey, "utf8");

/** Arma el LoginTicketRequest que exige WSAA — mismo formato para homologación y producción. */
function armarLTR(servicio) {
  const ahora = new Date();
  const desde = new Date(ahora.getTime() - 10 * 60 * 1000);
  const hasta = new Date(ahora.getTime() + 10 * 60 * 1000);
  const uniqueId = Math.floor(ahora.getTime() / 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${desde.toISOString()}</generationTime>
    <expirationTime>${hasta.toISOString()}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

/** Firma el XML como CMS SignedData (PKCS#7), como exige WSAA: contenido + firma, sin cifrar. */
function firmarCMS(xml, certPem, keyPem) {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(xml, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign();

  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

/** Decodifica el CMS armado arriba y confirma que el contenido firmado es el XML original. */
function verificarCMS(cmsBase64, xmlOriginal) {
  const der = forge.util.decode64(cmsBase64);
  const asn1 = forge.asn1.fromDer(der);
  const p7 = forge.pkcs7.messageFromAsn1(asn1);

  const contenido = p7.rawCapture?.content
    ? forge.util.createBuffer(p7.rawCapture.content.value[0].value).toString()
    : null;

  if (!contenido || !contenido.includes(xmlOriginal.split("\n")[0])) {
    throw new Error("El contenido decodificado del CMS no coincide con el XML original.");
  }
  if (!p7.certificates || p7.certificates.length === 0) {
    throw new Error("El CMS no trae el certificado embebido.");
  }
  if (!p7.rawCapture?.signature) {
    throw new Error("El CMS no trae la firma.");
  }
  return { certificados: p7.certificates.length, tieneFirma: true };
}

console.log("1) Armando LoginTicketRequest para el servicio 'wsfe'…");
const xml = armarLTR("wsfe");
console.log("   OK —", xml.split("\n").length, "líneas");

console.log("2) Firmando como CMS/PKCS#7 SignedData (SHA-256) con node-forge…");
const cms = firmarCMS(xml, certPem, keyPem);
console.log(`   OK — CMS de ${cms.length} caracteres en base64`);

console.log("3) Decodificando y verificando la estructura…");
const chequeo = verificarCMS(cms, xml);
console.log(`   OK — ${chequeo.certificados} certificado(s) embebido(s), firma presente`);

console.log("");
console.log("✓ La firma CMS/PKCS#7 con node-forge funciona de punta a punta.");
console.log("  Falta: confirmar que esto mismo corre dentro del runtime de Workers (wrangler dev),");
console.log("  y recién después, probar contra el WSAA real de ARCA con un certificado válido.");
