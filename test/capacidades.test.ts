import { describe, it, expect } from "vitest";
import { resolverCapacidades, CAPACIDADES_DEFECTO } from "../src/config";

describe("resolverCapacidades", () => {
  it("sin rubro ni override, todo cae al default seguro", () => {
    const c = resolverCapacidades(null, null);
    expect(c).toEqual(CAPACIDADES_DEFECTO);
    // Lo que cambia el esquema arranca apagado: una cuenta sin configurar se
    // comporta como se comportaba antes de que existieran los rubros.
    expect(c.permite_variantes).toBe(false);
    expect(c.venta_fraccionada).toBe(false);
    expect(c.requiere_numero_serie).toBe(false);
  });

  it("el perfil del rubro pisa el default", () => {
    const c = resolverCapacidades(
      JSON.stringify({ permite_variantes: true, tipos_variante: ["talle", "color"], producto_singular: "Prenda" }),
      null
    );
    expect(c.permite_variantes).toBe(true);
    expect(c.tipos_variante).toEqual(["talle", "color"]);
    expect(c.producto_singular).toBe("Prenda");
    // Lo que el perfil no menciona sigue en el default.
    expect(c.unidad_default).toBe("unidad");
  });

  it("el override de la cuenta le gana al perfil", () => {
    const c = resolverCapacidades(
      JSON.stringify({ producto_singular: "Artículo", producto_plural: "Artículos" }),
      JSON.stringify({ producto_singular: "Herramienta", producto_plural: "Herramientas" })
    );
    expect(c.producto_singular).toBe("Herramienta");
    expect(c.producto_plural).toBe("Herramientas");
  });

  it("el override sólo pisa lo que declara, no borra el resto del perfil", () => {
    const c = resolverCapacidades(
      JSON.stringify({ permite_variantes: true, campos_extra_producto: ["marca"] }),
      JSON.stringify({ producto_singular: "Zapatilla" })
    );
    expect(c.producto_singular).toBe("Zapatilla");
    expect(c.permite_variantes).toBe(true);
    expect(c.campos_extra_producto).toEqual(["marca"]);
  });

  // Estas tres son la red de seguridad: el capacidades_json se edita a mano
  // desde el super-admin, así que un JSON roto NO puede tumbar la app de un
  // cliente — tiene que degradar al default.
  it("un JSON inválido cae al default en vez de romper", () => {
    expect(resolverCapacidades("{ esto no es json", null)).toEqual(CAPACIDADES_DEFECTO);
    expect(resolverCapacidades("[1,2,3]", null)).toEqual(CAPACIDADES_DEFECTO);
    expect(resolverCapacidades("null", null)).toEqual(CAPACIDADES_DEFECTO);
  });

  it("un valor del tipo equivocado se descarta y queda el default", () => {
    const c = resolverCapacidades(
      JSON.stringify({
        permite_variantes: "sí",        // debería ser booleano
        alerta_dias_antes_vencer: "30", // debería ser número
        tipos_variante: "talle",        // debería ser lista
        producto_singular: "   ",       // vacío no cuenta
      }),
      null
    );
    expect(c.permite_variantes).toBe(false);
    expect(c.alerta_dias_antes_vencer).toBe(30);
    expect(c.tipos_variante).toEqual([]);
    expect(c.producto_singular).toBe("Producto");
  });

  it("una clave desconocida se ignora y no se cuela en la config", () => {
    const c = resolverCapacidades(JSON.stringify({ permite_teletransportacion: true }), null);
    expect(c).toEqual(CAPACIDADES_DEFECTO);
    expect("permite_teletransportacion" in c).toBe(false);
  });

  it("de una lista se quedan sólo los strings usables", () => {
    const c = resolverCapacidades(
      JSON.stringify({ campos_extra_producto: ["marca", "", 42, null, "  medida  "] }),
      null
    );
    expect(c.campos_extra_producto).toEqual(["marca", "medida"]);
  });
});
