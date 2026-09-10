// Redimensionar una imagen del lado del navegador antes de subirla — mismo
// motivo que la foto de perfil (Ajustes.tsx): evitar mandar una foto de
// cámara de varios MB. A diferencia de esa, ACÁ NO se recorta a cuadrado:
// un croquis o boceto técnico pierde información si se le corta un borde,
// así que se escala manteniendo la proporción original.
export function redimensionar(file: File, ladoMax = 1000, calidad = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const escala = Math.min(1, ladoMax / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject({ message: "No se pudo leer esa imagen." }); };
    img.src = url;
  });
}
