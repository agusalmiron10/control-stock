import { describe, it, expect } from "vitest";
import { ESTADO_INICIAL, procesarTecla, eanValido, type EstadoLector } from "../web/src/lib/lectorCodigoBarras";

/** Simula que alguien (o algo) teclea, con un ritmo dado en milisegundos. */
function teclear(texto: string, gapMs: number, desde = 1000): string[] {
  let estado: EstadoLector = ESTADO_INICIAL;
  let t = desde;
  const leidos: string[] = [];
  for (const tecla of texto) {
    t += gapMs;
    const r = procesarTecla(estado, tecla === "\n" ? "Enter" : tecla, t);
    estado = r.estado;
    if (r.codigo) leidos.push(r.codigo);
  }
  return leidos;
}

describe("detección del lector de código de barras", () => {
  it("lee un EAN-13 disparado por el lector", () => {
    // Un lector USB manda las teclas cada 2-10 ms.
    expect(teclear("7790895000829\n", 5)).toEqual(["7790895000829"]);
  });

  it("ignora a una persona tipeando el mismo número", () => {
    // 120 ms entre teclas es tipeo humano normal.
    expect(teclear("7790895000829\n", 120)).toEqual([]);
  });

  it("ignora incluso a alguien tipeando muy rápido", () => {
    // 60 ms por tecla son ~200 pulsaciones por minuto sostenidas: rapidísimo
    // para una persona, y aun así el triple de lento que el lector.
    expect(teclear("7790895000829\n", 60)).toEqual([]);
  });

  it("no dispara sin el Enter final", () => {
    expect(teclear("7790895000829", 5)).toEqual([]);
  });

  it("descarta ráfagas demasiado cortas para ser un código", () => {
    expect(teclear("123\n", 5)).toEqual([]);
  });

  it("acepta códigos con letras (etiquetas internas Code 39)", () => {
    expect(teclear("AB-1234\n", 5)).toEqual(["AB-1234"]);
  });

  it("corta la racha si se cuela una tecla que no es de código", () => {
    // El espacio no lo manda un lector: lo que venía antes se descarta y lo
    // que queda ("95000") es muy corto para ser un código.
    expect(teclear("77908 95000\n", 5)).toEqual([]);
  });

  it("descarta lo tipeado antes si después llega una lectura", () => {
    let estado: EstadoLector = ESTADO_INICIAL;
    let t = 1000;
    const paso = (tecla: string, gap: number) => {
      t += gap;
      const r = procesarTecla(estado, tecla, t);
      estado = r.estado;
      return r.codigo;
    };
    // Basura tipeada despacio y después el lector con el código real.
    for (const ch of "999") paso(ch, 300);
    paso("7", 300);
    for (const ch of "790895000829") paso(ch, 5);
    expect(paso("Enter", 5)).toBe("7790895000829");
  });

  it("se cura si le queda un carácter pegado adelante", () => {
    // Caso real: una tecla trabada o un resto de la lectura anterior. El
    // dígito verificador del EAN deja recuperar el código bueno.
    expect(teclear("97790895000829\n", 5)).toEqual(["7790895000829"]);
  });

  it("valida el dígito verificador del EAN", () => {
    expect(eanValido("7790895000829")).toBe(true);
    expect(eanValido("7790895000828")).toBe(false); // último dígito cambiado
    expect(eanValido("77908950008")).toBe(false);   // largo que no existe
  });

  it("deja pasar códigos propios que no son EAN", () => {
    // Muchas ferreterías imprimen sus etiquetas: no tienen verificador y hay
    // que aceptarlas igual.
    expect(teclear("445566\n", 5)).toEqual(["445566"]);
  });

  it("lee dos productos seguidos sin mezclarlos", () => {
    expect(teclear("7790895000829\n7798765432108\n", 5))
      .toEqual(["7790895000829", "7798765432108"]);
  });

  it("no recorta un código propio de 13 dígitos que no es EAN", () => {
    // Los últimos 8 de este número pasan el verificador de EAN-8 por
    // casualidad. Si se "reparara" contra EAN-8, se cargaría otro producto.
    expect(teclear("7791234567890\n", 5)).toEqual(["7791234567890"]);
  });
});
