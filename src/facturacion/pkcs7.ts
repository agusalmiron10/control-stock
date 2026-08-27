/**
 * Firma CMS/PKCS#7 SignedData con node-forge — lo que exige WSAA para
 * autenticar el LoginTicketRequest. Probado dentro del runtime real de
 * Cloudflare Workers (no sólo en Node) antes de construir el resto del
 * módulo — ver scripts/derisk-wsaa.mjs.
 */
import forge from "node-forge";

export function firmarCMS(xml: string, certPem: string, clavePem: string): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(clavePem);

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
      // El tipo de node-forge dice `string`, pero en tiempo de ejecución
      // acepta (y espera) un Date acá — lo convierte él a UTCTime ASN.1.
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();

  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}
