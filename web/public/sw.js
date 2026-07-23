// Service Worker mínimo: solo lo necesario para que el navegador ofrezca
// "instalar" la app. A propósito NO cachea nada de /api/* — los datos de
// stock, ventas y cuenta corriente siempre tienen que venir frescos de D1.
// Los assets estáticos (JS/CSS/íconos) se cachean "network-first" con
// respaldo en caché por si se corta la conexión un instante.
const CACHE = "control-stock-shell-v1";

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

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || Response.error()))
  );
});
