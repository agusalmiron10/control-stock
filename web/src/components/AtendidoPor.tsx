/**
 * "Atendido por" en el papel impreso (factura, remito, presupuesto, ticket):
 * la foto de perfil (si el usuario subió una) y el nombre de quien cargó la
 * venta/presupuesto/remito. Colores fijos a propósito, como el resto de
 * `.comp-*` — el papel siempre es blanco, no sigue el tema oscuro de la app.
 *
 * No se manda nada si no hay nombre: ventas de antes de que existiera este
 * campo, o si el usuario que la cargó ya no existe.
 */
export function AtendidoPor({ nombre, foto }: { nombre: string | null | undefined; foto: string | null | undefined }) {
  if (!nombre) return null;
  return (
    <div className="comp-atendido">
      {foto ? (
        <img src={foto} alt="" />
      ) : (
        <span className="sin-foto">{nombre.slice(0, 1).toUpperCase()}</span>
      )}
      <span>Atendido por {nombre}</span>
    </div>
  );
}
