-- Foto de perfil, autogestionada: cada usuario sube y borra la suya propia,
-- nadie más se la puede poner (ni el dueño, ni el proveedor). Se guarda como
-- data URL (JPEG chico, recortado y comprimido en el navegador antes de
-- subir) directo en la fila — no vale la pena un bucket R2 para un avatar de
-- unos pocos KB.
ALTER TABLE usuarios ADD COLUMN foto TEXT;
