# Control de Stock y Cuenta Corriente

Aplicación web para un taller que **fabrica y vende herramientas**. Lleva el stock
(sube cuando producís, baja cuando vendés) y la **cuenta corriente de cada cliente**
(quién te debe, cuánto, con imputación automática de pagos). Anda en escritorio y
celular, con base de datos real en la nube: entrás desde cualquier dispositivo y ves
siempre la misma información.

- **Backend + hosting:** Cloudflare Workers + [Hono](https://hono.dev) (TypeScript).
- **Base de datos:** Cloudflare D1 (SQLite). Nada se guarda solo en el navegador.
- **Frontend:** React + TypeScript + Vite, servido como assets estáticos desde el mismo Worker.
- **Excel:** SheetJS (motor `xlsx-js-style`, API idéntica a `xlsx`), generado en el navegador.

> Toda la plata se guarda en **centavos como enteros**. El símbolo `$` y el formato
> `$ 125.400,50` son solo de pantalla. Las fechas se guardan en ISO (`AAAA-MM-DD`) y
> se muestran `dd/mm/aaaa`.

---

## 1. Requisitos previos

- **Node.js 18+** y npm.
- Una **cuenta de Cloudflare** (el plan gratuito alcanza de sobra).
- Iniciar sesión con Wrangler una sola vez:

```bash
npx wrangler login
```

Instalá las dependencias del proyecto:

```bash
npm install
```

---

## 2. Puesta en marcha desde cero

### 2.1. Crear la base de datos D1

```bash
npx wrangler d1 create control-stock
```

El comando imprime un bloque con un `database_id`. **Copiá ese id** y pegalo en
`wrangler.jsonc`, reemplazando `REEMPLAZAR_CON_TU_DATABASE_ID`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "control-stock",
    "database_id": "acá-va-tu-id",   // 👈
    "migrations_dir": "migrations"
  }
]
```

### 2.2. Aplicar las migraciones (crear las tablas)

En tu máquina (base local para probar) y en la nube (producción):

```bash
npm run db:migrate:local     # base local (para npm run dev)
npm run db:migrate:remote    # base real en Cloudflare
```

### 2.3. Cargar el secreto de sesión

El secreto firma la cookie de sesión. **Nunca va en el código ni en el repo.**

- **Local:** ya hay un archivo `.dev.vars` (ignorado por git) con un valor de ejemplo.
  Cambialo por cualquier texto largo y aleatorio.
- **Producción:** cargalo como secreto del Worker:

```bash
npx wrangler secret put SESSION_SECRET
# pegá un texto largo y aleatorio cuando lo pida
```

### 2.4. (Opcional) Cargar datos de ejemplo

3 herramientas, 3 clientes y ventas con pagos parciales, FIFO y saldo a favor:

```bash
npm run db:seed:local        # o db:seed:remote para la nube
```

Para **borrar los datos de ejemplo y arrancar limpio** (no toca tu usuario):

```bash
npm run db:reset:local       # o db:reset:remote
```

### 2.5. Probar en local

```bash
npm run dev
```

Esto compila el frontend y levanta `wrangler dev` con la base **local** en
`http://localhost:8787`. La primera vez, la pantalla de acceso te deja **crear tu
usuario y contraseña** (solo se puede una vez; después es login normal).

> **Desarrollo con recarga en vivo (opcional):** en una terminal `npm run dev:api`
> (Worker + D1) y en otra `npm run dev:web` (Vite en `http://localhost:5173`, que
> proxea `/api` al Worker). Útil si vas a tocar el frontend seguido.

### 2.6. Publicar

```bash
npm run deploy
```

Compila el frontend y sube todo a Cloudflare. Te queda una URL
`https://control-stock.<tu-subdominio>.workers.dev`. Entrá y creá tu usuario.

### 2.7. Conectar un dominio propio

1. Agregá tu dominio en el panel de Cloudflare (Websites → Add a site) y apuntá los
   nameservers como te indica.
2. En el panel del Worker → **Settings → Domains & Routes → Add → Custom Domain**,
   escribí por ejemplo `stock.tudominio.com`. Cloudflare crea el registro y el
   certificado HTTPS solo.

   Alternativa por config: agregá en `wrangler.jsonc`
   ```jsonc
   "routes": [{ "pattern": "stock.tudominio.com", "custom_domain": true }]
   ```
   y volvé a correr `npm run deploy`.

---

## 3. Estructura del proyecto

```
control-stock/
├── wrangler.jsonc          # Config del Worker: D1, assets, dominio
├── migrations/             # Migraciones SQL versionadas
│   └── 0001_init.sql
├── seed/                   # Datos de ejemplo y reset
│   ├── seed.sql
│   └── reset.sql
├── src/                    # Backend (Worker + Hono)
│   ├── index.ts            # Punto de entrada, monta rutas y sirve el SPA
│   ├── auth.ts             # Hash de contraseñas, cookie de sesión, rate limit
│   ├── imputacion.ts       # 💡 Función pura de imputación FIFO (única fuente de verdad)
│   ├── cuenta.ts           # Puente entre la base y la imputación
│   ├── validate.ts         # Validaciones con mensajes en castellano
│   ├── types.ts            # Tipos de las filas y del entorno
│   └── routes/             # clientes, herramientas, ventas, pagos, panel, export, backup, auth
├── web/                    # Frontend (React + Vite)
│   └── src/
│       ├── App.tsx         # Sesión + navegación (router por hash)
│       ├── api.ts          # Cliente de la API
│       ├── format.ts       # Formato argentino ($ y fechas)
│       ├── excel.ts        # Generación de los 3 Excel con SheetJS
│       ├── components/     # Modal, formularios reutilizables
│       └── pages/          # Panel, Herramientas, Clientes, Ventas, Pagos, Ajustes
├── test/
│   └── imputacion.test.ts  # Tests de la lógica de plata
└── dist/client/            # Salida del build de Vite (se sirve como assets)
```

---

## 4. Cómo se imputan los pagos (cuenta corriente)

La imputación es una **única función pura y testeada** (`src/imputacion.ts`). No se
persiste ninguna asignación: dado el conjunto de ventas (no anuladas) y pagos de un
cliente, se calcula todo de forma determinística. Por eso **editar o borrar un pago
recalcula todo solo**, sin quedar nada desincronizado.

1. Las ventas se ordenan **FIFO**: por fecha, y a igual fecha por número (la más vieja primero).
2. Los pagos **dirigidos a una venta** se aplican primero a esa venta. Si sobra, el
   excedente cae al pozo "a cuenta".
3. Los pagos **a cuenta** (+ excedentes) se reparten FIFO tapando el saldo de cada venta.
4. Lo que sobra es **saldo a favor** (se usa contra la próxima venta).

- **Saldo del cliente** = total de ventas no anuladas − total de pagos. Si da negativo, es saldo a favor.
- **Estado de cada venta**: pagada / parcial ("pagó $X de $Y") / impaga.
- **Anular una venta** devuelve el stock, deja el registro de la anulación y **libera
  sus pagos** (pasan a "a cuenta" y se reimputan solos).

Las operaciones que tocan varias tablas (una venta = venta + items + descuento de stock
+ movimientos + pago inicial) van en un **`db.batch()` atómico**: si algo falla, no queda
nada a medias.

### Tests

```bash
npm test
```

Cubren: FIFO, saldo a favor, venta con descuento, anulación que devuelve stock y libera
pagos, pago directo con excedente y combinaciones.

---

## 5. Exportaciones a Excel

Archivos `.xlsx` reales, con varias hojas, **encabezados en negrita**, anchos de columna,
**montos con formato de moneda** y **fechas como fecha**. El nombre incluye la fecha de
descarga. Se generan en el navegador a partir de lo que devuelve la API (no consumen CPU
del Worker).

- **Excel de un cliente** (desde su ficha): Resumen, Ventas, Detalle, Pagos.
- **Excel general** (Ajustes): Resumen, Clientes, Ventas, Detalle, Pagos, Herramientas,
  Movimientos de stock. Con filtro opcional por rango de fechas.
- **Lista de precios** (botón en Herramientas): Lista de precios (para imprimir/mandar) +
  Historial de precios. Se ofrece descargarla apenas cambiás un precio.

---

## 6. Respaldo y restauración

- **Descargar respaldo / Restaurar** desde la pantalla **Ajustes** (archivo `.json` con
  toda la base). Restaurar **reemplaza** todos los datos actuales (pide confirmación).
- **Backup manual por consola:**

  ```bash
  npx wrangler d1 export control-stock --remote --output=respaldo.sql
  ```

- **Time Travel de D1:** Cloudflare guarda automáticamente el historial de los últimos
  ~30 días. Para volver a un punto anterior:

  ```bash
  npx wrangler d1 time-travel info control-stock --remote
  npx wrangler d1 time-travel restore control-stock --remote --timestamp=<ISO>
  ```

---

## 7. Seguridad

- App privada: **pantalla de acceso con usuario y contraseña**. Se pueden agregar más
  usuarios desde Ajustes.
- La contraseña se guarda **hasheada** (PBKDF2 con WebCrypto). El secreto de sesión va en
  `wrangler secret put`, nunca en el repo.
- Sesión por **cookie firmada** (`HttpOnly`, `Secure`, `SameSite=Lax`).
- **Todos los endpoints de datos exigen sesión válida.** Ninguna ruta de datos queda abierta.
- **Rate limiting** básico en el login (por IP, en memoria del Worker).

---

## 8. Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Compila el front y levanta el Worker con D1 local |
| `npm run deploy` | Compila y publica en Cloudflare |
| `npm test` | Corre los tests de la lógica de plata |
| `npm run typecheck` | Chequea tipos (Worker y web) |
| `npm run db:migrate:local` / `:remote` | Aplica migraciones |
| `npm run db:seed:local` / `:remote` | Carga datos de ejemplo |
| `npm run db:reset:local` / `:remote` | Borra datos de negocio (no el usuario) |

---

## 9. Consultas SQL directas (para depurar)

```bash
npx wrangler d1 execute control-stock --local  --command "SELECT * FROM clientes"
npx wrangler d1 execute control-stock --remote --command "SELECT numero,total FROM ventas"
```
