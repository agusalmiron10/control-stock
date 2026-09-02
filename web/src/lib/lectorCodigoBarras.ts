/**
 * Lector de código de barras USB.
 *
 * Un lector USB no es un dispositivo especial para el navegador: se presenta
 * como un teclado más. Cuando pasa un producto, "tipea" el código y termina
 * con Enter. No hay ningún evento que diga "esto vino de un lector", así que
 * hay que deducirlo, y lo único que lo delata es la VELOCIDAD: el lector manda
 * las teclas cada 2-10 ms, y una persona no baja de ~80 ms ni tipeando rápido.
 *
 * De ahí la regla: si llegaron varios caracteres seguidos con menos de 35 ms
 * entre uno y otro, y encima terminó en Enter, lo mandó una máquina.
 *
 * El riesgo de escuchar el teclado de toda la pantalla es comerse lo que el
 * cajero está escribiendo en otro campo. Eso se resuelve en useLectorDeCodigos
 * (abajo), no acá: esta parte es pura y se puede testear sin navegador.
 */

/** Menos de esto entre tecla y tecla, lo mandó una máquina. */
export const GAP_MAXIMO_MS = 35;

/** Un código más corto que esto es ruido, no una lectura. */
export const LARGO_MINIMO = 6;

/** Lo que puede tener un código: EAN/UPC son números, las etiquetas internas
 *  a veces llevan letras o guiones. */
const CARACTER_VALIDO = /^[0-9A-Za-z\-]$/;

export interface EstadoLector {
  buffer: string;
  /** Cuándo llegó la última tecla, para medir el ritmo. */
  ultimaMs: number;
}

export const ESTADO_INICIAL: EstadoLector = { buffer: "", ultimaMs: 0 };

/**
 * ¿Es un EAN-13 (o EAN-8) con el dígito verificador correcto?
 *
 * El último dígito de un código de barras no es parte del código: es una cuenta
 * sobre los anteriores, que existe justamente para detectar lecturas mal
 * hechas. Verificarlo es gratis y nos deja distinguir una lectura entera de
 * una a la que le falta o le sobra algo.
 */
export function eanValido(s: string): boolean {
  if (!/^\d+$/.test(s) || (s.length !== 13 && s.length !== 8)) return false;
  const d = [...s].map(Number);
  const verificador = d.pop()!;
  // Se pesa 1 y 3 alternando, empezando desde el final del código.
  const suma = d.reduce((acc, n, i) => acc + n * ((d.length - i) % 2 === 1 ? 3 : 1), 0);
  return (10 - (suma % 10)) % 10 === verificador;
}

/**
 * Saca el EAN de una ráfaga que puede traer basura pegada adelante.
 *
 * Pasa de verdad: el cajero deja una tecla apretada, o queda un carácter de la
 * lectura anterior, y el buffer termina siendo "97790895000829". Como el EAN
 * trae verificador, se puede probar el final del buffer y quedarse con el
 * pedazo que da bien — el resto era ruido.
 */
export function extraerEan(buffer: string): string | null {
  // Si lo leído ya es un EAN entero y correcto, no hay nada que reparar.
  if (eanValido(buffer)) return buffer;

  // Reparar sólo cuando sobra algo. Y sólo contra EAN-13: probar también con
  // EAN-8 sería peligroso, porque 8 dígitos cualesquiera pasan el verificador
  // 1 de cada 10 veces — un código propio de 13 dígitos terminaría recortado a
  // los últimos 8 y cargando el producto equivocado.
  if (buffer.length > 13) {
    const cola = buffer.slice(-13);
    if (eanValido(cola)) return cola;
  }
  return null;
}

export interface Resultado {
  estado: EstadoLector;
  /** Si vino algo acá, es una lectura confirmada. */
  codigo: string | null;
}

/**
 * Procesa una tecla y dice si se completó una lectura.
 *
 * `ahora` se pasa por parámetro (en vez de leer el reloj adentro) justamente
 * para poder simular ráfagas en los tests.
 */
export function procesarTecla(estado: EstadoLector, tecla: string, ahora: number): Resultado {
  if (tecla === "Enter") {
    if (estado.buffer.length < LARGO_MINIMO) return { estado: ESTADO_INICIAL, codigo: null };
    // Si adentro hay un EAN válido, ese es el código y lo demás era ruido. Si
    // no hay ninguno, se devuelve lo leído tal cual: muchas ferreterías
    // imprimen sus propias etiquetas, que no son EAN y no tienen verificador.
    return { estado: ESTADO_INICIAL, codigo: extraerEan(estado.buffer) ?? estado.buffer };
  }

  // Cualquier cosa que no sea un carácter de código corta la racha: si el
  // cajero apretó una flecha o un espacio, no venía de un lector.
  if (tecla.length !== 1 || !CARACTER_VALIDO.test(tecla)) {
    return { estado: ESTADO_INICIAL, codigo: null };
  }

  // Si tardó de más, lo tipeó una persona: lo que había antes no era parte de
  // esta lectura. Arranca de cero con esta tecla.
  const seguido = ahora - estado.ultimaMs <= GAP_MAXIMO_MS;
  return {
    estado: { buffer: seguido ? estado.buffer + tecla : tecla, ultimaMs: ahora },
    codigo: null,
  };
}
