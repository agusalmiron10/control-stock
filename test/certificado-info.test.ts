import { describe, it, expect } from "vitest";
import forge from "node-forge";
import { leerCertificado } from "../src/facturacion/certificado-info";

/** Arma un certificado autofirmado con la validez que se pida, sin depender
 *  de openssl del sistema (que no deja poner fechas pasadas fácil). */
function certConVencimiento(diasDesdeHoy: number, cn = "Proveedor de Prueba"): string {
  const keys = forge.pki.rsa.generateKeyPair(1024); // chico y rápido: sólo se lee la validez
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 365 * 86400000);
  cert.validity.notAfter = new Date(Date.now() + diasDesdeHoy * 86400000);
  const attrs = [{ name: "commonName", value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe("estado del certificado de ARCA", () => {
  it("sin certificado cargado, no hay nada que informar", () => {
    expect(leerCertificado(undefined)).toBeNull();
  });

  it("con mucho tiempo por delante, está OK", () => {
    const r = leerCertificado(certConVencimiento(200));
    expect(r?.severidad).toBe("ok");
    expect(r?.vigente).toBe(true);
    expect(r?.diasParaVencer).toBeGreaterThan(190);
  });

  it("a 45 días, hay que avisar", () => {
    const r = leerCertificado(certConVencimiento(45));
    expect(r?.severidad).toBe("avisar");
  });

  it("a 5 días, es urgente", () => {
    const r = leerCertificado(certConVencimiento(5));
    expect(r?.severidad).toBe("urgente");
  });

  it("con la fecha ya pasada, está vencido", () => {
    const r = leerCertificado(certConVencimiento(-10));
    expect(r?.vigente).toBe(false);
    expect(r?.severidad).toBe("vencido");
    expect(r?.diasParaVencer).toBeLessThan(0);
  });

  it("lee el nombre del titular", () => {
    const r = leerCertificado(certConVencimiento(100, "ARBELL Proveedor SRL"));
    expect(r?.titular).toBe("ARBELL Proveedor SRL");
  });

  it("un PEM roto se trata como vencido, no como excepción", () => {
    const r = leerCertificado("esto no es un certificado");
    expect(r?.vigente).toBe(false);
    expect(r?.severidad).toBe("vencido");
  });

  it("cruza de OK a avisar alrededor del umbral de 60 días", () => {
    // Sin fijar el límite exacto: entre la creación del certificado y esta
    // aserción pasan milisegundos reales, así que el día 60 puede caer para
    // cualquier lado. Lo que importa es que 90 días sea OK y 20 sea aviso.
    expect(leerCertificado(certConVencimiento(90))?.severidad).toBe("ok");
    expect(leerCertificado(certConVencimiento(20))?.severidad).toBe("avisar");
  });
});
