// Service Worker mínimo: solo lo necesario para que el navegador ofrezca
// "instalar" la app. A propósito NO cachea nada de /api/* — los datos de
// stock, ventas y cuenta corriente siempre tienen que venir frescos de D1.
// Los assets estáticos (JS/CSS/íconos) se cachean "network-first" con
// respaldo en caché por si se corta la conexión un instante.
//
// v2: sólo se cachean respuestas OK (2xx). Antes se cacheaba cualquier
// respuesta, así que un 403/500 transitorio del borde (p. ej. mientras
// Cloudflare todavía estaba montando el dominio) quedaba pegado en caché y
// se seguía sirviendo aunque la red ya respondiera bien. Al subir la
// versión, el handler de "activate" borra la caché vieja envenenada.
const CACHE = "control-stock-shell-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Nunca interceptar la API: siempre a la red, sin caché.
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // Navegaciones (abrir la app): siempre a la red. Si falla de verdad, recién
  // ahí se sirve el shell cacheado. Nunca se sirve un error cacheado.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Sólo se guarda lo que salió bien. Un 4xx/5xx no entra en caché.
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || Response.error()))
  );
});
