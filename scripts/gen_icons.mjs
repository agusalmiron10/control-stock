// Genera íconos PNG para la PWA sin dependencias externas (Node puro + zlib).
// Diseño: fondo navy (--barra) con 3 barras blancas ascendentes (stock/inventario).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NAVY = [31, 41, 55]; // #1f2937
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function pngFromPixels(width, height, getPixel) {
  // getPixel(x,y) -> [r,g,b,a]
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // sin filtro
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const idat = deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function generar(size, radioPct = 0.18) {
  const radio = Math.round(size * radioPct);
  // Barras ascendentes: 3 barras centradas, anchos y altos proporcionales.
  const barW = Math.round(size * 0.12);
  const gap = Math.round(size * 0.06);
  const totalW = barW * 3 + gap * 2;
  const startX = Math.round((size - totalW) / 2);
  const baseY = Math.round(size * 0.72);
  const heights = [size * 0.22, size * 0.34, size * 0.46].map(Math.round);

  function dentroEsquina(x, y) {
    // Distancia a la esquina más cercana si está en la zona de esquina.
    const nearLeft = x < radio, nearRight = x >= size - radio;
    const nearTop = y < radio, nearBottom = y >= size - radio;
    let cx = null, cy = null;
    if (nearLeft && nearTop) { cx = radio; cy = radio; }
    else if (nearRight && nearTop) { cx = size - radio; cy = radio; }
    else if (nearLeft && nearBottom) { cx = radio; cy = size - radio; }
    else if (nearRight && nearBottom) { cx = size - radio; cy = size - radio; }
    if (cx === null) return true; // no está en zona de esquina
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radio * radio;
  }

  return pngFromPixels(size, size, (x, y) => {
    if (!dentroEsquina(x, y)) return [0, 0, 0, 0];
    // ¿Está dentro de alguna barra blanca?
    for (let i = 0; i < 3; i++) {
      const bx0 = startX + i * (barW + gap);
      const bx1 = bx0 + barW;
      const by0 = baseY - heights[i];
      const by1 = baseY;
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) {
        return [...WHITE, 255];
      }
    }
    return [...NAVY, 255];
  });
}

const DEST = join(__dirname, "..", "web", "public");
for (const size of [192, 512, 180]) {
  const png = generar(size);
  writeFileSync(join(DEST, `icon-${size}.png`), png);
  console.log(`icon-${size}.png (${png.length} bytes)`);
}
