-- Foto o croquis técnico de un presupuesto a medida (boceto, moldería,
-- referencia del diseño — útil para marroquinería, carpintería, sastrería y
-- cualquier trabajo hecho a medida). Se guarda igual que la foto de perfil
-- del usuario (base64 en la fila, comprimida del lado del navegador antes
-- de subir): son imágenes chicas, y así entra sola en el mismo respaldo que
-- ya cubre presupuestos, sin sumar R2 ni un bucket nuevo.
ALTER TABLE presupuestos ADD COLUMN croquis TEXT;
